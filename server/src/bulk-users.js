const ExcelJS = require("exceljs");
const { CHILD_ROLES, ROLE_LABELS } = require("./hierarchy");

const MAX_ROWS = 200;
const DEFAULT_PASSWORD = "12345678";
const FULL_HEADERS = ["Name", "Employee ID", "Email", "Contact", "Role", "Reporting Manager", "Region", "State", "City", "Area", "Initial Password"];
const TL_HEADERS = ["Name", "Employee ID", "Email", "Contact", "Area", "Initial Password"];
const LABEL_TO_ROLE = Object.fromEntries(Object.entries(ROLE_LABELS).map(([key, label]) => [label.toLowerCase(), key]));
const PARENT_ROLES = { regional_head: ["admin"], city_head: ["regional_head"], team_lead: ["regional_head", "city_head"], field: ["regional_head", "city_head", "team_lead"] };

const managerLabel = (user) => `${user.name} · ${ROLE_LABELS[user.role]} · ${user.employee_id}`;
const clean = (value) => String(value == null ? "" : value).trim();

function descendantsOf(users, actorId) {
  const ids = new Set([actorId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const user of users) {
      if (user.manager_id && ids.has(user.manager_id) && !ids.has(user.id)) {
        ids.add(user.id);
        changed = true;
      }
    }
  }
  return ids;
}

function allowedManagers(actor, users, childRole) {
  if (childRole === "regional_head") return actor.role === "admin" ? [actor] : [];
  const scope = actor.role === "admin" ? new Set(users.map((u) => u.id)) : descendantsOf(users, actor.id);
  return users.filter((u) => u.active && scope.has(u.id) && (PARENT_ROLES[childRole] || []).includes(u.role));
}

function styleTemplate(sheet, headers) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  const row = sheet.getRow(1);
  row.height = 26;
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  row.alignment = { vertical: "middle" };
  const widths = { "Name": 25, "Employee ID": 18, "Email": 28, "Contact": 18, "Role": 18, "Reporting Manager": 38, "Region": 20, "State": 20, "City": 20, "Area": 20, "Initial Password": 20 };
  headers.forEach((header, index) => {
    const col = sheet.getColumn(index + 1);
    col.width = widths[header] || 20;
    col.numFmt = "@";
  });
}

async function buildTemplate(actor, users) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Trade Activation Tracker";
  workbook.created = new Date();
  const isTeamLead = actor.role === "team_lead";
  const headers = isTeamLead ? TL_HEADERS : FULL_HEADERS;
  const sheet = workbook.addWorksheet("Users", { properties: { defaultRowHeight: 20 } });
  sheet.addRow(headers);
  styleTemplate(sheet, headers);

  const instructions = workbook.addWorksheet("Instructions");
  instructions.getColumn(1).width = 110;
  [
    "Bulk user upload",
    `You can add: ${(CHILD_ROLES[actor.role] || []).map((r) => ROLE_LABELS[r]).join(", ")}. Maximum ${MAX_ROWS} users per file.`,
    "Use the dropdowns in the Users sheet. Download a fresh template whenever reporting lines change.",
    "Name, Employee ID and Role are required. Email and Contact are optional. Area is optional.",
    "Regional Heads need a Region. Other roles need State and City when their reporting manager does not already have them.",
    `Initial Password defaults to ${DEFAULT_PASSWORD}. You can replace it for any employee before upload.`,
    "The import is all-or-none: if any row has an error, no accounts are created.",
  ].forEach((value, index) => {
    const row = instructions.addRow([value]);
    row.height = index === 0 ? 30 : 24;
    row.alignment = { vertical: "middle", wrapText: true };
    if (index === 0) row.font = { bold: true, size: 16, color: { argb: "FF0F766E" } };
  });

  const lists = workbook.addWorksheet("Lists", { state: "veryHidden" });
  const allowedRoles = CHILD_ROLES[actor.role] || [];
  lists.getCell("A1").value = "Roles";
  allowedRoles.forEach((role, i) => { lists.getCell(i + 2, 1).value = ROLE_LABELS[role]; });
  if (allowedRoles.length) workbook.definedNames.add(`Lists!$A$2:$A$${allowedRoles.length + 1}`, "UploadRoles");

  const roleColumns = { regional_head: 2, city_head: 3, team_lead: 4, field: 5 };
  for (const [childRole, col] of Object.entries(roleColumns)) {
    lists.getCell(1, col).value = ROLE_LABELS[childRole];
    const managers = allowedManagers(actor, users, childRole);
    const values = managers.length ? managers : [{ name: "No eligible reporting manager", role: "admin", employee_id: "N/A" }];
    values.forEach((user, i) => { lists.getCell(i + 2, col).value = managerLabel(user); });
    const letter = lists.getColumn(col).letter;
    workbook.definedNames.add(`Lists!$${letter}$2:$${letter}$${values.length + 1}`, `Managers_${ROLE_LABELS[childRole].replace(/\s/g, "")}`);
  }

  for (let row = 2; row <= MAX_ROWS + 1; row += 1) {
    const passwordCol = headers.indexOf("Initial Password") + 1;
    // Show the default once as an example. Empty password cells on later
    // employee rows receive the same default during import.
    if (row === 2) sheet.getCell(row, passwordCol).value = DEFAULT_PASSWORD;
    sheet.getCell(row, passwordCol).numFmt = "@";
    if (isTeamLead) continue;
    const roleCell = sheet.getCell(row, headers.indexOf("Role") + 1);
    roleCell.dataValidation = { type: "list", allowBlank: false, formulae: ["UploadRoles"], showErrorMessage: true, errorStyle: "stop", errorTitle: "Choose a role", error: "Select a role from the dropdown." };
    const managerCell = sheet.getCell(row, headers.indexOf("Reporting Manager") + 1);
    managerCell.dataValidation = { type: "list", allowBlank: true, formulae: [`INDIRECT("Managers_"&SUBSTITUTE($E${row}," ",""))`], showErrorMessage: true, errorStyle: "stop", errorTitle: "Choose a reporting manager", error: "Select an eligible reporting manager from the dropdown." };
  }
  return workbook;
}

