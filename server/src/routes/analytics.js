const express = require("express");
const { query } = require("../db");
const { requireAuth, requireAdmin, requireRole } = require("../auth");
const { ASSETS, ASSET_LABEL } = require("../constants");
const { buildFilters, buildPlanFilters } = require("../filters");

const router = express.Router();
router.use(requireAuth);

const pct = (a, b) => (!b ? 0 : Math.round((a / b) * 1000) / 10);

/**
 * All aggregation happens in Postgres. The dashboard never downloads the raw
 * activation table, so the numbers stay correct and fast as the data grows.
 */
async function summary(q) {
 const { clause, params } = buildFilters(q);
  const effectiveClause = q.status
    ? clause
    : (clause ? clause + " AND a.status <> 'Rejected'" : "WHERE a.status <> 'Rejected'");
  const plan = buildPlanFilters(q);
  const planParams = q.asset ? [...plan.params, q.asset] : plan.params;

  const dim = async (col) => {
    const columns = col === "state" ? ["state"] : col === "city" ? ["state", "city"] : ["state", "city", "area"];
    const actualGroup = columns.map((name) => `a.${name}`).join(", ");
    const planGroup = columns.map((name) => `p.${name}`).join(", ");
    const actualMapKey = `concat_ws(chr(31), ${columns.map((name) => `a.${name}`).join(", ")})`;
    const planMapKey = `concat_ws(chr(31), ${columns.map((name) => `p.${name}`).join(", ")})`;
    const acts = await query(
      `SELECT ${actualMapKey} AS map_key, a.${col} AS key,
              MIN(a.state) AS state, MIN(a.city) AS city,
              COUNT(DISTINCT a.shop_key)::int AS activated_shops,
              COUNT(DISTINCT a.id)::int AS activations,
              COALESCE(SUM(aa.quantity), 0)::int AS installed
       FROM activations a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN activation_assets aa ON aa.activation_id = a.id
         ${q.asset ? "AND aa.asset_type = $" + (params.length + 1) : ""}
       ${effectiveClause}
       GROUP BY ${actualGroup}`,
      q.asset ? [...params, q.asset] : params
    );
    const plans = await query(
      `SELECT ${planMapKey} AS map_key, p.${col} AS key,
              MIN(p.state) AS state, MIN(p.city) AS city,
              SUM(p.planned_shops)::int AS planned_shops,
              COALESCE(SUM(pa.quantity), 0)::int AS planned_assets
       FROM planned_targets p
       LEFT JOIN (
         SELECT plan_id, SUM(quantity)::int AS quantity
         FROM planned_assets
         ${q.asset ? "WHERE asset_type = $" + (plan.params.length + 1) : ""}
         GROUP BY plan_id
       ) pa ON pa.plan_id = p.id
       ${plan.clause}
       GROUP BY ${planGroup}`,
      planParams
    );
    const map = new Map();
    plans.rows.forEach((r) =>
      map.set(r.map_key, {
        key: r.key, state: r.state, city: r.city, plannedShops: r.planned_shops, plannedAssets: r.planned_assets,
        activatedShops: 0, installed: 0, activations: 0,
      })
    );
    acts.rows.forEach((r) => {
      const cur = map.get(r.map_key) || {
        key: r.key, state: r.state, city: r.city, plannedShops: 0, plannedAssets: 0,
        activatedShops: 0, installed: 0, activations: 0,
      };
      cur.state = cur.state || r.state;
      cur.city = cur.city || r.city;
      cur.activatedShops = r.activated_shops;
      cur.installed = r.installed;
      cur.activations = r.activations;
      map.set(r.map_key, cur);
    });
    return [...map.values()]
      .map((r) => ({ ...r, shopPen: pct(r.activatedShops, r.plannedShops), assetPen: pct(r.installed, r.plannedAssets) }))
      .sort((a, b) => b.activatedShops - a.activatedShops);
  };

  const [byState, byCity, byArea] = await Promise.all([dim("state"), dim("city"), dim("area")]);

  // Asset level plan vs actual
  const actualByAsset = await query(
    `SELECT aa.asset_type, COALESCE(SUM(aa.quantity), 0)::int AS installed
     FROM activations a JOIN users u ON u.id = a.user_id
     JOIN activation_assets aa ON aa.activation_id = a.id
     ${effectiveClause} GROUP BY aa.asset_type`,
    params
  );
  const plannedByAsset = await query(
    `SELECT pa.asset_type, COALESCE(SUM(pa.quantity), 0)::int AS planned
     FROM planned_targets p JOIN planned_assets pa ON pa.plan_id = p.id
     ${plan.clause} GROUP BY pa.asset_type`,
    plan.params
  );
  const aMap = Object.fromEntries(actualByAsset.rows.map((r) => [r.asset_type, r.installed]));
  const pMap = Object.fromEntries(plannedByAsset.rows.map((r) => [r.asset_type, r.planned]));
  const byAsset = ASSETS.filter((a) => !q.asset || a.key === q.asset).map((a) => {
    const planned = pMap[a.key] || 0;
    const installed = aMap[a.key] || 0;
    return { key: a.key, label: a.label, planned, installed, remaining: Math.max(0, planned - installed), pen: pct(installed, planned) };
  });

  // Salesperson performance, target is an equal share of their city plan
  const sales = await query(
    `SELECT u.id, u.name, u.employee_id, u.assigned_city AS city,
            COUNT(DISTINCT a.shop_key)::int AS shops,
            COALESCE(SUM(aa.quantity), 0)::int AS installed
     FROM users u
     LEFT JOIN activations a ON a.user_id = u.id AND a.id IN (
       SELECT a2.id FROM activations a2 JOIN users u2 ON u2.id = a2.user_id ${effectiveClause.replace(/\ba\./g, "a2.").replace(/\bu\./g, "u2.")}
     )
     LEFT JOIN activation_assets aa ON aa.activation_id = a.id
       ${q.asset ? "AND aa.asset_type = $" + (params.length + 1) : ""}
     WHERE u.role = 'field'
     GROUP BY u.id ORDER BY shops DESC`,
    q.asset ? [...params, q.asset] : params
  );
  const cityPlans = await query(
    "SELECT city, SUM(planned_shops)::int AS planned FROM planned_targets GROUP BY city"
  );
  const cityPlanMap = Object.fromEntries(cityPlans.rows.map((r) => [r.city, r.planned]));
  const headcount = {};
  sales.rows.forEach((r) => { headcount[r.city] = (headcount[r.city] || 0) + 1; });
  const bySales = sales.rows.map((r) => {
    const target = Math.round((cityPlanMap[r.city] || 0) / (headcount[r.city] || 1));
    return { id: r.id, name: r.name, employeeId: r.employee_id, city: r.city, shops: r.shops, installed: r.installed, target, completion: pct(r.shops, target) };
  });

  const totalsAct = await query(
    `SELECT COUNT(DISTINCT a.shop_key)::int AS shops,
            COUNT(DISTINCT a.id)::int AS activations,
            COUNT(DISTINCT a.user_id)::int AS users,
            COUNT(DISTINCT a.id) FILTER (WHERE a.occurred_on = CURRENT_DATE)::int AS today
     FROM activations a JOIN users u ON u.id = a.user_id ${effectiveClause}`,
    params
  );
  const totalsPlan = await query(
    `SELECT COALESCE(SUM(p.planned_shops), 0)::int AS shops FROM planned_targets p ${plan.clause}`,
    plan.params
  );

  const plannedAssets = byAsset.reduce((s, a) => s + a.planned, 0);
  const installedAssets = byAsset.reduce((s, a) => s + a.installed, 0);
  const t = totalsAct.rows[0];

  return {
    totals: {
      plannedShops: totalsPlan.rows[0].shops,
      activatedShops: t.shops,
      shopPen: pct(t.shops, totalsPlan.rows[0].shops),
      plannedAssets,
      installedAssets,
      assetPen: pct(installedAssets, plannedAssets),
      activeUsers: t.users,
      activations: t.activations,
      today: t.today,
    },
    byState, byCity, byArea, byAsset, bySales,
  };
}

