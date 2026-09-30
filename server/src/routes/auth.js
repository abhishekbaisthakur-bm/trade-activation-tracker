const express = require("express");
const rateLimit = require("express-rate-limit");
const { query } = require("../db");
const { verifyPassword, signToken, requireAuth, audit } = require("../auth");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Wait ten minutes and try again." },
});

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  employeeId: u.employee_id,
  mobile: u.mobile,
  email: u.email,
  role: u.role,
  region: u.region,
  state: u.assigned_state,
  city: u.assigned_city,
  managerId: u.manager_id,
  reportingManagerName: u.reporting_manager_name || null,
  active: u.active,
});

// Field staff log in with employee ID, mobile or email.
router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const identifier = String(req.body.identifier || "").trim();
    const normalizedIdentifier = identifier.toLowerCase();
    const password = String(req.body.password || "");
    if (!identifier || !password) {
      return res.status(400).json({ error: "Enter your employee ID, mobile or email and your password." });
    }
    const { rows } = await query(
      `SELECT * FROM users
       WHERE employee_id = $1 OR lower(mobile) = $2 OR lower(email) = $2
       LIMIT 1`,
      [identifier, normalizedIdentifier]
    );
    const user = rows[0];
    const ok = user && user.active && (await verifyPassword(password, user.password_hash));
    if (!ok) {
      await audit(user ? user.id : null, "login.failed", "user", identifier, null);
      return res.status(401).json({ error: "That ID and password combination did not match an active account." });
    }
    await audit(user.id, "login.success", "user", user.id, null);
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const current = String(req.body.currentPassword || "");
    const next_ = String(req.body.newPassword || "");
    if (next_.length < 8) return res.status(400).json({ error: "The new password must be at least 8 characters." });
    const { rows } = await query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
    if (!(await verifyPassword(current, rows[0].password_hash))) {
      return res.status(400).json({ error: "The current password is not correct." });
    }
    const { hashPassword } = require("../auth");
    await query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [
      await hashPassword(next_),
      req.user.id,
    ]);
    await audit(req.user.id, "password.changed", "user", req.user.id, null);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, publicUser };
