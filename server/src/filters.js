const { ASSET_KEYS, STATUSES } = require("./constants");
const { descendantSql } = require("./hierarchy");

/**
 * Turns the dashboard query string into a parameterised WHERE clause.
 * Everything is bound, never interpolated, so the filters cannot be injected.
 */
function buildFilters(q, opts = {}) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };

  if (q.from) add("a.occurred_at >= ?", new Date(`${q.from}T00:00:00`));
  if (q.to) add("a.occurred_at <= ?", new Date(`${q.to}T23:59:59.999`));
  if (q.state) add("a.state = ?", q.state);
  if (q.city) add("a.city = ?", q.city);
  if (q.area) add("a.area = ?", q.area);
  if (q.userId) add("a.user_id = ?", q.userId);
  if (q.status && STATUSES.includes(q.status)) add("a.status = ?", q.status);
  if (q.asset && ASSET_KEYS.includes(q.asset)) {
    add("EXISTS (SELECT 1 FROM activation_assets x WHERE x.activation_id = a.id AND x.asset_type = ?)", q.asset);
  }
  if (q.search) {
    params.push(`%${String(q.search).trim().toLowerCase()}%`);
    where.push(
      `(lower(a.pharmacy_name) LIKE $${params.length} OR lower(a.code) LIKE $${params.length}` +
        ` OR lower(a.city) LIKE $${params.length} OR lower(a.area) LIKE $${params.length}` +
        ` OR lower(u.name) LIKE $${params.length} OR lower(u.employee_id) LIKE $${params.length})`
    );
  }
  if (opts.forceUser) add("a.user_id = ?", opts.forceUser);
  if (opts.regionScope) {
    add("regexp_replace(lower(COALESCE(u.region, '')), '\\s+', '', 'g') = regexp_replace(lower(?), '\\s+', '', 'g')", opts.regionScope);
  } else if (opts.ancestorId) {
    params.push(opts.ancestorId);
    where.push(descendantSql(`$${params.length}`, "u"));
  }

  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

/** Geography filters applied to the planned_targets table. */
function buildPlanFilters(q, startIndex = 0, opts = {}) {
  const where = [];
  const params = [];
  const add = (col, value) => {
    params.push(value);
    where.push(`${col} = $${startIndex + params.length}`);
  };
  if (q.state) add("p.state", q.state);
  if (q.city) add("p.city", q.city);
  if (q.area) add("p.area", q.area);
  if (opts.regionScope) {
    params.push(opts.regionScope);
    where.push(`EXISTS (
      SELECT 1 FROM users plan_user
      WHERE plan_user.role = 'field'
        AND plan_user.assigned_state = p.state
        AND plan_user.assigned_city = p.city
        AND regexp_replace(lower(COALESCE(plan_user.region, '')), '\\s+', '', 'g') =
            regexp_replace(lower($${startIndex + params.length}), '\\s+', '', 'g')
    )`);
  } else if (opts.ancestorId) {
    params.push(opts.ancestorId);
    where.push(`EXISTS (
      SELECT 1 FROM users plan_user
      WHERE plan_user.role = 'field'
        AND plan_user.assigned_state = p.state
        AND plan_user.assigned_city = p.city
        AND ${descendantSql(`$${startIndex + params.length}`, "plan_user")}
    )`);
  }
  return { clause: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

module.exports = { buildFilters, buildPlanFilters };
