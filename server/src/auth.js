const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { config } = require("./config");
const { query } = require("./db");
const { isLeader } = require("./hierarchy");

const hashPassword = (plain) => bcrypt.hash(plain, 12);
const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, employeeId: user.employee_id },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

function readToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  // Images loaded through <img src> cannot send headers; a short lived token in
  // the query string is accepted for the photo endpoint only.
  if (req.query && req.query.access_token) return String(req.query.access_token);
  return null;
}

async function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: "Authentication required." });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const { rows } = await query(
      "SELECT id, name, employee_id, mobile, email, role, region, assigned_state, assigned_city, assigned_area, manager_id, active FROM users WHERE id = $1",
      [payload.sub]
    );
    if (!rows.length || !rows[0].active) {
      return res.status(401).json({ error: "This account is no longer active." });
    }
    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") return res.status(403).json({ error: "Admin access is required for this action." });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "You do not have permission for this action." });
    if (isLeader(req.user.role) && !req.user.region) {
      return res.status(403).json({ error: "Your account needs an assigned Region before it can access hierarchy data." });
    }
    next();
  };
}

async function audit(actorId, action, entity, entityId, detail) {
  try {
    await query(
      "INSERT INTO audit_log (actor_id, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5)",
      [actorId || null, action, entity, entityId ? String(entityId) : null, detail ? JSON.stringify(detail) : null]
    );
  } catch (err) {
    console.error("audit log failed", err.message);
  }
}

module.exports = { hashPassword, verifyPassword, signToken, requireAuth, requireAdmin, requireRole, audit };
