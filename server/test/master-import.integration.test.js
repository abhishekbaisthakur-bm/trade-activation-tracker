const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client } = require("pg");

const baseUrl = process.env.BULK_TEST_DATABASE_URL;
const safe = (() => {
  if (!baseUrl) return false;
  try { return ["localhost", "127.0.0.1", "::1"].includes(new URL(baseUrl).hostname); }
  catch { return false; }
})();

test("Regional Head master CSV import is atomic and reports shop conflicts", { skip: !safe, timeout: 30000 }, async (t) => {
  const schema = `master_test_${crypto.randomUUID().replace(/-/g, "")}`;
  const admin = new Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  t.after(async () => { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

  const url = new URL(baseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.JWT_SECRET = "master_import_test_secret_long_enough";
  process.env.NODE_ENV = "test";
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  const schemaSql = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8").replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", "");
  await db.query(schemaSql);
  const actorResult = await db.query(`INSERT INTO users (name,employee_id,role,region,password_hash)
    VALUES ('Rajendra QA','RH-MASTER-QA','regional_head','West','x') RETURNING *`);
  const actor = actorResult.rows[0];
  await db.query(`INSERT INTO pharmacies (name,name_key,rio_id,party_alt_code,state,city,created_by)
    VALUES ('Existing Shop','existing shop','RIO-OLD','ALT-OLD','Maharashtra','Mumbai',$1)`, [actor.id]);

  const express = require("express");
  const { signToken } = require("../src/auth");
  const app = express();
  app.use(express.json());
  app.use("/api/requests", require("../src/routes/requests"));
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = await new Promise((resolve) => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    const { pool } = require("../src/db");
    await pool.end();
    await db.end();
  });
  const endpoint = `http://127.0.0.1:${server.address().port}/api/requests/master-pharmacies/import`;
  const headers = { Authorization: `Bearer ${signToken(actor)}` };
  const upload = async (csv) => {
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "master.csv");
    return fetch(endpoint, { method: "POST", headers, body: form });
  };

  const valid = await upload("Pharmacy Name,Rio Id,Party/Alt Code,Address (optional),City (optional),State (Optional)\nNew Shop,RIO-NEW,ALT-NEW,Address,Mumbai,Maharashtra\n");
  assert.equal(valid.status, 200, await valid.text());
  assert.equal((await db.query("SELECT count(*)::int AS count FROM pharmacies WHERE rio_id='RIO-NEW'")).rows[0].count, 1);

  const conflict = await upload("Pharmacy Name,Rio Id,Party/Alt Code,Address (optional),City (optional),State (Optional)\nShould Roll Back,RIO-ROLLBACK,ALT-1,Address,Mumbai,Maharashtra\nExisting Shop,RIO-DIFFERENT,ALT-2,Address,Mumbai,Maharashtra\n");
  assert.equal(conflict.status, 409);
  const body = await conflict.json();
  assert.match(body.error, /Row 3: Existing Shop already exists/);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM pharmacies WHERE rio_id='RIO-ROLLBACK'")).rows[0].count, 0);

  const duplicate = await upload("Pharmacy Name,Rio Id,Party/Alt Code\nOne,RIO-DUP,ALT-1\nTwo,RIO-DUP,ALT-2\n");
  assert.equal(duplicate.status, 400);
  assert.match((await duplicate.json()).error, /already used on row 2/);
});
