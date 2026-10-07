  const express = require("express");
  const multer = require("multer");
  const { query, withTransaction } = require("../db");
  const { requireAuth, requireAdmin, requireRole, hashPassword, audit } = require("../auth");
  const { ASSET_KEYS } = require("../constants");
  const { LEADER_ROLES, CHILD_ROLES, descendantOrSelfSql } = require("../hierarchy");

  const router = express.Router();
  const masterUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
  router.use(requireAuth);

  // Managers create their field users directly. Keeping user creation in the
  // approval flow would require storing an initial password in a JSON payload.
  const allowedTypes = new Set(["user_deactivate", "target_change"]);

  const withoutPassword = (payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    const { password, ...safe } = payload;
    return safe;
  };

  const publicRequest = (row) => ({ ...row, payload: withoutPassword(row.payload) });

  const allowedParentRoles = {
    city_head: ["regional_head"],
    team_lead: ["regional_head", "city_head"],
    field: ["regional_head", "city_head", "team_lead"],
  };

  router.get("/managed-users", requireRole(...LEADER_ROLES), async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT u.id, u.name, u.employee_id, u.role, u.region, u.assigned_state, u.assigned_city,
                u.manager_id, u.active, manager.name AS reporting_manager_name
         FROM users u LEFT JOIN users manager ON manager.id = u.manager_id
         WHERE ${descendantOrSelfSql("$1", "u")}
         ORDER BY u.active DESC, u.role, u.name`,
        [req.user.id]
      );
      res.json({ users: rows });
    } catch (err) { next(err); }
  });

  router.post("/managed-users", requireRole(...LEADER_ROLES), async (req, res, next) => {
    try {
      const b = req.body || {};
      if (!b.name || !b.employeeId || !b.password) {
        return res.status(400).json({ error: "Name, employee ID and an initial password are required." });
      }
      if (String(b.password).length < 8) return res.status(400).json({ error: "The initial password must be at least 8 characters." });
      if (!(CHILD_ROLES[req.user.role] || []).includes(b.role)) {
        return res.status(403).json({ error: "You cannot create that role." });
      }
      if (!b.managerId) return res.status(400).json({ error: "Select a reporting manager." });
      if (!b.state || !b.city) return res.status(400).json({ error: "State and city are required." });
      const parentResult = await query(
        `SELECT u.id, u.role, u.region, u.active FROM users u
         WHERE u.id = $1 AND ${descendantOrSelfSql("$2", "u")}`,
        [b.managerId, req.user.id]
      );
      const parent = parentResult.rows[0];
      if (!parent || !parent.active || !(allowedParentRoles[b.role] || []).includes(parent.role)) {
        return res.status(400).json({ error: "The selected reporting manager is not eligible for this role." });
      }
      const { rows } = await query(
        `INSERT INTO users
          (name, employee_id, mobile, email, role, region, assigned_state, assigned_city, manager_id, password_hash, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)
         RETURNING id, name, employee_id, mobile, email, role, region, assigned_state, assigned_city, manager_id, active`,
        [String(b.name).trim(), String(b.employeeId).trim(), b.mobile || null, b.email || null,
          b.role, parent.region, String(b.state).trim(), String(b.city).trim(), parent.id,
          await hashPassword(String(b.password))]
      );
      await audit(req.user.id, "user.created", "user", rows[0].id, { role: b.role, managerId: parent.id });
      res.status(201).json({ user: rows[0] });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "That employee ID, mobile or email is already registered." });
      next(err);
    }
  });

  router.get("/", requireRole(...LEADER_ROLES, "admin"), async (req, res, next) => {
    try {
      const params = [];
      let where = "WHERE 1=1";
      if (req.user.role !== "admin") { params.push(req.user.id); where += ` AND r.requested_by = $${params.length}`; }
      if (req.query.status) { params.push(req.query.status); where += ` AND r.status = $${params.length}`; }
      const { rows } = await query(
        `SELECT r.*, u.name AS requested_by_name, u.employee_id AS requested_by_employee_id,
                a.name AS reviewed_by_name
        FROM approval_requests r
        JOIN users u ON u.id = r.requested_by
        LEFT JOIN users a ON a.id = r.reviewed_by
        ${where} ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC`, params
      );
      res.json({ requests: rows.map(publicRequest) });
    } catch (err) { next(err); }
  });

  router.get("/field-users", requireRole(...LEADER_ROLES, "admin"), async (req, res, next) => {
    try {
      let rows;

      if (req.user.role !== "admin") {
        const result = await query(
          `SELECT id, name, employee_id, mobile, email,
                  assigned_state, assigned_city, active, manager_id
          FROM users
          WHERE role = 'field'
            AND ${descendantOrSelfSql("$1", "users")}
          ORDER BY active DESC, name`,
          [req.user.id]
        );

        rows = result.rows;
      } else {
        const result = await query(
          `SELECT id, name, employee_id, mobile, email,
                  assigned_state, assigned_city, active, manager_id
          FROM users
          WHERE role = 'field'
          ORDER BY active DESC, name`
        );

        rows = result.rows;
      }

      res.json({ users: rows });
    } catch (err) {
      next(err);
    }
  });

// Manager: directly create a field user in their own team.
router.post("/field-users", requireRole(...LEADER_ROLES), async (req, res, next) => {
  try {
    const b = req.body || {};

    if (!b.name || !b.employeeId || !b.password) {
      return res.status(400).json({
        error: "Name, employee ID and an initial password are required."
      });
    }

    if (String(b.password).length < 8) {
      return res.status(400).json({
        error: "The initial password must be at least 8 characters."
      });
    }
    if (!b.state || !b.city) {
      return res.status(400).json({ error: "State and city are required for every field user." });
    }
    assertManagerTerritory(req.user, b);

    const { rows } = await query(
      `INSERT INTO users
        (name, employee_id, mobile, email, role, assigned_state, assigned_city, manager_id, password_hash, active)
       VALUES
        ($1,$2,$3,$4,'field',$5,$6,$7,$8,TRUE)
       RETURNING id, name, employee_id, mobile, email,
                 assigned_state, assigned_city, manager_id, active`,
      [
        String(b.name).trim(),
        String(b.employeeId).trim(),
        b.mobile || null,
        b.email || null,
        b.state || null,
        b.city || null,
        req.user.id,
        await hashPassword(String(b.password))
      ]
    );

    await audit(
      req.user.id,
      "field_user.created",
      "user",
      rows[0].id,
      { employeeId: rows[0].employee_id }
    );

    res.status(201).json({ user: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "That employee ID, mobile or email is already registered."
      });
    }

    next(err);
  }
});


// Manager: edit a field user in their own team or reset their password.
router.patch("/field-users/:id", requireRole(...LEADER_ROLES), async (req, res, next) => {
  try {
    const b = req.body || {};

    const existing = await query(
      `SELECT id, assigned_state, assigned_city
       FROM users
       WHERE id = $1
         AND role = 'field'
         AND manager_id = $2`,
      [req.params.id, req.user.id]
    );

    if (!existing.rows.length) {
      return res.status(404).json({
        error: "Field user not found in your team."
      });
    }

    const nextTerritory = {
      state: b.state !== undefined ? b.state : existing.rows[0].assigned_state,
      city: b.city !== undefined ? b.city : existing.rows[0].assigned_city,
    };
    if (!nextTerritory.state || !nextTerritory.city) {
      return res.status(400).json({ error: "State and city are required for every field user." });
    }
    assertManagerTerritory(req.user, nextTerritory);

    const sets = [];
    const params = [];

    const put = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (b.name !== undefined) {
      const name = String(b.name).trim();

      if (!name) {
        return res.status(400).json({
          error: "Name cannot be empty."
        });
      }

      put("name", name);
    }

    if (b.employeeId !== undefined) {
      const employeeId = String(b.employeeId).trim();

      if (!employeeId) {
        return res.status(400).json({
          error: "Employee ID cannot be empty."
        });
      }

      put("employee_id", employeeId);
    }

    if (b.mobile !== undefined) {
      put("mobile", b.mobile || null);
    }

    if (b.email !== undefined) {
      put("email", b.email || null);
    }

    if (b.state !== undefined) {
      put("assigned_state", b.state || null);
    }

    if (b.city !== undefined) {
      put("assigned_city", b.city || null);
    }

    if (b.password) {
      if (String(b.password).length < 8) {
        return res.status(400).json({
          error: "The password must be at least 8 characters."
        });
      }

      put(
        "password_hash",
        await hashPassword(String(b.password))
      );
    }

    if (!sets.length) {
      return res.status(400).json({
        error: "Nothing to update."
      });
    }

    sets.push("updated_at = now()");

    params.push(req.params.id);
    params.push(req.user.id);

    const { rows } = await query(
      `UPDATE users
       SET ${sets.join(", ")}
       WHERE id = $${params.length - 1}
         AND role = 'field'
         AND manager_id = $${params.length}
       RETURNING id, name, employee_id, mobile, email,
                 assigned_state, assigned_city, manager_id, active`,
      params
    );

    await audit(
      req.user.id,
      "field_user.updated",
      "user",
      req.params.id,
      {
        fields: Object.keys(b).filter(
          (key) => key !== "password"
        ),
        passwordReset: Boolean(b.password)
      }
    );

    res.json({ user: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "That employee ID, mobile or email is already registered."
      });
    }

    next(err);
  }
});

router.delete("/field-users/:id", requireRole(...LEADER_ROLES), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE users u SET active=FALSE, updated_at=now()
       WHERE u.id=$1 AND u.role='field' AND ${descendantOrSelfSql("$2", "u")}
       RETURNING u.id, u.name, u.employee_id, u.active`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Salesman not found below you." });
    await audit(req.user.id, "field_user.deactivated", "user", req.params.id, null);
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
});