function cellText(cell) {
  if (!cell || cell.value == null) return "";
  if (cell.type === ExcelJS.ValueType.Formula || (typeof cell.value === "object" && cell.value.formula)) {
    const err = new Error("Formulas are not allowed in the upload template.");
    err.code = "FORMULA";
    throw err;
  }
  if (typeof cell.value === "object") {
    if (Array.isArray(cell.value.richText)) return cell.value.richText.map((part) => part.text || "").join("").trim();
    if (cell.value.text) return clean(cell.value.text);
    throw new Error("Use plain text values in the upload template.");
  }
  return clean(cell.value);
}

async function parseWorkbook(buffer, actorRole) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("Users");
  if (!sheet) throw Object.assign(new Error("The Excel file must contain a Users sheet."), { status: 400 });
  const expected = actorRole === "team_lead" ? TL_HEADERS : FULL_HEADERS;
  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col - 1] = cellText(cell); });
  const missing = expected.filter((name) => !headers.includes(name));
  if (missing.length) throw Object.assign(new Error(`The template is missing column(s): ${missing.join(", ")}. Download a fresh template.`), { status: 400 });
  const index = Object.fromEntries(expected.map((name) => [name, headers.indexOf(name) + 1]));
  const rows = [];
  const errors = [];
  for (let number = 2; number <= sheet.actualRowCount; number += 1) {
    const row = sheet.getRow(number);
    const item = { row: number };
    let bad = false;
    for (const name of expected) {
      try { item[name] = cellText(row.getCell(index[name])); }
      catch (err) { errors.push({ row: number, field: name, message: err.code === "FORMULA" ? "Remove the formula and enter plain text." : err.message }); bad = true; }
    }
    const signalFields = expected.filter((name) => !["Initial Password", "Role", "Reporting Manager"].includes(name));
    if (!signalFields.some((name) => item[name])) continue;
    if (!bad) rows.push(item);
  }
  if (rows.length > MAX_ROWS) throw Object.assign(new Error(`Upload no more than ${MAX_ROWS} users at a time.`), { status: 400 });
  if (!rows.length && !errors.length) throw Object.assign(new Error("The Users sheet has no user rows to import."), { status: 400 });
  return { rows, errors };
}

