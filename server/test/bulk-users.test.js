const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildTemplate,
  parseWorkbook,
  validateRows,
  FULL_HEADERS,
  TL_HEADERS,
  managerLabel,
} = require("../src/bulk-users");

const users = [
  { id: "admin", name: "Admin", employee_id: "ADMIN001", role: "admin", active: true, manager_id: null },
  { id: "rh", name: "Regional", employee_id: "RH001", role: "regional_head", active: true, manager_id: "admin", region: "West" },
  { id: "ch", name: "City", employee_id: "CH001", role: "city_head", active: true, manager_id: "rh", region: "West", assigned_state: "Maharashtra", assigned_city: "Mumbai" },
  { id: "tl", name: "Lead", employee_id: "TL001", role: "team_lead", active: true, manager_id: "ch", region: "West", assigned_state: "Maharashtra", assigned_city: "Mumbai", assigned_area: "Bandra" },
  { id: "other", name: "Other Region", employee_id: "RH999", role: "regional_head", active: true, manager_id: "admin", region: "North" },
];

test("templates use role-specific columns and Excel dropdown validation", async () => {
  const adminBook = await buildTemplate(users[0], users);
  const sheet = adminBook.getWorksheet("Users");
  assert.deepEqual(sheet.getRow(1).values.slice(1), FULL_HEADERS);
  assert.equal(sheet.getCell("E2").dataValidation.formulae[0], "UploadRoles");
  assert.match(sheet.getCell("F2").dataValidation.formulae[0], /Managers_/);
  assert.equal(sheet.getCell("K2").value, "12345678");
  assert.equal(adminBook.getWorksheet("Lists").state, "veryHidden");

  const tlBook = await buildTemplate(users[3], users);
  assert.deepEqual(tlBook.getWorksheet("Users").getRow(1).values.slice(1), TL_HEADERS);
  assert.equal(tlBook.getWorksheet("Users").getCell("F2").value, "12345678");
});

test("team lead rows infer salesman, manager, territory and first password", () => {
  const parsed = { errors: [], rows: [{ row: 2, Name: "Sales Person", "Employee ID": "SM100", Email: "", Contact: "9876543210", Area: "", "Initial Password": "12345678" }] };
  const checked = validateRows(parsed, users[3], users);
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.users[0].role, "field");
  assert.equal(checked.users[0].managerId, "tl");
  assert.equal(checked.users[0].region, "West");
  assert.equal(checked.users[0].state, "Maharashtra");
  assert.equal(checked.users[0].city, "Mumbai");
  assert.equal(checked.users[0].area, "Bandra");
});

test("regional head cannot select a manager outside their subtree", () => {
  const parsed = { errors: [], rows: [{ row: 2, Name: "New City", "Employee ID": "CH100", Email: "", Contact: "", Role: "City Head", "Reporting Manager": managerLabel(users[4]), Region: "", State: "Delhi", City: "Delhi", Area: "", "Initial Password": "12345678" }] };
  const checked = validateRows(parsed, users[1], users);
  assert.ok(checked.errors.some((e) => e.field === "Reporting Manager"));
});

test("duplicate identifiers and inherited-territory conflicts are rejected", () => {
  const base = { Name: "Sales Person", Email: "", Contact: "", Role: "Salesman", "Reporting Manager": managerLabel(users[3]), Region: "West", State: "Maharashtra", City: "Mumbai", Area: "Bandra", "Initial Password": "12345678" };
  const parsed = { errors: [], rows: [
    { row: 2, ...base, "Employee ID": "SM200" },
    { row: 3, ...base, "Employee ID": "sm200", City: "Pune" },
  ] };
  const checked = validateRows(parsed, users[0], users);
  assert.ok(checked.errors.some((e) => e.row === 3 && e.field === "Employee ID"));
  assert.ok(checked.errors.some((e) => e.row === 3 && e.field === "City"));
});

test("generated workbook round-trips and ignores prepared empty rows", async () => {
  const workbook = await buildTemplate(users[3], users);
  const sheet = workbook.getWorksheet("Users");
  sheet.getCell("A2").value = "Sales Person";
  sheet.getCell("B2").value = "SM300";
  const parsed = await parseWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), "team_lead");
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]["Employee ID"], "SM300");
});
