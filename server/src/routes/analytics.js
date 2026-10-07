const express = require("express");
const ExcelJS = require("exceljs");
const { query } = require("../db");
const { requireAuth, requireAdmin, requireRole } = require("../auth");
const { ASSETS, ASSET_LABEL } = require("../constants");
const { buildFilters, buildPlanFilters } = require("../filters");
const { LEADER_ROLES, descendantSql, descendantOrSelfSql, ROLE_LABELS } = require("../hierarchy");

const router = express.Router();
router.use(requireAuth);

const pct = (a, b) => (!b ? 0 : Math.round((a / b) * 1000) / 10);

function buildMasterPlanFilters(q, opts = {}) {
  const where = ["ph.active = TRUE"];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)); };
  // Uploaded master files are often inconsistent about case and spaces
  // (for example "Tamil Nadu" vs "Tamilnadu"). Treat those as the same
  // geography so a leader's scope and performance totals stay aligned.
  if (q.state) add("regexp_replace(lower(COALESCE(ph.state, '')), '\\s+', '', 'g') = regexp_replace(lower(?), '\\s+', '', 'g')", q.state);
  if (q.city) add("lower(trim(COALESCE(ph.city, ''))) = lower(trim(?))", q.city);
  if (q.area) add("lower(trim(COALESCE(ph.area, 'Not specified'))) = lower(trim(?))", q.area);
  const leader = opts.leader;
  if (leader?.role === "regional_head") {
    params.push(leader.id);
    where.push(`EXISTS (
      SELECT 1 FROM users creator
      WHERE creator.id = ph.created_by
        AND ${descendantOrSelfSql(`$${params.length}`, "creator")}
    )`);
  } else if (leader) {
    if (leader.assigned_state) add("regexp_replace(lower(COALESCE(ph.state, '')), '\\s+', '', 'g') = regexp_replace(lower(?), '\\s+', '', 'g')", leader.assigned_state);
    if (leader.assigned_city) add("lower(trim(COALESCE(ph.city, ''))) = lower(trim(?))", leader.assigned_city);
  }
  return { clause: `WHERE ${where.join(" AND ")}`, params };
}

/**
 * All aggregation happens in Postgres. The dashboard never downloads the raw
 * activation table, so the numbers stay correct and fast as the data grows.
 */
