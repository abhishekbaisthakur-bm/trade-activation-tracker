const express = require("express");
const multer = require("multer");
const { query, withTransaction } = require("../db");
const { requireAuth, requireAdmin, hashPassword, audit } = require("../auth");
const { ASSET_KEYS, LABEL_TO_KEY } = require("../constants");
const { publicUser } = require("./auth");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const validRole = (role) => (["admin", "manager", "field"].includes(role) ? role : "field");

function validateTerritory(role, state, city) {
  if (role === "manager" && !state) return "Assign a state to every manager. City is optional.";
  if (role === "field" && (!state || !city)) return "Assign both a state and city to every field user.";
  return null;
}

router.use(requireAuth);

/* -------------------------------- users -------------------------------- */

router.get("/users", requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM users ORDER BY role DESC, name");
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
    const territoryError = validateTerritory(role, b.state, b.city);
    if (territoryError) return res.status(400).json({ error: territoryError });
    const { rows } = await query(
      `INSERT INTO users (name, employee_id, mobile, email, role, assigned_state, assigned_city, password_hash, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        b.name.trim(),
        b.employeeId.trim(),
        b.mobile || null,
        b.email || null,
        role,
        role === "admin" ? null : b.state || null,
        role === "admin" ? null : b.city || null,
        await hashPassword(String(b.password)),
        b.active !== false,
      ]
    );
    await audit(req.user.id, "user.created", "user", rows[0].id, { employeeId: rows[0].employee_id });
    res.status(201).json({ user: publicUser(rows[0]) });
  } catch (err) {
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
    const currentResult = await query("SELECT role, assigned_state, assigned_city FROM users WHERE id = $1", [req.params.id]);
    if (!currentResult.rows.length) return res.status(404).json({ error: "User not found." });
    const current = currentResult.rows[0];
    const nextRole = b.role !== undefined ? validRole(b.role) : current.role;
    const nextState = b.state !== undefined ? b.state : current.assigned_state;
    const nextCity = b.city !== undefined ? b.city : current.assigned_city;
    const territoryError = validateTerritory(nextRole, nextState, nextCity);
    if (territoryError) return res.status(400).json({ error: territoryError });

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
    if (b.state !== undefined || nextRole === "admin") put("assigned_state", nextRole === "admin" ? null : nextState || null);
    if (b.city !== undefined || nextRole === "admin") put("assigned_city", nextRole === "admin" ? null : nextCity || null);
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
      `SELECT id, name, address, state, city, area, latitude, longitude
       FROM pharmacies
       WHERE active = TRUE
         AND ($1::text IS NULL OR city = $1)
         AND ($2::text = '' OR lower(name) LIKE '%' || $2 || '%')
       ORDER BY name LIMIT 50`,
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
    if (!b.name || !b.state || !b.city || !b.area) {
      return res.status(400).json({ error: "Name, state, city and area are required." });
    }
    const nameKey = String(b.name).trim().toLowerCase().replace(/\s+/g, " ");
    const { rows } = await query(
      `INSERT INTO pharmacies (name, name_key, address, state, city, area, latitude, longitude, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (city, name_key) DO UPDATE SET address = EXCLUDED.address, area = EXCLUDED.area
       RETURNING *`,
      [b.name.trim(), nameKey, b.address || null, b.state, b.city, b.area, b.latitude || null, b.longitude || null, req.user.id]
    );
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
