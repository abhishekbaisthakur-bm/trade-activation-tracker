const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const { config, assertConfig } = require("./config");
const { pool } = require("./db");
const { driver } = require("./storage");
const { ASSETS } = require("./constants");

assertConfig();

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: config.corsOrigin.includes("*") ? true : config.corsOrigin,
    credentials: false,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(morgan(config.env === "production" ? "combined" : "dev"));

app.get("/api/health", async (req, res) => {
  const out = { ok: true, storage: driver.name, time: new Date().toISOString() };
  try {
    await pool.query("SELECT 1");
    out.database = "up";
  } catch (err) {
    out.ok = false;
    out.database = "down";
  }
  try {
    await driver.healthy();
    out.storageWritable = true;
  } catch (err) {
    out.ok = false;
    out.storageWritable = false;
  }
  res.status(out.ok ? 200 : 503).json(out);
});

app.get("/api/meta", (req, res) => res.json({ assets: ASSETS }));

app.use("/api/auth", require("./routes/auth").router);
app.use("/api/admin", require("./routes/admin"));
app.use("/api/bulk-users", require("./routes/bulk-users"));
app.use("/api/requests", require("./routes/requests"));
app.use("/api/activations", require("./routes/activations").router);
app.use("/api/analytics", require("./routes/analytics"));

// Serve the built front end from the same origin in production.
const webRoot = path.join(__dirname, "..", "public");
app.use(express.static(webRoot, { maxAge: "1h", index: false }));
app.get(/^(?!\/api).*/, (req, res, next) => {
  res.sendFile(path.join(webRoot, "index.html"), (err) => (err ? next() : null));
});

app.use((req, res) => res.status(404).json({ error: "Not found." }));

app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `Each photo must be under ${config.maxUploadMb} MB.` });
  }
  if (err && /Only JPEG/.test(err.message || "")) {
    return res.status(415).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

const server = app.listen(config.port, () => {
  console.log(`Trade Activation Tracker API listening on :${config.port} (storage: ${driver.name})`);
});

const shutdown = () => {
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
