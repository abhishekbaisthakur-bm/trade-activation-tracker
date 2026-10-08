const express = require("express");
const multer = require("multer");
const { query, withTransaction } = require("../db");
const { requireAuth, requireAdmin, hashPassword, audit } = require("../auth");
const { ASSET_KEYS, LABEL_TO_KEY } = require("../constants");
const { publicUser } = require("./auth");
const { ALL_ROLES } = require("../hierarchy");

const router = express.Router();
const MASTER_ADMIN_EMPLOYEE_ID = "ADMIN001";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const validRole = (role) => (ALL_ROLES.includes(role) ? role : "field");
const allowedParentRoles = {
  city_head: ["regional_head"],
  team_lead: ["regional_head", "city_head"],
  field: ["regional_head", "city_head", "team_lead"],
};

async function resolveHierarchy(role, values) {
  if (role === "admin") return { region: null, state: null, city: null, managerId: null };
  if (role === "regional_head") {
    const region = String(values.region || "").trim();
    if (!region) throw Object.assign(new Error("Region is required for a Regional Head."), { status: 400 });
    return { region, state: null, city: null, managerId: null };
  }
  const state = String(values.state || "").trim();
  const city = String(values.city || "").trim();
  if (!state || !city) throw Object.assign(new Error("State and city are required for this role."), { status: 400 });
  if (!values.managerId) throw Object.assign(new Error("Select a reporting manager."), { status: 400 });
  const parent = await query("SELECT id, role, region, active FROM users WHERE id = $1", [values.managerId]);
  const manager = parent.rows[0];
  if (!manager || !manager.active || !(allowedParentRoles[role] || []).includes(manager.role)) {
    throw Object.assign(new Error("The selected reporting manager is not eligible for this role."), { status: 400 });
  }
  if (!manager.region) throw Object.assign(new Error("The reporting manager must have a Region."), { status: 400 });
  return { region: manager.region, state, city, managerId: manager.id };
}

router.use(requireAuth);

const isMasterAdmin = (user) => user.role === "admin" && user.employee_id === MASTER_ADMIN_EMPLOYEE_ID;

router.get("/audit-log", requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const search = String(req.query.search || "").trim().toLowerCase();
    const params = [search];
    const where = `WHERE log.action NOT LIKE 'login.%' AND ($1::text = '' OR lower(COALESCE(actor.name,'')) LIKE '%' || $1 || '%'
      OR lower(COALESCE(actor.employee_id,'')) LIKE '%' || $1 || '%'
      OR lower(log.action) LIKE '%' || $1 || '%' OR lower(log.entity) LIKE '%' || $1 || '%'
      OR lower(COALESCE(log.entity_id,'')) LIKE '%' || $1 || '%'
      OR lower(COALESCE(log.detail::text,'')) LIKE '%' || $1 || '%')`;
    const [items, total] = await Promise.all([
      query(
        `SELECT log.id, log.action, log.entity, log.entity_id, log.detail, log.created_at,
                actor.name AS actor_name, actor.employee_id AS actor_employee_id, actor.role AS actor_role
         FROM audit_log log LEFT JOIN users actor ON actor.id=log.actor_id
         ${where} ORDER BY log.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params
      ),
      query(`SELECT COUNT(*)::int AS count FROM audit_log log LEFT JOIN users actor ON actor.id=log.actor_id ${where}`, params),
    ]);
    res.json({ entries: items.rows, total: total.rows[0].count, limit, offset });
  } catch (err) { next(err); }
});

/* -------------------------------- users -------------------------------- */

router.get("/users", requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.*, manager.name AS reporting_manager_name
       FROM users u LEFT JOIN users manager ON manager.id = u.manager_id
       ORDER BY u.role DESC, u.name`
    );
    res.json({ users: rows.map(publicUser) });
  } catch (err) {
    next(err);
  }
});