async function summary(q, opts = {}) {
 const { clause, params } = buildFilters(q, opts);
  const effectiveClause = q.status
    ? clause
    : (clause ? clause + " AND a.status <> 'Rejected'" : "WHERE a.status <> 'Rejected'");
  const plan = buildPlanFilters(q, 0, opts);
  const masterPlan = buildMasterPlanFilters(q, opts);
  const planParams = q.asset ? [...plan.params, q.asset] : plan.params;

  const dim = async (col) => {
    const columns = col === "state" ? ["state"] : col === "city" ? ["state", "city"] : ["state", "city", "area"];
    const actualExpr = (name) => name === "area" ? "COALESCE(a.area, 'Not specified')" : `a.${name}`;
    const actualGroup = columns.map(actualExpr).join(", ");
    const planGroup = columns.map((name) => `p.${name}`).join(", ");
    const actualMapKey = `concat_ws(chr(31), ${columns.map(actualExpr).join(", ")})`;
    const planMapKey = `concat_ws(chr(31), ${columns.map((name) => `p.${name}`).join(", ")})`;
    const acts = await query(
      `SELECT ${actualMapKey} AS map_key, ${actualExpr(col)} AS key,
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
    const masterColumns = col === "state" ? ["state"] : col === "city" ? ["state", "city"] : ["state", "city", "area"];
    const masterExpr = (name) => `COALESCE(ph.${name}, 'Not specified')`;
    const masterGroups = masterColumns.map(masterExpr);
    const masterShops = await query(
      `SELECT concat_ws(chr(31), ${masterGroups.join(", ")}) AS map_key,
              ${masterExpr(col)} AS key,
              MIN(${masterExpr("state")}) AS state,
              MIN(${masterExpr("city")}) AS city,
              COUNT(DISTINCT ph.id)::int AS planned_shops
       FROM pharmacies ph
       ${masterPlan.clause}
       GROUP BY ${masterGroups.join(", ")}`,
      masterPlan.params
    );
    const map = new Map();
    plans.rows.forEach((r) =>
      map.set(r.map_key, {
        key: r.key, state: r.state, city: r.city, plannedShops: r.planned_shops, plannedAssets: r.planned_assets,
        activatedShops: 0, installed: 0, activations: 0,
      })
    );
    masterShops.rows.forEach((r) => {
      const cur = map.get(r.map_key) || {
        key: r.key, state: r.state, city: r.city, plannedShops: 0, plannedAssets: 0,
        activatedShops: 0, installed: 0, activations: 0,
      };
      cur.plannedShops = r.planned_shops;
      map.set(r.map_key, cur);
    });
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

  // Dropdowns must reflect the active pharmacy master within the logged-in
  // leader's hierarchy. They deliberately ignore the current city/area while
  // building the relevant parent list, so selecting a value never makes the
  // other valid values disappear.
  const cityScope = buildMasterPlanFilters({ state: q.state }, opts);
  const areaScope = buildMasterPlanFilters({ state: q.state, city: q.city }, opts);
  const [cityOptions, areaOptions] = await Promise.all([
    query(
      `SELECT DISTINCT trim(ph.city) AS value FROM pharmacies ph
       ${cityScope.clause} AND NULLIF(trim(ph.city), '') IS NOT NULL
       ORDER BY value`,
      cityScope.params
    ),
    query(
      `SELECT DISTINCT trim(ph.area) AS value FROM pharmacies ph
       ${areaScope.clause} AND NULLIF(trim(ph.area), '') IS NOT NULL
       ORDER BY value`,
      areaScope.params
    ),
  ]);

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
            COUNT(DISTINCT a.id)::int AS activations,
            COALESCE(SUM(aa.quantity), 0)::int AS installed
     FROM users u
     LEFT JOIN activations a ON a.user_id = u.id AND a.id IN (
       SELECT a2.id FROM activations a2 JOIN users u2 ON u2.id = a2.user_id ${effectiveClause.replace(/\ba\./g, "a2.").replace(/\bu\./g, "u2.")}
     )
     LEFT JOIN activation_assets aa ON aa.activation_id = a.id
       ${q.asset ? "AND aa.asset_type = $" + (params.length + 1) : ""}
     WHERE u.role = 'field'
       ${opts.ancestorId ? `AND ${descendantSql(`$${params.length}`, "u")}` : ""}
     GROUP BY u.id ORDER BY shops DESC`,
    q.asset ? [...params, q.asset] : params
  );
  const cityPlanMap = Object.fromEntries(byCity.map((r) => [r.key, r.plannedShops]));
  const headcount = {};
  sales.rows.forEach((r) => { headcount[r.city] = (headcount[r.city] || 0) + 1; });
  const bySales = sales.rows.map((r) => {
    const target = Math.round((cityPlanMap[r.city] || 0) / (headcount[r.city] || 1));
    return { id: r.id, name: r.name, employeeId: r.employee_id, city: r.city, shops: r.shops, activations: r.activations, installed: r.installed, target, completion: pct(r.shops, target) };
  });

  // Every leadership row rolls up all salespeople below that person. A logged-in
  // leader receives only their own subtree; Admin receives the full hierarchy.
  const peopleResult = await query(
    `SELECT u.id, u.name, u.employee_id, u.role, u.region,
            u.assigned_state AS state, u.assigned_city AS city, u.manager_id,
            manager.name AS reporting_manager_name
     FROM users u
     LEFT JOIN users manager ON manager.id = u.manager_id
     WHERE u.active = TRUE AND u.role <> 'admin'
       ${opts.ancestorId ? `AND ${descendantOrSelfSql("$1", "u")}` : ""}`,
    opts.ancestorId ? [opts.ancestorId] : []
  );
  const people = peopleResult.rows;
  const children = new Map();
  people.forEach((person) => {
    if (!children.has(person.manager_id)) children.set(person.manager_id, []);
    children.get(person.manager_id).push(person.id);
  });
  const salesById = new Map(bySales.map((person) => [person.id, person]));
  const fieldIdsBelow = (person) => {
    if (person.role === "field") return [person.id];
    const found = [];
    const stack = [...(children.get(person.id) || [])];
    while (stack.length) {
      const id = stack.pop();
      const child = people.find((item) => item.id === id);
      if (!child) continue;
      if (child.role === "field") found.push(child.id);
      else stack.push(...(children.get(child.id) || []));
    }
    return found;
  };
  const roleOrder = { regional_head: 0, city_head: 1, team_lead: 2, field: 3 };
  const byPeople = people.map((person) => {
    const salespeople = fieldIdsBelow(person).map((id) => salesById.get(id)).filter(Boolean);
    const shops = salespeople.reduce((sum, item) => sum + item.shops, 0);
    const installed = salespeople.reduce((sum, item) => sum + item.installed, 0);
    const activations = salespeople.reduce((sum, item) => sum + item.activations, 0);
    const target = salespeople.reduce((sum, item) => sum + item.target, 0);
    return {
      id: person.id, name: person.name, employeeId: person.employee_id,
      role: person.role, roleLabel: ROLE_LABELS[person.role], region: person.region,
      state: person.state, city: person.city, reportingManager: person.reporting_manager_name,
      teamSize: salespeople.length, shops, activations, installed, target, completion: pct(shops, target),
    };
  }).sort((a, b) => (roleOrder[a.role] - roleOrder[b.role]) || b.shops - a.shops || a.name.localeCompare(b.name));

  const totalsAct = await query(
    `SELECT COUNT(DISTINCT a.shop_key)::int AS shops,
            COUNT(DISTINCT a.id)::int AS activations,
            COUNT(DISTINCT a.user_id)::int AS users,
            COUNT(DISTINCT a.id) FILTER (WHERE a.occurred_on = CURRENT_DATE)::int AS today
     FROM activations a JOIN users u ON u.id = a.user_id ${effectiveClause}`,
    params
  );
  const totalsPlan = await query(
    `SELECT COUNT(DISTINCT ph.id)::int AS shops FROM pharmacies ph ${masterPlan.clause}`,
    masterPlan.params
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
    byState, byCity, byArea, byAsset, bySales, byPeople,
    filterOptions: {
      cities: cityOptions.rows.map((row) => row.value),
      areas: areaOptions.rows.map((row) => row.value),
    },
  };
}

// Manager dashboard: only salespeople assigned to the logged-in manager.
router.get("/manager/team", requireRole(...LEADER_ROLES), async (req, res, next) => {
  try {
    const data = await summary({}, { ancestorId: req.user.id, leader: req.user });
    const members = data.byPeople.filter((person) => person.id !== req.user.id);
    const salesmen = members.filter((person) => person.role === "field");
    const totalStoresActivated = salesmen.reduce((sum, person) => sum + person.shops, 0);
    const totalActivations = salesmen.reduce((sum, person) => sum + person.activations, 0);

    res.json({
      totals: {
        members: members.length,
        salesmen: salesmen.length,
        storesActivated: totalStoresActivated,
        activations: totalActivations
      },
      members,
      salesmen: salesmen.map((person) => ({
        id: person.id, name: person.name, employee_id: person.employeeId,
        state: person.state, city: person.city, active: true,
        shops_activated: person.shops, activations: person.activations,
      }))
    });
  } catch (err) {
    next(err);
  }
});

// Manager: activation records for one salesperson in their own team.
router.get("/manager/team/:userId/activations", requireRole(...LEADER_ROLES), async (req, res, next) => {
  try {
    const member = await query(
      `SELECT id, name, employee_id, assigned_state, assigned_city
       FROM users
       WHERE id = $1
         AND role = 'field'
         AND ${descendantSql("$2", "users")}`,
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
         a.party_code,
         a.party_code_duplicate,
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

    const canSeePartyFlag = ["regional_head", "city_head"].includes(req.user.role);
    res.json({
      salesperson: member.rows[0],
      activations: rows.map((row) => canSeePartyFlag ? row : { ...row, party_code_duplicate: false })
    });
  } catch (err) {
    next(err);
  }
});

// Managers receive the same state/city/area plan-vs-actual breakdown as admins,
// but the server always pins it to their assigned territory. Client filters can
// narrow the result; they can never widen it.
router.get("/manager/summary", requireRole(...LEADER_ROLES), async (req, res, next) => {
  try {
    const scoped = { ...req.query };
    const data = await summary(scoped, { ancestorId: req.user.id, leader: req.user });
    res.json(data);
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

router.get("/export/performance.xlsx", requireRole("admin", ...LEADER_ROLES), async (req, res, next) => {
  try {
    const leader = LEADER_ROLES.includes(req.user.role);
    const opts = leader ? { ancestorId: req.user.id, leader: req.user } : {};
    const data = await summary(req.query, opts);
    const { clause, params } = buildFilters(req.query, opts);
    const records = await query(
      `SELECT a.code, a.occurred_at, a.party_code, a.party_code_duplicate,
              a.pharmacy_name, a.state, a.city, a.area, a.status,
              u.name AS salesperson, u.employee_id, u.region,
              COALESCE(SUM(aa.quantity), 0)::int AS installed_units
       FROM activations a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN activation_assets aa ON aa.activation_id = a.id
       ${clause}
       GROUP BY a.id, u.id
       ORDER BY a.occurred_at DESC`,
      params
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Trade Activation Tracker";
    workbook.created = new Date();
    const addSheet = (name, columns, rows) => {
      const sheet = workbook.addWorksheet(name);
      sheet.columns = columns.map(([header, key, width = 18]) => ({ header, key, width }));
      sheet.addRows(rows);
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
      sheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
      });
      return sheet;
    };
    addSheet("Summary", [["Metric","metric",28],["Value","value",18]], [
      { metric: "Planned shops", value: data.totals.plannedShops },
      { metric: "Activated shops", value: data.totals.activatedShops },
      { metric: "Shop penetration %", value: data.totals.shopPen },
      { metric: "Planned assets", value: data.totals.plannedAssets },
      { metric: "Installed assets", value: data.totals.installedAssets },
      { metric: "Asset penetration %", value: data.totals.assetPen },
      { metric: "Activations", value: data.totals.activations },
    ]);
    const geographyColumns = [["State","state"],["City","city"],["Area","key"],["Planned shops","plannedShops"],["Activated shops","activatedShops"],["Shop penetration %","shopPen"],["Planned assets","plannedAssets"],["Installed assets","installed"],["Asset penetration %","assetPen"]];
    addSheet("State Performance", geographyColumns, data.byState);
    addSheet("City Performance", geographyColumns, data.byCity);
    addSheet("Area Performance", geographyColumns, data.byArea);
    addSheet("People Performance", [["Employee ID","employeeId"],["Name","name",24],["Role","roleLabel"],["Reports to","reportingManager",24],["Region","region"],["State","state"],["City","city"],["Salespeople below","teamSize"],["Target","target"],["Shops","shops"],["Installed","installed"],["Completion %","completion"]], data.byPeople);
    addSheet("Asset Performance", [["Asset","label",26],["Planned","planned"],["Installed","installed"],["Remaining","remaining"],["Penetration %","pen"]], data.byAsset);
    addSheet("Activations", [["Activation ID","code",22],["Date/time","occurred_at",22],["Region","region"],["State","state"],["City","city"],["Area","area"],["Employee ID","employee_id"],["Salesperson","salesperson",24],["Shop","pharmacy_name",30],["Party Code (Alter Code)","party_code",24],["Duplicate party code","party_code_duplicate",22],["Installed units","installed_units"],["Status","status"]],
      records.rows.map((r) => ({ ...r, party_code_duplicate: r.party_code_duplicate ? "Flagged" : "No" })));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="performance-report.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
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
