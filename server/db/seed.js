/**
 * Creates the first admin account, and optionally a set of demo field users,
 * pharmacies and planned targets so the dashboard is not empty on day one.
 *
 *   npm run seed              -> admin only (use this for production)
 *   npm run seed -- --demo    -> admin plus demo users, pharmacies and targets
 */
const { pool, query } = require("../src/db");
const { hashPassword } = require("../src/auth");
const { config } = require("../src/config");
const { ASSET_KEYS } = require("../src/constants");

const DEMO_GEO = [
  { state: "Maharashtra", city: "Mumbai", areas: ["Andheri West", "Dadar", "Borivali", "Chembur"] },
  { state: "Maharashtra", city: "Pune", areas: ["Kothrud", "Viman Nagar", "Hadapsar"] },
  { state: "Delhi", city: "New Delhi", areas: ["Karol Bagh", "Rohini", "Saket"] },
  { state: "Karnataka", city: "Bengaluru", areas: ["Indiranagar", "Jayanagar", "Whitefield"] },
  { state: "Tamil Nadu", city: "Chennai", areas: ["T. Nagar", "Adyar", "Anna Nagar"] },
  { state: "Telangana", city: "Hyderabad", areas: ["Banjara Hills", "Kukatpally", "Secunderabad"] },
  { state: "West Bengal", city: "Kolkata", areas: ["Salt Lake", "Behala", "Howrah"] },
  { state: "Gujarat", city: "Ahmedabad", areas: ["Navrangpura", "Maninagar", "Satellite"] },
  { state: "Uttar Pradesh", city: "Lucknow", areas: ["Gomti Nagar", "Hazratganj", "Aliganj"] },
];

const DEMO_USERS = [
  ["Rahul Deshmukh", "EMP1001", "9820011001", "Maharashtra", "Mumbai"],
  ["Priya Nair", "EMP1002", "9820011002", "Maharashtra", "Pune"],
  ["Amit Sharma", "EMP1003", "9820011003", "Delhi", "New Delhi"],
  ["Kiran Rao", "EMP1004", "9820011004", "Karnataka", "Bengaluru"],
  ["Vignesh Iyer", "EMP1005", "9820011005", "Tamil Nadu", "Chennai"],
  ["Sana Fatima", "EMP1006", "9820011006", "Telangana", "Hyderabad"],
];

async function main() {
  const demo = process.argv.includes("--demo");

  if (!config.bootstrapAdmin.password || config.bootstrapAdmin.password.length < 8) {
    console.error("Set BOOTSTRAP_ADMIN_PASSWORD in .env to at least 8 characters before seeding.");
    process.exit(1);
  }

  const admin = await query(
    `INSERT INTO users (name, employee_id, email, role, password_hash, active)
     VALUES ($1,$2,$3,'admin',$4,TRUE)
     ON CONFLICT (employee_id) DO UPDATE SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       role = 'admin',
       password_hash = EXCLUDED.password_hash,
       active = TRUE,
       updated_at = now()
     RETURNING id, employee_id`,
    [
      config.bootstrapAdmin.name,
      config.bootstrapAdmin.employeeId,
      config.bootstrapAdmin.email,
      await hashPassword(config.bootstrapAdmin.password),
    ]
  );
  console.log(`Admin ready: ${admin.rows[0].employee_id}`);

  if (!demo) {
    console.log("Done. Run with --demo to add sample field users, pharmacies and targets.");
    return;
  }

  const fieldHash = await hashPassword("field@1234");
  for (const [name, empId, mobile, state, city] of DEMO_USERS) {
    await query(
      `INSERT INTO users (name, employee_id, mobile, email, role, assigned_state, assigned_city, password_hash)
       VALUES ($1,$2,$3,$4,'field',$5,$6,$7) ON CONFLICT (employee_id) DO NOTHING`,
      [name, empId, mobile, `${empId.toLowerCase()}@field.local`, state, city, fieldHash]
    );
  }
  console.log(`${DEMO_USERS.length} demo field users ready (password field@1234).`);

  const shopNames = ["Apollo Pharmacy", "Wellness Forever", "MedPlus", "Noble Chemist", "Shree Medical Stores", "Om Sai Medicals"];
  let plans = 0;
  let shops = 0;
  for (const g of DEMO_GEO) {
    for (const area of g.areas) {
      const plannedShops = 20 + Math.floor(Math.random() * 25);
      const { rows } = await query(
        `INSERT INTO planned_targets (state, city, area, planned_shops) VALUES ($1,$2,$3,$4)
         ON CONFLICT (state, city, area) DO UPDATE SET planned_shops = EXCLUDED.planned_shops RETURNING id`,
        [g.state, g.city, area, plannedShops]
      );
      const perAsset = {
        poster: plannedShops * 2, wobbler: plannedShops * 3, dangler: plannedShops * 2,
        shelf_strip: plannedShops, gravity_feeder: Math.round(plannedShops * 0.3),
        shelf_in_shelf: Math.round(plannedShops * 0.2), brown_envelope: plannedShops * 10,
      };
      for (const key of ASSET_KEYS) {
        await query(
          `INSERT INTO planned_assets (plan_id, asset_type, quantity) VALUES ($1,$2,$3)
           ON CONFLICT (plan_id, asset_type) DO UPDATE SET quantity = EXCLUDED.quantity`,
          [rows[0].id, key, perAsset[key] || 0]
        );
      }
      plans += 1;

      for (const base of shopNames.slice(0, 3)) {
        const name = `${base} - ${area}`;
        await query(
          `INSERT INTO pharmacies (name, name_key, address, state, city, area)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (city, name_key) DO NOTHING`,
          [name, name.toLowerCase(), `${area}, ${g.city}`, g.state, g.city, area]
        );
        shops += 1;
      }
    }
  }
  console.log(`${plans} planned target rows and ${shops} pharmacies ready.`);
  console.log("No demo activations are created: those should come from real submissions.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