router.post("/users", requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.employeeId || !b.password) {
      return res.status(400).json({ error: "Name, employee ID and an initial password are required." });
    }
    if (String(b.password).length < 8) {
      return res.status(400).json({ error: "The initial password must be at least 8 characters." });
    }
    const role = validRole(b.role);
    if (role === "admin" && !isMasterAdmin(req.user)) {
      return res.status(403).json({ error: "Only ADMIN001 can create additional Admin accounts." });
    }
    const hierarchy = await resolveHierarchy(role, b);
    const { rows } = await query(
      `INSERT INTO users (name, employee_id, mobile, email, role, region, assigned_state, assigned_city, manager_id, password_hash, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        b.name.trim(),
        b.employeeId.trim(),
        b.mobile || null,
        b.email || null,
        role,
        hierarchy.region,
        hierarchy.state,
        hierarchy.city,
        hierarchy.managerId,
        await hashPassword(String(b.password)),
        b.active !== false,
      ]
    );
    await audit(req.user.id, "user.created", "user", rows[0].id, { employeeId: rows[0].employee_id });
    res.status(201).json({ user: publicUser(rows[0]) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === "23505") {
      return res.status(409).json({ error: "That employee ID, mobile or email is already registered." });
    }
    next(err);
  }
});

router.patch("/users/:id", requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (req.params.id === req.user.id && (b.role !== undefined || b.active === false)) {
      return res.status(400).json({ error: "You cannot change your own role or deactivate your own account." });
    }
    const currentResult = await query("SELECT role, employee_id, region, assigned_state, assigned_city, manager_id FROM users WHERE id = $1", [req.params.id]);
    if (!currentResult.rows.length) return res.status(404).json({ error: "User not found." });
    const current = currentResult.rows[0];
    const nextRole = b.role !== undefined ? validRole(b.role) : current.role;
    if (current.employee_id === MASTER_ADMIN_EMPLOYEE_ID && (nextRole !== "admin" || b.active === false || (b.employeeId && b.employeeId !== MASTER_ADMIN_EMPLOYEE_ID))) {
      return res.status(403).json({ error: "The ADMIN001 master-admin account cannot be demoted, deactivated or renamed." });
    }
    if (!isMasterAdmin(req.user) && (current.role === "admin" || nextRole === "admin")) {
      return res.status(403).json({ error: "Only ADMIN001 can manage Admin accounts." });
    }
    const hierarchy = await resolveHierarchy(nextRole, {
      region: b.region !== undefined ? b.region : current.region,
      state: b.state !== undefined ? b.state : current.assigned_state,
      city: b.city !== undefined ? b.city : current.assigned_city,
      managerId: b.managerId !== undefined ? b.managerId : current.manager_id,
    });

    const sets = [];
    const params = [];
    const put = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (b.name !== undefined) put("name", b.name.trim());
    if (b.employeeId !== undefined) put("employee_id", b.employeeId.trim());
    if (b.mobile !== undefined) put("mobile", b.mobile || null);
    if (b.email !== undefined) put("email", b.email || null);
    if (b.role !== undefined) put("role", nextRole);
    put("region", hierarchy.region);
    put("assigned_state", hierarchy.state);
    put("assigned_city", hierarchy.city);
    put("manager_id", hierarchy.managerId);
    if (b.active !== undefined) put("active", !!b.active);
    if (b.password) {
      if (String(b.password).length < 8) {
        return res.status(400).json({ error: "The password must be at least 8 characters." });
      }
      put("password_hash", await hashPassword(String(b.password)));
    }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update." });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE users SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: "User not found." });
    await audit(req.user.id, "user.updated", "user", req.params.id, { fields: Object.keys(b) });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === "23505") {
      return res.status(409).json({ error: "That employee ID, mobile or email is already registered." });
    }
    next(err);
  }
});

// Users are deactivated rather than deleted, so their activation history stays intact.
router.delete("/users/:id", requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "You cannot deactivate your own account." });
    }
    const target = await query("SELECT role, employee_id FROM users WHERE id=$1", [req.params.id]);
    if (!target.rows.length) return res.status(404).json({ error: "User not found." });
    if (target.rows[0].employee_id === MASTER_ADMIN_EMPLOYEE_ID) return res.status(403).json({ error: "The ADMIN001 master-admin account cannot be deactivated." });
    if (target.rows[0].role === "admin" && !isMasterAdmin(req.user)) return res.status(403).json({ error: "Only ADMIN001 can manage Admin accounts." });
    const { rows } = await query(
      "UPDATE users SET active = FALSE, updated_at = now() WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found." });
    await audit(req.user.id, "user.deactivated", "user", req.params.id, null);
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------- pharmacies ------------------------------ */

router.get("/pharmacies", async (req, res, next) => {
  try {
    const search = String(req.query.search || "").trim().toLowerCase();
    const city = req.query.city || null;
    const { rows } = await query(
      `SELECT p.id, p.name, p.rio_id, ppc.party_alt_code, p.address, p.state, p.city, p.area, p.latitude, p.longitude,
              ppc.id AS party_code_id
       FROM pharmacies p
       JOIN pharmacy_party_codes ppc ON ppc.pharmacy_id=p.id AND ppc.active=TRUE
       WHERE p.active = TRUE
         AND ($1::text IS NULL OR p.city = $1)
         AND ($2::text = '' OR lower(p.name) LIKE '%' || $2 || '%' OR lower(COALESCE(p.rio_id,'')) LIKE '%' || $2 || '%' OR lower(ppc.party_alt_code) LIKE '%' || $2 || '%')
       ORDER BY p.name, ppc.party_alt_code LIMIT 50`,
      [city, search]
    );
    res.json({ pharmacies: rows });
  } catch (err) {
    next(err);
  }
});

router.post("/pharmacies", requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.rioId || !b.partyAltCode) {
      return res.status(400).json({ error: "Pharmacy Name, RIO ID and Party/Alt Code are required." });
    }
    const nameKey = String(b.name).trim().toLowerCase().replace(/\s+/g, " ");
    const { rows } = await withTransaction(async (client) => {
      const saved = await client.query(
        `INSERT INTO pharmacies (name, name_key, rio_id, party_alt_code, address, state, city, area, latitude, longitude, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10)
         ON CONFLICT (rio_id) WHERE rio_id IS NOT NULL DO UPDATE SET name=EXCLUDED.name,name_key=EXCLUDED.name_key,
           party_alt_code=EXCLUDED.party_alt_code,address=EXCLUDED.address,state=EXCLUDED.state,city=EXCLUDED.city
         RETURNING *`,
        [b.name.trim(), nameKey, String(b.rioId).trim().toUpperCase(), String(b.partyAltCode).trim(),
         b.address || null, b.state || null, b.city || null, b.latitude || null, b.longitude || null, req.user.id]
      );
      await client.query(
        `INSERT INTO pharmacy_party_codes (pharmacy_id,party_alt_code,created_by,active)
         VALUES ($1,$2,$3,TRUE)
         ON CONFLICT (pharmacy_id,party_alt_code) DO UPDATE SET active=TRUE`,
        [saved.rows[0].id, String(b.partyAltCode).trim(), req.user.id]
      );
      return saved;
    });
    res.status(201).json({ pharmacy: rows[0] });
  } catch (err) {
    next(err);
  }
});

/* --------------------------- planned targets --------------------------- */

router.get("/plans", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.id, p.state, p.city, p.area, p.planned_shops,
              COALESCE(json_object_agg(pa.asset_type, pa.quantity)
                       FILTER (WHERE pa.asset_type IS NOT NULL), '{}') AS assets
       FROM planned_targets p
       LEFT JOIN planned_assets pa ON pa.plan_id = p.id
       GROUP BY p.id ORDER BY p.state, p.city, p.area`
    );
    res.json({ plans: rows });
  } catch (err) {
    next(err);
  }
});