function validateRows(parsed, actor, users) {
  const errors = [...parsed.errors];
  const result = [];
  const seenEmployee = new Map();
  const seenEmail = new Map();
  const seenMobile = new Map();
  const dbEmployee = new Set(users.map((u) => clean(u.employee_id).toLowerCase()));
  const dbEmail = new Set(users.map((u) => clean(u.email).toLowerCase()).filter(Boolean));
  const dbMobile = new Set(users.map((u) => clean(u.mobile).toLowerCase()).filter(Boolean));
  const allowedRoles = new Set(CHILD_ROLES[actor.role] || []);

  const error = (row, field, message) => errors.push({ row, field, message });
  for (const raw of parsed.rows) {
    const role = actor.role === "team_lead" ? "field" : LABEL_TO_ROLE[clean(raw.Role).toLowerCase()];
    const name = clean(raw.Name);
    const employeeId = clean(raw["Employee ID"]);
    const email = clean(raw.Email).toLowerCase() || null;
    const mobile = clean(raw.Contact).replace(/[\s()-]/g, "") || null;
    const password = clean(raw["Initial Password"]) || DEFAULT_PASSWORD;
    if (!name) error(raw.row, "Name", "Enter the user's name.");
    if (!employeeId) error(raw.row, "Employee ID", "Enter an employee ID.");
    if (!role) error(raw.row, "Role", "Choose a role from the dropdown.");
    else if (!allowedRoles.has(role)) error(raw.row, "Role", "You do not have permission to create this role.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) error(raw.row, "Email", "Enter a valid email address or leave it blank.");
    if (mobile && !/^\+?\d{7,15}$/.test(mobile)) error(raw.row, "Contact", "Enter 7 to 15 digits, optionally starting with +, or leave it blank.");
    if (Buffer.byteLength(password, "utf8") < 8 || Buffer.byteLength(password, "utf8") > 72) error(raw.row, "Initial Password", "Use a password between 8 and 72 characters.");
    const eKey = employeeId.toLowerCase();
    if (eKey && (dbEmployee.has(eKey) || seenEmployee.has(eKey))) error(raw.row, "Employee ID", "This employee ID already exists in the app or this file.");
    if (eKey) seenEmployee.set(eKey, raw.row);
    if (email && (dbEmail.has(email) || seenEmail.has(email))) error(raw.row, "Email", "This email already exists in the app or this file.");
    if (email) seenEmail.set(email, raw.row);
    const mKey = mobile && mobile.toLowerCase();
    if (mKey && (dbMobile.has(mKey) || seenMobile.has(mKey))) error(raw.row, "Contact", "This contact number already exists in the app or this file.");
    if (mKey) seenMobile.set(mKey, raw.row);

    let parent = null;
    if (role) {
      const managers = allowedManagers(actor, users, role);
      const selected = clean(raw["Reporting Manager"]);
      if (selected) parent = managers.find((u) => managerLabel(u) === selected);
      if (!parent && !selected && role === "regional_head" && actor.role === "admin") parent = actor;
      if (!parent && !selected && actor.role !== "admin" && (PARENT_ROLES[role] || []).includes(actor.role)) parent = actor;
      if (!parent) error(raw.row, "Reporting Manager", selected ? "The selected reporting manager is no longer eligible. Download a fresh template." : "Choose an eligible reporting manager.");
    }

    let region = clean(raw.Region);
    let state = clean(raw.State);
    let city = clean(raw.City);
    let area = clean(raw.Area) || null;
    if (role === "regional_head") {
      if (!region) error(raw.row, "Region", "Enter the Regional Head's region.");
      state = null; city = null; area = null;
    } else if (parent) {
      for (const [field, parentKey, current] of [["Region", "region", region], ["State", "assigned_state", state], ["City", "assigned_city", city], ["Area", "assigned_area", area]]) {
        const inherited = clean(parent[parentKey]);
        if (inherited && current && inherited.toLowerCase() !== clean(current).toLowerCase()) error(raw.row, field, `This must match the reporting manager's ${field.toLowerCase()}: ${inherited}.`);
        if (inherited) {
          if (field === "Region") region = inherited;
          if (field === "State") state = inherited;
          if (field === "City") city = inherited;
          if (field === "Area") area = inherited;
        }
      }
      if (!region) error(raw.row, "Region", "The reporting manager needs a region before this user can be added.");
      if (!state) error(raw.row, "State", "Enter a state because it is not set on the reporting manager.");
      if (!city) error(raw.row, "City", "Enter a city because it is not set on the reporting manager.");
    }
    result.push({ row: raw.row, name, employeeId, email, mobile, role, region: region || null, state: state || null, city: city || null, area, managerId: parent && parent.id, password });
  }
  return { users: result, errors };
}

module.exports = { MAX_ROWS, DEFAULT_PASSWORD, FULL_HEADERS, TL_HEADERS, managerLabel, buildTemplate, parseWorkbook, validateRows };
