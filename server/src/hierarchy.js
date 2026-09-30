const LEADER_ROLES = ["regional_head", "city_head", "team_lead"];
const ALL_ROLES = ["admin", ...LEADER_ROLES, "field"];

const ROLE_LABELS = {
  admin: "Admin",
  regional_head: "Regional Head",
  city_head: "City Head",
  team_lead: "Team Lead",
  field: "Salesman",
};

const CHILD_ROLES = {
  admin: ["regional_head", "city_head", "team_lead", "field"],
  regional_head: ["city_head", "team_lead", "field"],
  city_head: ["team_lead", "field"],
  team_lead: ["field"],
  field: [],
};

const isLeader = (role) => LEADER_ROLES.includes(role);
const canCreateRole = (actorRole, childRole) => (CHILD_ROLES[actorRole] || []).includes(childRole);

const descendantSql = (ancestorPlaceholder, userAlias = "u") => `
  ${userAlias}.id IN (
    WITH RECURSIVE descendants AS (
      SELECT id FROM users WHERE manager_id = ${ancestorPlaceholder}
      UNION ALL
      SELECT child.id FROM users child JOIN descendants parent ON child.manager_id = parent.id
    )
    SELECT id FROM descendants
  )`;

const descendantOrSelfSql = (ancestorPlaceholder, userAlias = "u") => `
  (${userAlias}.id = ${ancestorPlaceholder} OR ${descendantSql(ancestorPlaceholder, userAlias)})`;

module.exports = {
  LEADER_ROLES,
  ALL_ROLES,
  ROLE_LABELS,
  CHILD_ROLES,
  isLeader,
  canCreateRole,
  descendantSql,
  descendantOrSelfSql,
};