// Manager dashboard: only salespeople assigned to the logged-in manager.
router.get("/manager/team", requireRole("manager"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
         u.id,
         u.name,
         u.employee_id,
         u.assigned_state AS state,
         u.assigned_city AS city,
         u.active,
         COUNT(DISTINCT a.shop_key)::int AS shops_activated,
         COUNT(DISTINCT a.id)::int AS activations
       FROM users u
       LEFT JOIN activations a
         ON a.user_id = u.id
         AND a.status <> 'Rejected'
       WHERE u.role = 'field'
         AND u.manager_id = $1
       GROUP BY
         u.id,
         u.name,
         u.employee_id,
         u.assigned_state,
         u.assigned_city,
         u.active
       ORDER BY u.active DESC, shops_activated DESC, u.name ASC`,
      [req.user.id]
    );

    const totalSalesmen = rows.filter((r) => r.active).length;

    const totalStoresActivated = rows.reduce(
      (sum, r) => sum + r.shops_activated,
      0
    );

    const totalActivations = rows.reduce(
      (sum, r) => sum + r.activations,
      0
    );

    res.json({
      totals: {
        salesmen: totalSalesmen,
        storesActivated: totalStoresActivated,
        activations: totalActivations
      },
      salesmen: rows
    });
  } catch (err) {
    next(err);
  }
});

// Manager: activation records for one salesperson in their own team.
router.get("/manager/team/:userId/activations", requireRole("manager"), async (req, res, next) => {
  try {
    const member = await query(
      `SELECT id, name, employee_id, assigned_state, assigned_city
       FROM users
       WHERE id = $1
         AND role = 'field'
         AND manager_id = $2`,
      [req.params.userId, req.user.id]
    );

    if (!member.rows.length) {
      return res.status(404).json({
        error: "Salesperson not found in your team."
      });
    }

    const { rows } = await query(
      `SELECT
         a.id,
         a.code,
         a.occurred_at,
         a.state,
         a.city,
         a.area,
         a.pharmacy_name,
         a.address,
         a.latitude,
         a.longitude,
         a.gps_accuracy,
         a.status,
         COALESCE(mdr.status, 'verified') AS master_data_status,
         COALESCE(
           json_agg(
             json_build_object(
               'assetType', aa.asset_type,
'quantity', aa.quantity,
'hasPhoto', EXISTS (
  SELECT 1
  FROM photos p
  WHERE p.activation_id = a.id
    AND p.asset_type = aa.asset_type
)
             )
           ) FILTER (WHERE aa.asset_type IS NOT NULL),
           '[]'
         ) AS assets
       FROM activations a
       LEFT JOIN activation_assets aa ON aa.activation_id = a.id
       LEFT JOIN master_data_reviews mdr ON mdr.activation_id = a.id
       WHERE a.user_id = $1
       GROUP BY a.id, mdr.status
       ORDER BY a.occurred_at DESC`,
      [req.params.userId]
    );

    res.json({
      salesperson: member.rows[0],
      activations: rows
    });
  } catch (err) {
    next(err);
  }
});

// Managers receive the same state/city/area plan-vs-actual breakdown as admins,
// but the server always pins it to their assigned territory. Client filters can
// narrow the result; they can never widen it.
router.get("/manager/summary", requireRole("manager"), async (req, res, next) => {
  try {
    const scoped = {
      ...req.query,
      state: req.user.assigned_state,
      city: req.user.assigned_city || req.query.city || "",
    };
    const data = await summary(scoped);
    const { bySales, ...territoryData } = data;
    res.json(territoryData);
  } catch (err) {
    next(err);
  }
});

router.get("/summary", requireAdmin, async (req, res, next) => {
  try {
    res.json(await summary(req.query));
  } catch (err) {
    next(err);
  }
});

// Personal totals for the field user dashboard.
router.get("/me", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT COUNT(DISTINCT shop_key)::int AS shops,
              COUNT(*)::int AS activations,
              COUNT(*) FILTER (WHERE occurred_on = CURRENT_DATE)::int AS today,
              COUNT(*) FILTER (WHERE occurred_at >= now() - interval '7 days')::int AS week
       FROM activations WHERE user_id = $1`,
      [req.user.id]
    );
    const assets = await query(
      `SELECT COALESCE(SUM(aa.quantity), 0)::int AS units
       FROM activations a JOIN activation_assets aa ON aa.activation_id = a.id WHERE a.user_id = $1`,
      [req.user.id]
    );
    res.json({ ...rows[0], units: assets.rows[0].units });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------- export ------------------------------- */

function csvEscape(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get("/export/activations.csv", requireAdmin, async (req, res, next) => {
  try {
    const { clause, params } = buildFilters(req.query);
    const { rows } = await query(
      `SELECT a.code, a.occurred_at, u.employee_id, u.name AS salesperson, a.state, a.city, a.area,
              a.pharmacy_name, a.address, a.latitude, a.longitude, a.gps_accuracy, a.gps_source,
              a.status, a.duplicate_override, aa.asset_type, aa.quantity,
              (p.id IS NOT NULL) AS has_photo, p.storage_key, p.captured_at
       FROM activations a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN activation_assets aa ON aa.activation_id = a.id
       LEFT JOIN photos p ON p.activation_id = a.id AND p.asset_type = aa.asset_type
       ${clause}
       ORDER BY a.occurred_at DESC, aa.asset_type`,
      params
    );
    const header = [
      "Activation ID", "Date", "Time", "Employee ID", "Salesperson", "State", "City", "Area",
      "Pharmacy", "Address", "Latitude", "Longitude", "GPS accuracy (m)", "GPS source", "Status",
      "Repeat visit", "Asset", "Quantity", "Photo captured", "Photo storage key", "Photo captured at",
    ];
    const lines = [header.join(",")];
    rows.forEach((r) => {
      const d = new Date(r.occurred_at);
      lines.push([
        r.code, d.toISOString().slice(0, 10), d.toISOString().slice(11, 16), r.employee_id, r.salesperson,
        r.state, r.city, r.area, r.pharmacy_name, r.address, r.latitude, r.longitude, r.gps_accuracy,
        r.gps_source, r.status, r.duplicate_override ? "Yes" : "No",
        r.asset_type ? ASSET_LABEL[r.asset_type] || r.asset_type : "", r.quantity,
        r.has_photo ? "Yes" : "No", r.storage_key, r.captured_at ? new Date(r.captured_at).toISOString() : "",
      ].map(csvEscape).join(","));
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="activation-records.csv"');
    res.send("\ufeff" + lines.join("\n"));
  } catch (err) {
    next(err);
  }
});

router.get("/export/plan-vs-actual.csv", requireAdmin, async (req, res, next) => {
  try {
    const data = await summary(req.query);
    const lines = ["City,State,Planned shops,Activated shops,Shop penetration %,Assets planned,Assets installed,Asset penetration %"];
    data.byCity.forEach((r) =>
      lines.push([r.key, r.state, r.plannedShops, r.activatedShops, r.shopPen, r.plannedAssets, r.installed, r.assetPen].map(csvEscape).join(","))
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="plan-vs-actual.csv"');
    res.send("\ufeff" + lines.join("\n"));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
