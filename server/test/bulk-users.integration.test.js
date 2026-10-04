const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client } = require("pg");
const ExcelJS = require("exceljs");

const baseUrl = process.env.BULK_TEST_DATABASE_URL;
const safe = (() => {
  if (!baseUrl) return false;
  try {
    const url = new URL(baseUrl);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch { return false; }
})();

test("bulk users API imports atomically with scoped hierarchy", { skip: !safe, timeout: 30000 }, async (t) => {
  const schema = `bulk_test_${crypto.randomUUID().replace(/-/g, "")}`;
  const admin = new Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  t.after(async () => {
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  const url = new URL(baseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.JWT_SECRET = "bulk_test_secret_that_is_long_enough";
  process.env.NODE_ENV = "test";
  const schemaSql = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8").replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", "");
  const setup = new Client({ connectionString: url.toString() });
  await setup.connect();
  await setup.query(schemaSql);

  const inserted = await setup.query(`INSERT INTO users (name,employee_id,role,region,assigned_state,assigned_city,assigned_area,password_hash)
    VALUES ('Admin','TESTADMIN','admin',NULL,NULL,NULL,NULL,'x'),
           ('West RH','TESTRH','regional_head','West',NULL,NULL,NULL,'x'),
           ('Mumbai Lead','TESTTL','team_lead','West','Maharashtra','Mumbai','Bandra','x') RETURNING *`);
  await setup.query("UPDATE users SET manager_id=$1 WHERE employee_id='TESTRH'", [inserted.rows[0].id]);
  await setup.query("UPDATE users SET manager_id=$1 WHERE employee_id='TESTTL'", [inserted.rows[1].id]);

  const express = require("express");
  const { signToken } = require("../src/auth");
  const router = require("../src/routes/bulk-users");
  const app = express();
  app.use("/api/bulk-users", router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    const { pool } = require("../src/db");
    await pool.end();
    await setup.end();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const token = signToken(inserted.rows[0]);
  const headers = { Authorization: `Bearer ${token}` };

  const template = await fetch(`${origin}/api/bulk-users/template`, { headers });
  assert.equal(template.status, 200);
  const templateBuffer = Buffer.from(await template.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer);
  const sheet = workbook.getWorksheet("Users");
  const manager = `${inserted.rows[2].name} · Team Lead · ${inserted.rows[2].employee_id}`;
  ["Sales One", "SM-BULK-1", "sales.one@example.test", "9876500001", "Salesman", manager, "West", "Maharashtra", "Mumbai", "Bandra", "12345678"].forEach((value, index) => { sheet.getCell(2, index + 1).value = value; });
  const form = new FormData();
  form.append("file", new Blob([Buffer.from(await workbook.xlsx.writeBuffer())]), "users.xlsx");
  const response = await fetch(`${origin}/api/bulk-users/import`, { method: "POST", headers, body: form });
  assert.equal(response.status, 201, await response.text());
  const created = await setup.query("SELECT role,region,assigned_state,assigned_city,assigned_area,manager_id,password_hash FROM users WHERE employee_id='SM-BULK-1'");
  assert.equal(created.rows.length, 1);
  assert.deepEqual({ ...created.rows[0], password_hash: Boolean(created.rows[0].password_hash) }, {
    role: "field", region: "West", assigned_state: "Maharashtra", assigned_city: "Mumbai", assigned_area: "Bandra", manager_id: inserted.rows[2].id, password_hash: true,
  });
  const audit = await setup.query("SELECT detail::text AS detail FROM audit_log WHERE action IN ('user.created','users.imported')");
  assert.ok(audit.rows.length >= 2);
  assert.ok(audit.rows.every((row) => !/12345678|password/i.test(row.detail)));

  const invalidBook = new ExcelJS.Workbook();
  await invalidBook.xlsx.load(templateBuffer);
  const invalid = invalidBook.getWorksheet("Users");
  for (let row = 2; row <= 3; row += 1) {
    ["Duplicate", "SM-DUP", "", "", "Salesman", manager, "West", "Maharashtra", "Mumbai", "Bandra", "12345678"].forEach((value, index) => { invalid.getCell(row, index + 1).value = value; });
  }
  const invalidForm = new FormData();
  invalidForm.append("file", new Blob([Buffer.from(await invalidBook.xlsx.writeBuffer())]), "users.xlsx");
  const invalidResponse = await fetch(`${origin}/api/bulk-users/import`, { method: "POST", headers, body: invalidForm });
  assert.equal(invalidResponse.status, 400);
  const none = await setup.query("SELECT count(*)::int AS count FROM users WHERE employee_id='SM-DUP'");
  assert.equal(none.rows[0].count, 0);
});