function assertManagerTerritory(user, data) {
  if (user.assigned_state && data.state && data.state !== user.assigned_state) {
    throw Object.assign(new Error("This state is outside your assigned territory."), { status: 403 });
  }
  if (user.assigned_city && data.city && data.city !== user.assigned_city) {
    throw Object.assign(new Error("This city is outside your assigned territory."), { status: 403 });
  }
}

async function ensureGeography(client, state, city, area) {
  const plan = await client.query(
    `INSERT INTO planned_targets (state, city, area, planned_shops)
     VALUES ($1,$2,$3,0)
     ON CONFLICT (state, city, area) DO NOTHING
     RETURNING id`,
    [state, city, area]
  );
  if (plan.rows[0]) {
    for (const key of ASSET_KEYS) {
      await client.query(
        `INSERT INTO planned_assets (plan_id, asset_type, quantity)
         VALUES ($1,$2,0) ON CONFLICT (plan_id, asset_type) DO NOTHING`,
        [plan.rows[0].id, key]
      );
    }
  }
}

// Manager-owned master list for direct entry, CSV import and maintenance.
router.get("/master-pharmacies", requireRole(...LEADER_ROLES), async (req, res, next) => {
  try {
    const search = String(req.query.search || "").trim().toLowerCase();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(10, parseInt(req.query.pageSize, 10) || 10));
    const params = [search];
    let where = "WHERE ($1::text = '' OR lower(p.name) LIKE '%' || $1 || '%' OR lower(COALESCE(p.rio_id,'')) LIKE '%' || $1 || '%' OR lower(COALESCE(p.party_alt_code,'')) LIKE '%' || $1 || '%' OR lower(COALESCE(p.city,'')) LIKE '%' || $1 || '%' OR lower(COALESCE(p.area,'')) LIKE '%' || $1 || '%')";
    if (req.user.assigned_state) { params.push(req.user.assigned_state); where += ` AND p.state = $${params.length}`; }
    if (req.user.assigned_city) { params.push(req.user.assigned_city); where += ` AND p.city = $${params.length}`; }
    const count = await query(`SELECT COUNT(*)::int AS total FROM pharmacies p ${where}`, params);
    params.push(pageSize, (page - 1) * pageSize);
    const { rows } = await query(
      `SELECT p.* FROM pharmacies p ${where} ORDER BY p.active DESC, p.name, p.rio_id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ pharmacies: rows, pagination: { page, pageSize, total: count.rows[0].total, pages: Math.max(1, Math.ceil(count.rows[0].total / pageSize)) } });
  } catch (err) { next(err); }
});

router.post("/master-pharmacies", requireRole("admin", "regional_head"), async (req, res, next) => {
  try {
    const p = req.body || {};
    if (!p.name || !p.rioId || !p.partyAltCode) {
      return res.status(400).json({ error: "Pharmacy Name, RIO ID and Party/Alt Code are required." });
    }
    assertManagerTerritory(req.user, p);
    const pharmacy = await withTransaction(async (client) => {
      const nameKey = String(p.name).trim().toLowerCase().replace(/\s+/g, " ");
      const { rows } = await client.query(
        `INSERT INTO pharmacies (name,name_key,rio_id,party_alt_code,address,state,city,area,latitude,longitude,created_by,active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,TRUE)
         ON CONFLICT (rio_id) WHERE rio_id IS NOT NULL DO UPDATE SET
           name=EXCLUDED.name,name_key=EXCLUDED.name_key,party_alt_code=EXCLUDED.party_alt_code,address=EXCLUDED.address,
           state=EXCLUDED.state,city=EXCLUDED.city,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,active=TRUE
         RETURNING *`,
        [String(p.name).trim(), nameKey, String(p.rioId).trim().toUpperCase(), String(p.partyAltCode).trim(),
         p.address || null, p.state || null, p.city || null, p.latitude ?? null, p.longitude ?? null, req.user.id]
      );
      return rows[0];
    });
    await audit(req.user.id, "master_pharmacy.saved", "pharmacy", pharmacy.id, null);
    res.status(201).json({ pharmacy });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === "23505") return res.status(409).json({ error: "That RIO ID is already assigned to another pharmacy." });
    next(err);
  }
});

router.patch("/master-pharmacies/:id", requireRole("admin", "regional_head"), async (req, res, next) => {
  try {
    const existing = await query("SELECT * FROM pharmacies WHERE id=$1", [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: "Shop not found." });
    assertManagerTerritory(req.user, existing.rows[0]);
    const p = { ...existing.rows[0], ...(req.body || {}) };
    const rioId = p.rioId ?? p.rio_id;
    const partyAltCode = p.partyAltCode ?? p.party_alt_code;
    if (!p.name || !rioId || !partyAltCode) return res.status(400).json({ error: "Pharmacy Name, RIO ID and Party/Alt Code are required." });
    assertManagerTerritory(req.user, p);
    const pharmacy = await withTransaction(async (client) => {
      const nameKey = String(p.name).trim().toLowerCase().replace(/\s+/g, " ");
      const { rows } = await client.query(
        `UPDATE pharmacies SET name=$1,name_key=$2,rio_id=$3,party_alt_code=$4,address=$5,state=$6,city=$7,area=NULL,
           latitude=$8,longitude=$9,active=$10 WHERE id=$11 RETURNING *`,
        [String(p.name).trim(), nameKey, String(rioId).trim().toUpperCase(), String(partyAltCode).trim(), p.address || null,
         p.state || null, p.city || null, p.latitude ?? null, p.longitude ?? null, p.active !== false, req.params.id]
      );
      return rows[0];
    });
    await audit(req.user.id, "master_pharmacy.updated", "pharmacy", pharmacy.id, null);
    res.json({ pharmacy });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === "23505") return res.status(409).json({ error: "That RIO ID is already assigned to another pharmacy." });
    next(err);
  }
});

router.delete("/master-pharmacies/:id", requireRole("admin", "regional_head"), async (req, res, next) => {
  try {
    const existing = await query("SELECT * FROM pharmacies WHERE id=$1", [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: "Shop not found." });
    assertManagerTerritory(req.user, existing.rows[0]);
    const { rows } = await query("UPDATE pharmacies SET active=FALSE WHERE id=$1 RETURNING *", [req.params.id]);
    await audit(req.user.id, "master_pharmacy.deactivated", "pharmacy", req.params.id, null);
    res.json({ pharmacy: rows[0] });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post("/master-pharmacies/:id/merge", requireRole("admin", "regional_head"), async (req, res, next) => {
  try {
    const targetId = String(req.body.targetId || "");
    if (!targetId || targetId === req.params.id) return res.status(400).json({ error: "Choose a different target shop." });
    const found = await query("SELECT * FROM pharmacies WHERE id = ANY($1::uuid[])", [[req.params.id, targetId]]);
    const source = found.rows.find((p) => p.id === req.params.id);
    const target = found.rows.find((p) => p.id === targetId);
    if (!source || !target) return res.status(404).json({ error: "Source or target shop was not found." });
    assertManagerTerritory(req.user, source); assertManagerTerritory(req.user, target);
    await withTransaction(async (client) => {
      await client.query("UPDATE activations SET pharmacy_id=$1 WHERE pharmacy_id=$2", [target.id, source.id]);
      await client.query("UPDATE pharmacies SET active=FALSE WHERE id=$1", [source.id]);
    });
    await audit(req.user.id, "master_pharmacy.merged", "pharmacy", source.id, { targetId });
    res.json({ merged: source.id, target: target.id });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post("/master-pharmacies/import", requireRole("admin", "regional_head"), masterUpload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Attach a CSV file." });
    const rows = parseCsv(req.file.buffer.toString("utf8").replace(/^\uFEFF/, ""));
    if (rows.length < 2) return res.status(400).json({ error: "The file has no data rows." });
    const header = rows[0].map((h) => String(h).trim().toLowerCase());
    const idx = (name) => header.indexOf(name);
    const idxAny = (...names) => names.map(idx).find((position) => position >= 0) ?? -1;
    const requiredHeaders = ["pharmacy name", "rio id", "party/alt code"];
    const missing = requiredHeaders.filter((h) => idx(h) < 0);
    if (missing.length) return res.status(400).json({ error: `Missing column(s): ${missing.join(", ")}.` });
    const items = rows.slice(1).map((r, index) => ({
      rowNumber: index + 2,
      name: String(r[idx("pharmacy name")] || "").trim(),
      rioId: String(r[idx("rio id")] || "").trim().toUpperCase(),
      partyAltCode: String(r[idx("party/alt code")] || "").trim(),
      address: idxAny("address", "address (optional)") >= 0 ? String(r[idxAny("address", "address (optional)")] || "").trim() : "",
      state: idxAny("state", "state (optional)") >= 0 ? String(r[idxAny("state", "state (optional)")] || "").trim() : "",
      city: idxAny("city", "city (optional)") >= 0 ? String(r[idxAny("city", "city (optional)")] || "").trim() : "",
    }));
    const invalid = items.find((p) => !p.name || !p.rioId || !p.partyAltCode);
    if (invalid) return res.status(400).json({ error: `Row ${invalid.rowNumber}: Pharmacy Name, RIO ID and Party/Alt Code are required.` });
    const seenRioIds = new Map();
    const duplicateRio = items.find((p) => {
      const firstRow = seenRioIds.get(p.rioId);
      if (firstRow) { p.duplicateOfRow = firstRow; return true; }
      seenRioIds.set(p.rioId, p.rowNumber);
      return false;
    });
    if (duplicateRio) return res.status(400).json({ error: `Row ${duplicateRio.rowNumber}: RIO ID ${duplicateRio.rioId} is already used on row ${duplicateRio.duplicateOfRow}.` });
    items.forEach((p) => assertManagerTerritory(req.user, p));
    const imported = await withTransaction(async (client) => {
      for (const p of items) {
        const nameKey = p.name.toLowerCase().replace(/\s+/g, " ");
        const rioMatch = await client.query("SELECT id FROM pharmacies WHERE rio_id=$1", [p.rioId]);
        if (rioMatch.rows[0]) {
          await client.query(
            `UPDATE pharmacies SET name=$1,name_key=$2,party_alt_code=$3,address=$4,state=$5,city=$6,active=TRUE
             WHERE id=$7`,
            [p.name,nameKey,p.partyAltCode,p.address||null,p.state||null,p.city||null,rioMatch.rows[0].id]
          );
        } else {
          await client.query(
            `INSERT INTO pharmacies (name,name_key,rio_id,party_alt_code,address,state,city,area,created_by,active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,TRUE)`,
            [p.name,nameKey,p.rioId,p.partyAltCode,p.address||null,p.state||null,p.city||null,req.user.id]
          );
        }
      }
      return items.length;
    });
    await audit(req.user.id, "master_pharmacy.imported", "pharmacy", null, { rows: imported });
    res.json({ imported });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === "23505") return res.status(409).json({ error: "The upload contains a RIO ID that is already assigned to another pharmacy. No rows were imported." });
    next(err);
  }
});

// Manager: review new shop/geography values submitted by their own field team.
router.get("/master-data", requireRole("regional_head"), async (req, res, next) => {
  try {
    const params = [req.user.id];
    let statusClause = "";
    if (req.query.status) {
      params.push(String(req.query.status));
      statusClause = ` AND m.status = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT m.*, a.code AS activation_code, a.occurred_at,
              u.name AS submitted_by_name, u.employee_id AS submitted_by_employee_id
       FROM master_data_reviews m
       JOIN activations a ON a.id = m.activation_id
       JOIN users u ON u.id = m.submitted_by
       WHERE ${descendantOrSelfSql("$1", "u")}${statusClause}
       ORDER BY CASE m.status WHEN 'pending' THEN 0 ELSE 1 END, m.created_at DESC`,
      params
    );
    res.json({ reviews: rows });
  } catch (err) {
    next(err);
  }
});

router.post("/master-data/:id/approve", requireRole("regional_head"), async (req, res, next) => {
  try {
    const review = await withTransaction(async (client) => {
      const found = await client.query(
        `SELECT m.* FROM master_data_reviews m
         JOIN users u ON u.id = m.submitted_by
         WHERE m.id = $1 AND ${descendantOrSelfSql("$2", "u")} FOR UPDATE OF m`,
        [req.params.id, req.user.id]
      );
      const row = found.rows[0];
      if (!row) throw Object.assign(new Error("Master-data review not found in your team."), { status: 404 });
      if (row.status !== "pending") {
        throw Object.assign(new Error("This master-data review is no longer pending."), { status: 409 });
      }
      const p = row.payload;
      let pharmacy = await client.query(
        `SELECT id FROM pharmacies
         WHERE name_key=$1 AND state=$2 AND city=$3 AND area IS NOT DISTINCT FROM $4
         ORDER BY created_at LIMIT 1`,
        [p.nameKey, p.state, p.city, p.area]
      );
      if (!pharmacy.rows[0]) {
        pharmacy = await client.query(
          `INSERT INTO pharmacies
             (name, name_key, address, state, city, area, latitude, longitude, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id`,
          [p.pharmacyName, p.nameKey, p.address || null, p.state, p.city, p.area,
           p.latitude ?? null, p.longitude ?? null, row.submitted_by]
        );
      }
      const plan = p.area ? await client.query(
        `INSERT INTO planned_targets (state, city, area, planned_shops)
         VALUES ($1,$2,$3,0)
         ON CONFLICT (state, city, area) DO NOTHING
         RETURNING id`,
        [p.state, p.city, p.area]
      ) : { rows: [] };
      if (plan.rows[0]) {
        for (const key of ASSET_KEYS) {
          await client.query(
            `INSERT INTO planned_assets (plan_id, asset_type, quantity)
             VALUES ($1,$2,0) ON CONFLICT (plan_id, asset_type) DO NOTHING`,
            [plan.rows[0].id, key]
          );
        }
      }
      await client.query(
        "UPDATE activations SET pharmacy_id = $1 WHERE id = $2",
        [pharmacy.rows[0].id, row.activation_id]
      );
      const updated = await client.query(
        `UPDATE master_data_reviews
         SET status='approved', reviewed_by=$1, reviewed_at=now(), review_note=$2
         WHERE id=$3 RETURNING *`,
        [req.user.id, String(req.body.note || "").trim() || null, row.id]
      );
      return updated.rows[0];
    });
    await audit(req.user.id, "master_data.approved", "master_data_review", review.id, {
      activationId: review.activation_id,
    });
    res.json({ review });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post("/master-data/:id/reject", requireRole("regional_head"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE master_data_reviews m
       SET status='rejected', reviewed_by=$1, reviewed_at=now(), review_note=$2
       WHERE m.id=$3 AND m.status='pending' AND EXISTS (
         SELECT 1 FROM users u WHERE u.id=m.submitted_by AND ${descendantOrSelfSql("$1", "u")}
       )
       RETURNING *`,
      [req.user.id, String(req.body.note || "").trim() || null, req.params.id]
    );
    if (!rows.length) {
      return res.status(409).json({ error: "This master-data review is unavailable or no longer pending." });
    }
    await audit(req.user.id, "master_data.rejected", "master_data_review", req.params.id, {
      activationId: rows[0].activation_id,
    });
    res.json({ review: rows[0] });
  } catch (err) {
    next(err);
  }
});