router.put("/plans", requireAdmin, async (req, res, next) => {
  try {
    const plans = Array.isArray(req.body.plans) ? req.body.plans : null;
    if (!plans) return res.status(400).json({ error: "Send a plans array." });
    const saved = await savePlans(plans, req.body.replace !== false);
    await audit(req.user.id, "plans.replaced", "planned_targets", null, { rows: saved });
    res.json({ saved });
  } catch (err) {
    next(err);
  }
});

// CSV upload. Header row must contain State, City, Area, Planned Shops and one
// column per asset label.
router.post("/plans/import", requireAdmin, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Attach a CSV file." });
    const text = req.file.buffer.toString("utf8").replace(/^\uFEFF/, "");
    const rows = parseCsv(text);
    if (rows.length < 2) return res.status(400).json({ error: "The file has no data rows." });

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (n) => header.indexOf(n);
    const missing = ["state", "city", "area", "planned shops"].filter((n) => idx(n) === -1);
    if (missing.length) {
      return res.status(400).json({ error: `Missing column(s): ${missing.join(", ")}.` });
    }

    const plans = rows.slice(1).map((r) => {
      const assets = {};
      Object.entries(LABEL_TO_KEY).forEach(([label, key]) => {
        const j = idx(label);
        assets[key] = j === -1 ? 0 : Math.max(0, parseInt(r[j], 10) || 0);
      });
      return {
        state: (r[idx("state")] || "").trim(),
        city: (r[idx("city")] || "").trim(),
        area: (r[idx("area")] || "").trim(),
        plannedShops: Math.max(0, parseInt(r[idx("planned shops")], 10) || 0),
        assets,
      };
    }).filter((p) => p.state && p.city && p.area);

    if (!plans.length) return res.status(400).json({ error: "No valid rows found in the file." });
    const saved = await savePlans(plans, String(req.body.replace) !== "false");
    await audit(req.user.id, "plans.imported", "planned_targets", null, { rows: saved });
    res.json({ saved });
  } catch (err) {
    next(err);
  }
});

async function savePlans(plans, replace) {
  return withTransaction(async (client) => {
    if (replace) await client.query("DELETE FROM planned_targets");
    let count = 0;
    for (const p of plans) {
      const { rows } = await client.query(
        `INSERT INTO planned_targets (state, city, area, planned_shops)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (state, city, area) DO UPDATE SET planned_shops = EXCLUDED.planned_shops
         RETURNING id`,
        [p.state, p.city, p.area, Math.max(0, parseInt(p.plannedShops, 10) || 0)]
      );
      const planId = rows[0].id;
      for (const key of ASSET_KEYS) {
        const qty = Math.max(0, parseInt((p.assets || {})[key], 10) || 0);
        await client.query(
          `INSERT INTO planned_assets (plan_id, asset_type, quantity) VALUES ($1,$2,$3)
           ON CONFLICT (plan_id, asset_type) DO UPDATE SET quantity = EXCLUDED.quantity`,
          [planId, key, qty]
        );
      }
      count += 1;
    }
    return count;
  });
}

function parseCsv(text) {
  const out = [];
  let row = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  row.push(cur);
  out.push(row);
  return out.filter((r) => r.some((c) => String(c).trim() !== ""));
}

module.exports = router;
