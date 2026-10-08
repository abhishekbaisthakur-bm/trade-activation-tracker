const express = require("express");
const multer = require("multer");
const { query, withTransaction } = require("../db");
const { requireAuth, requireRole, audit } = require("../auth");
const { ASSETS, ASSET_KEYS, STATUSES, shopKeyOf } = require("../constants");
const { driver, buildKey, ALLOWED_MIME } = require("../storage");
const { buildFilters } = require("../filters");
const { config } = require("../config");
const { LEADER_ROLES, isLeader, descendantSql } = require("../hierarchy");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: ASSETS.length + 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG or WebP photos are accepted."));
    }
    cb(null, true);
  },
});

const INSTALLED_ASSETS = ASSETS.filter((a) => a.mode === "installed").map((a) => a.key);

router.use(requireAuth);

/* ------------------------------- create -------------------------------- */

router.post("/", requireRole("field"), upload.any(), async (req, res, next) => {
  try {
    let payload;
    try {
      payload = JSON.parse(req.body.payload || "{}");
    } catch (err) {
      return res.status(400).json({ error: "The submission payload was not valid JSON." });
    }

    const assets = Array.isArray(payload.assets) ? payload.assets : [];
    const lat = Number(payload.latitude);
    const lng = Number(payload.longitude);

    // --- validation rules, enforced here and not only in the app ---
    const partyCode = String(payload.partyCode || "").trim();
    if (!payload.pharmacyName || !payload.state || !payload.city) {
      return res.status(400).json({ error: "Pharmacy name, state and city are required." });
    }
    if (!partyCode) return res.status(400).json({ error: "Party Code (Alter Code) is required." });
    if (!assets.length) {
      return res.status(400).json({ error: "Select at least one collateral asset." });
    }
    const badAsset = assets.find((a) => !ASSET_KEYS.includes(a.key) || !(parseInt(a.qty, 10) > 0));
    if (badAsset) {
      return res.status(400).json({ error: "Every selected asset needs a valid quantity of at least one." });
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.status(400).json({ error: "A valid GPS location is required." });
    }

    const files = req.files || [];
    const fileFor = (key) => files.find((f) => f.fieldname === `photo_${key}`);
    const missingProof = assets
      .filter((a) => INSTALLED_ASSETS.includes(a.key))
      .filter((a) => !fileFor(a.key))
      .map((a) => a.key);
    if (missingProof.length) {
      return res.status(400).json({ error: `Photo proof is required for: ${missingProof.join(", ")}.` });
    }

    const gpsSource = payload.gpsSource === "device" ? "device" : "manual";
    const occurredAt = new Date();
    const shopKey = shopKeyOf(payload.city, payload.pharmacyName);
    if (payload.allowDuplicate) {
      return res.status(403).json({ error: "Repeat visits require manager approval." });
    }
    const duplicateOverride = false;
    const duplicatePartyCode = await query(
      `SELECT a.id FROM activations a
       WHERE lower(trim(a.party_code)) = lower(trim($1)) AND a.user_id <> $2
       ORDER BY a.occurred_at ASC LIMIT 1`,
      [partyCode, req.user.id]
    );
    const duplicatePartyCodeOf = duplicatePartyCode.rows[0] ? duplicatePartyCode.rows[0].id : null;

    // Reject a same day repeat before writing anything, so the user gets a clear
    // message instead of a constraint error.
    if (!duplicateOverride) {
      const dup = await query(
        `SELECT code FROM activations
         WHERE user_id = $1 AND shop_key = $2 AND occurred_on = CURRENT_DATE AND duplicate_override = FALSE`,
        [req.user.id, shopKey]
      );
      if (dup.rows.length) {
        return res.status(409).json({
          error: "You already logged this shop today.",
          code: "DUPLICATE",
          existing: dup.rows[0].code,
        });
      }
    }

    const stored = [];
    try {
      const result = await withTransaction(async (client) => {
        // Only an exact master match is linked immediately. New names or
        // geography stay on the activation and wait for manager verification.
        const nameKey = String(payload.pharmacyName).trim().toLowerCase().replace(/\s+/g, " ");
        const ph = await client.query(
          `SELECT p.id FROM pharmacies p
           JOIN pharmacy_party_codes ppc ON ppc.pharmacy_id=p.id AND ppc.active=TRUE
           WHERE p.active = TRUE
             AND (($5::uuid IS NOT NULL AND p.id=$5) OR
                  ($5::uuid IS NULL AND p.city=$1 AND p.name_key=$2 AND p.state=$3 AND p.area IS NOT DISTINCT FROM $4))
             AND lower(trim(ppc.party_alt_code))=lower(trim($6))
           LIMIT 1`,
          [payload.city, nameKey, payload.state, payload.area || null, payload.pharmacyId || null, partyCode]
        );

        const seq = await client.query(
          "SELECT count(*)::int + 1 AS n FROM activations WHERE occurred_on = CURRENT_DATE"
        );
        const stamp = occurredAt.toISOString().slice(0, 10).replace(/-/g, "");
        const code = `ACT-${stamp}-${String(seq.rows[0].n).padStart(4, "0")}`;

        const act = await client.query(
          `INSERT INTO activations
             (code, user_id, pharmacy_id, pharmacy_name, party_code, party_code_duplicate, duplicate_party_code_of, shop_key, address, state, city, area,
              occurred_at, occurred_on, latitude, longitude, gps_accuracy, gps_source, geo_address,
              status, duplicate_override)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_DATE,$14,$15,$16,$17,$18,'Submitted',$19)
           RETURNING *`,
          [
            code, req.user.id, ph.rows[0] ? ph.rows[0].id : null, String(payload.pharmacyName).trim(),
            partyCode, Boolean(duplicatePartyCodeOf), duplicatePartyCodeOf, shopKey,
            payload.address || null, payload.state, payload.city, payload.area || null, occurredAt,
            lat, lng, parseInt(payload.accuracy, 10) || null, gpsSource, payload.geoAddress || null,
            duplicateOverride,
          ]
        );
        const activation = act.rows[0];

        if (!ph.rows[0]) {
          const owner = await client.query("SELECT manager_id FROM users WHERE id = $1", [req.user.id]);
          await client.query(
            `INSERT INTO master_data_reviews
               (activation_id, submitted_by, manager_id, payload)
             VALUES ($1,$2,$3,$4)`,
            [
              activation.id,
              req.user.id,
              owner.rows[0] ? owner.rows[0].manager_id : null,
              JSON.stringify({
                pharmacyName: String(payload.pharmacyName).trim(),
                nameKey,
                address: payload.address || null,
                state: payload.state,
                city: payload.city,
                area: payload.area || null,
                latitude: lat,
                longitude: lng,
              }),
            ]
          );
        }

        for (const a of assets) {
          await client.query(
            "INSERT INTO activation_assets (activation_id, asset_type, quantity) VALUES ($1,$2,$3)",
            [activation.id, a.key, parseInt(a.qty, 10)]
          );
          const file = fileFor(a.key);
          if (!file) continue;
          const key = buildKey(activation.id, a.key, file.mimetype);
          await driver.put(key, file.buffer, file.mimetype);
          stored.push(key);
          await client.query(
            `INSERT INTO photos (activation_id, asset_type, storage_key, storage_driver, mime_type, byte_size, captured_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [activation.id, a.key, key, driver.name, file.mimetype, file.size, payload.photoTimes && payload.photoTimes[a.key] ? new Date(payload.photoTimes[a.key]) : occurredAt]
          );
        }
        return activation;
      });

      await audit(req.user.id, "activation.created", "activation", result.id, { code: result.code });
      const full = await fetchActivation(result.id);
      return res.status(201).json({ activation: full });
    } catch (err) {
      // The transaction rolled back, so remove any file already pushed to storage.
      await Promise.all(stored.map((k) => driver.remove(k).catch(() => {})));
      if (err.code === "23505" && String(err.constraint || "").includes("no_duplicate")) {
        return res.status(409).json({ error: "You already logged this shop today.", code: "DUPLICATE" });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/* -------------------------------- list --------------------------------- */

router.get("/", async (req, res, next) => {
  try {
    const isAdmin = req.user.role === "admin";
    const leader = isLeader(req.user.role);
    const { clause, params } = buildFilters(req.query, {
      forceUser: isAdmin || leader ? null : req.user.id,
      ancestorId: leader ? req.user.id : null,
      regionScope: req.user.role === "regional_head" ? req.user.region : null,
    });
    const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const rows = await query(
      `SELECT a.id, a.code, a.pharmacy_name, a.party_code, a.party_code_duplicate, a.city, a.area, a.state, a.occurred_at, a.status,
              a.latitude, a.longitude, a.gps_source, u.name AS user_name, u.employee_id,
              COALESCE(SUM(aa.quantity), 0)::int AS units,
              COUNT(aa.id)::int AS asset_count
       FROM activations a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN activation_assets aa ON aa.activation_id = a.id
       ${clause}
       GROUP BY a.id, u.name, u.employee_id
       ORDER BY a.occurred_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const total = await query(
      `SELECT COUNT(DISTINCT a.id)::int AS n FROM activations a JOIN users u ON u.id = a.user_id ${clause}`,
      params
    );
    const canSeePartyFlag = req.user.role === "admin" || ["regional_head", "city_head"].includes(req.user.role);
    res.json({
      activations: rows.rows.map((row) => canSeePartyFlag ? row : { ...row, party_code_duplicate: false }),
      total: total.rows[0].n, limit, offset
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------- detail -------------------------------- */

async function fetchActivation(id) {
  const { rows } = await query(
    `SELECT a.*, u.name AS user_name, u.employee_id
     FROM activations a JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
    [id]
  );
  if (!rows.length) return null;
  const assets = await query(
    `SELECT aa.asset_type, aa.quantity, p.id AS photo_id, p.captured_at, p.byte_size
     FROM activation_assets aa
     LEFT JOIN photos p ON p.activation_id = aa.activation_id AND p.asset_type = aa.asset_type
     WHERE aa.activation_id = $1 ORDER BY aa.asset_type`,
    [id]
  );
  const masterReview = await query(
    "SELECT status FROM master_data_reviews WHERE activation_id = $1",
    [id]
  );
  return {
    ...rows[0],
    assets: assets.rows,
    master_data_status: masterReview.rows[0] ? masterReview.rows[0].status : "verified",
  };
}

router.get("/:id", async (req, res, next) => {
  try {
    const activation = await fetchActivation(req.params.id);
    if (!activation) return res.status(404).json({ error: "Activation not found." });
    let canView = req.user.role === "admin" || activation.user_id === req.user.id;
    if (!canView && isLeader(req.user.role)) {
      const member = req.user.role === "regional_head"
        ? await query(
          `SELECT 1 FROM users u WHERE id=$1 AND role='field'
           AND regexp_replace(lower(COALESCE(u.region, '')), '\\s+', '', 'g') =
               regexp_replace(lower($2), '\\s+', '', 'g')`,
          [activation.user_id, req.user.region || ""]
        )
        : await query(
          `SELECT 1 FROM users u WHERE id = $1 AND role = 'field' AND ${descendantSql("$2", "u")}`,
          [activation.user_id, req.user.id]
        );
      canView = member.rows.length > 0;
    }
    if (!canView) {
      return res.status(403).json({ error: "You can only open your own activations." });
    }
    const canSeePartyFlag = req.user.role === "admin" || ["regional_head", "city_head"].includes(req.user.role);
    if (!canSeePartyFlag) {
      activation.party_code_duplicate = false;
      activation.duplicate_party_code_of = null;
    }
    res.json({ activation });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------- photo -------------------------------- */

router.get("/:id/photo/:asset", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*, a.user_id
       FROM photos p
       JOIN activations a ON a.id = p.activation_id
       JOIN users u ON u.id = a.user_id
       WHERE p.activation_id = $1
         AND p.asset_type = $2`,
      [req.params.id, req.params.asset]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "No photo stored for that asset." });
    }

    const photo = rows[0];

    const canView =
      req.user.role === "admin" ||
      photo.user_id === req.user.id ||
      (isLeader(req.user.role) && (await query(
        req.user.role === "regional_head"
          ? `SELECT 1 FROM users u WHERE u.id=$1
             AND regexp_replace(lower(COALESCE(u.region, '')), '\\s+', '', 'g') =
                 regexp_replace(lower($2), '\\s+', '', 'g')`
          : `SELECT 1 FROM users u WHERE u.id = $1 AND ${descendantSql("$2", "u")}`,
        [photo.user_id, req.user.role === "regional_head" ? (req.user.region || "") : req.user.id]
      )).rows.length > 0);

    if (!canView) {
      return res.status(403).json({
        error: "You do not have access to this activation photo."
      });
    }

    const buffer = await driver.get(photo.storage_key);

    res.setHeader("Content-Type", photo.mime_type);
    res.setHeader("Cache-Control", "private, max-age=3600");

    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

/* -------------------------------- review ------------------------------- */

router.patch("/:id/status", requireRole(...LEADER_ROLES), async (req, res, next) => {
  try {
    const status = String(req.body.status || "");
    if (!STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status." });
    const { rows } = await query(
      `UPDATE activations a
       SET status = $1, reviewed_by = $2, reviewed_at = now(), review_note = $3
       FROM users u
       WHERE a.id = $4
         AND u.id = a.user_id
         AND u.role = 'field'
         AND ${descendantSql("$2", "u")}
       RETURNING a.id, a.code, a.status`,
      [status, req.user.id, req.body.note || null, req.params.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Activation not found in your team." });
    }
    await audit(req.user.id, "activation.status", "activation", req.params.id, { status });
    res.json({ activation: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, fetchActivation };