// Manager: create an approval request.
// Target changes continue to require Admin approval.
router.post("/", requireRole(...LEADER_ROLES), async (req, res, next) => {
  try {
    const b = req.body || {};

    if (!allowedTypes.has(b.type)) {
      return res.status(400).json({
        error: "Unsupported request type."
      });
    }

    if (!b.payload || typeof b.payload !== "object") {
      return res.status(400).json({
        error: "Request details are required."
      });
    }

    if (!String(b.reason || "").trim()) {
      return res.status(400).json({
        error: "A reason is required for approval requests."
      });
    }

    validateRequest(b.type, b.payload);
    if (b.type === "target_change" && req.user.role !== "regional_head") {
      return res.status(403).json({ error: "Only a Regional Head can submit target changes." });
    }
    if (b.type === "target_change") assertManagerTerritory(req.user, b.payload);

    const { rows } = await query(
      `INSERT INTO approval_requests
        (type, payload, reason, requested_by)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [
        b.type,
        JSON.stringify(b.payload),
        String(b.reason).trim(),
        req.user.id
      ]
    );

    await audit(
      req.user.id,
      "request.created",
      "approval_request",
      rows[0].id,
      { type: b.type }
    );

    res.status(201).json({ request: publicRequest(rows[0]) });
  } catch (err) {
    next(err);
  }
});

  router.post("/:id/reject", requireAdmin, async (req, res, next) => {
    try {
      const note = String(req.body.note || "").trim() || null;
      const { rows } = await query(
        `UPDATE approval_requests SET status='rejected', reviewed_by=$1, reviewed_at=now(), review_note=$2
        WHERE id=$3 AND status='pending' RETURNING *`, [req.user.id, note, req.params.id]
      );
      if (!rows.length) return res.status(409).json({ error: "This request is no longer pending." });
      await audit(req.user.id, "request.rejected", "approval_request", req.params.id, { note });
      res.json({ request: publicRequest(rows[0]) });
    } catch (err) { next(err); }
  });

  router.post("/:id/approve", requireAdmin, async (req, res, next) => {
    try {
      const result = await withTransaction(async (client) => {
        const { rows } = await client.query("SELECT * FROM approval_requests WHERE id=$1 FOR UPDATE", [req.params.id]);
        const r = rows[0];
        if (!r) throw Object.assign(new Error("Request not found."), { status: 404 });
        if (r.status !== "pending") throw Object.assign(new Error("This request is no longer pending."), { status: 409 });
        const payload = req.body && req.body.payload ? req.body.payload : r.payload;
        validateRequest(r.type, payload);
        if (r.type === "user_deactivate") await applyUserDeactivate(client, payload, r.requested_by, req.user.id);
        if (r.type === "target_change") await applyTargetChange(client, payload, r.requested_by, req.user.id);
        const updated = await client.query(
          `UPDATE approval_requests SET status='approved', payload=$1, reviewed_by=$2, reviewed_at=now(), review_note=$3
          WHERE id=$4 RETURNING *`, [JSON.stringify(payload), req.user.id, String((req.body && req.body.note) || "").trim() || null, r.id]
        );
        return updated.rows[0];
      });
      await audit(req.user.id, "request.approved", "approval_request", req.params.id, { type: result.type });
      res.json({ request: publicRequest(result) });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  });

  function validateRequest(type, payload) {
    if (type === "user_deactivate") {
      if (!payload.userId) throw Object.assign(new Error("Select a field user."), { status: 400 });
      return;
    }
    if (type === "target_change") {
      if (!payload.state || !payload.city || !payload.area) throw Object.assign(new Error("State, city and area are required."), { status: 400 });
      if (!['base','revision','addition'].includes(payload.changeType)) throw Object.assign(new Error("Choose base, revision or addition."), { status: 400 });
      return;
    }
  }

  async function applyUserDeactivate(client, p, requestedBy, adminId) {
    const { rows } = await client.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [p.userId]);
    const u = rows[0];
    if (!u) throw Object.assign(new Error("User not found."), { status: 404 });
    if (u.role !== 'field') throw Object.assign(new Error("Only field users can be deactivated through a manager request."), { status: 400 });
    const requester = await client.query("SELECT role,assigned_state,assigned_city FROM users WHERE id=$1", [requestedBy]);
    const m = requester.rows[0];
    if (!m || !LEADER_ROLES.includes(m.role) ||
        (m.assigned_state && m.assigned_state !== u.assigned_state) ||
        (m.assigned_city && m.assigned_city !== u.assigned_city)) {
      throw Object.assign(new Error("You cannot deactivate a field user outside your territory."), { status: 403 });
    }
    await client.query("UPDATE users SET active=FALSE, updated_at=now() WHERE id=$1", [u.id]);
  }
  async function applyTargetChange(client, p, requestedBy, approvedBy) {
    const requester = await client.query("SELECT role,assigned_state,assigned_city FROM users WHERE id=$1", [requestedBy]);
    const manager = requester.rows[0];
    if (!manager || !LEADER_ROLES.includes(manager.role)) {
      throw Object.assign(new Error("The requesting manager has no assigned territory."), { status: 403 });
    }
    assertManagerTerritory(manager, p);
    const assets = p.assets || {};
    const shops = Math.max(0, parseInt(p.plannedShops, 10) || 0);
    const existing = await client.query("SELECT * FROM planned_targets WHERE state=$1 AND city=$2 AND area=$3 FOR UPDATE", [p.state, p.city, p.area]);
    let planId;
    let old = { plannedShops: 0, assets: {} };
    if (existing.rows[0]) {
      planId = existing.rows[0].id;
      const oldAssets = await client.query("SELECT asset_type, quantity FROM planned_assets WHERE plan_id=$1", [planId]);
      old = { plannedShops: existing.rows[0].planned_shops, assets: Object.fromEntries(oldAssets.rows.map(x=>[x.asset_type,x.quantity])) };
    } else {
      const ins = await client.query("INSERT INTO planned_targets (state,city,area,planned_shops) VALUES ($1,$2,$3,$4) RETURNING id", [p.state,p.city,p.area,0]);
      planId = ins.rows[0].id;
    }
    const nextShops = p.changeType === 'addition' ? old.plannedShops + shops : shops;
    await client.query("UPDATE planned_targets SET planned_shops=$1 WHERE id=$2", [nextShops, planId]);
    const nextAssets = {};
    for (const key of ASSET_KEYS) {
      const incoming = Math.max(0, parseInt(assets[key],10) || 0);
      const qty = p.changeType === 'addition' ? (old.assets[key] || 0) + incoming : incoming;
      nextAssets[key] = qty;
      await client.query(`INSERT INTO planned_assets (plan_id,asset_type,quantity) VALUES ($1,$2,$3)
        ON CONFLICT (plan_id,asset_type) DO UPDATE SET quantity=EXCLUDED.quantity`, [planId,key,qty]);
    }
    await client.query(
      `INSERT INTO target_history (plan_id,state,city,area,change_type,old_values,new_values,reason,requested_by,approved_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [planId,p.state,p.city,p.area,p.changeType,JSON.stringify(old),JSON.stringify({plannedShops:nextShops,assets:nextAssets}),p.reason || null,requestedBy,approvedBy]
    );
  }

  function parseCsv(text) {
    const out = [];
    let row = [], cur = "", quoted = false;
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
    row.push(cur); out.push(row);
    return out.filter((r) => r.some((cell) => String(cell).trim() !== ""));
  }

  module.exports = router;
