const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const { query, withTransaction } = require("../db");
const { requireAuth, requireRole, hashPassword } = require("../auth");
const { buildTemplate, parseWorkbook, validateRows } = require("../bulk-users");

const router = express.Router();
const roles = ["admin", "regional_head", "city_head", "team_lead"];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

router.use(requireAuth, requireRole(...roles));

async function userSnapshot(db = { query }) {
  const { rows } = await db.query(`SELECT id, name, employee_id, mobile, email, role, region,
    assigned_state, assigned_city, assigned_area, manager_id, active FROM users`);
  return rows;
}

router.get("/template", async (req, res, next) => {
  try {
    const workbook = await buildTemplate(req.user, await userSnapshot());
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=user-upload-template.xlsx");
    res.send(Buffer.from(buffer));
  } catch (err) { next(err); }
});

router.post("/import", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Attach the completed Excel (.xlsx) template." });
    if (!/\.xlsx$/i.test(req.file.originalname || "")) return res.status(415).json({ error: "Upload an Excel (.xlsx) file using the downloaded template." });
    let parsed;
    try { parsed = await parseWorkbook(req.file.buffer, req.user.role); }
    catch (err) { return res.status(err.status || 400).json({ error: err.message || "The Excel file could not be read." }); }
    const first = validateRows(parsed, req.user, await userSnapshot());
    if (first.errors.length) return res.status(400).json({ error: "No accounts were created. Correct the highlighted rows and upload again.", errors: first.errors.slice(0, 100) });

    const hashed = new Map();
    for (const user of first.users) hashed.set(user.row, await hashPassword(user.password));
    const batchId = crypto.randomUUID();
    const imported = await withTransaction(async (client) => {
      await client.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
      const actorResult = await client.query(`SELECT id, name, employee_id, mobile, email, role, region,
        assigned_state, assigned_city, assigned_area, manager_id, active FROM users WHERE id=$1`, [req.user.id]);
      const actor = actorResult.rows[0];
      if (!actor || !actor.active || actor.role !== req.user.role) throw Object.assign(new Error("Your account permissions changed. Sign in again and download a fresh template."), { status: 403 });
      const fresh = validateRows(parsed, actor, await userSnapshot(client));
      if (fresh.errors.length) throw Object.assign(new Error("No accounts were created. Correct the highlighted rows and upload again."), { status: 400, errors: fresh.errors.slice(0, 100) });
      const created = [];
      for (const user of fresh.users) {
        const inserted = await client.query(`INSERT INTO users
          (name, employee_id, mobile, email, role, region, assigned_state, assigned_city, assigned_area, manager_id, password_hash, active)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE) RETURNING id`,
          [user.name, user.employeeId, user.mobile, user.email, user.role, user.region, user.state, user.city, user.area, user.managerId, hashed.get(user.row)]);
        created.push(inserted.rows[0].id);
        await client.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
          VALUES ($1,'user.created','user',$2,$3)`, [actor.id, inserted.rows[0].id, JSON.stringify({ source: "bulk", batchId, employeeId: user.employeeId, role: user.role, managerId: user.managerId })]);
      }
      await client.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, detail)
        VALUES ($1,'users.imported','users',NULL,$2)`, [actor.id, JSON.stringify({ batchId, count: created.length })]);
      return created.length;
    });
    res.status(201).json({ imported });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, ...(err.errors ? { errors: err.errors } : {}) });
    if (err.code === "23505") return res.status(409).json({ error: "No accounts were created because an employee ID, email or contact already exists." });
    next(err);
  }
});

router.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "The Excel file must be under 5 MB." });
  next(err);
});

module.exports = router;
