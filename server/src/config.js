require("dotenv").config();

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

const config = {
  port: int(process.env.PORT, 4000),
  env: process.env.NODE_ENV || "development",
  corsOrigin: (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean),
  databaseUrl: process.env.DATABASE_URL,
  pgSsl: (process.env.PGSSLMODE || "disable") === "require",
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",
  storageDriver: (process.env.STORAGE_DRIVER || "local").toLowerCase(),
  uploadDir: process.env.UPLOAD_DIR || "/var/lib/tat/uploads",
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 6),
  s3: {
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION || "ap-south-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || "false") === "true",
  },
  bootstrapAdmin: {
    name: process.env.BOOTSTRAP_ADMIN_NAME || "Administrator",
    employeeId: process.env.BOOTSTRAP_ADMIN_EMPLOYEE_ID || "ADMIN001",
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@example.com",
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  },
};

function assertConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (!config.jwtSecret || config.jwtSecret.length < 24) missing.push("JWT_SECRET (min 24 chars)");
  if (config.storageDriver === "s3" && !config.s3.bucket) missing.push("S3_BUCKET");
  if (missing.length) {
    console.error("Configuration error. Missing or invalid: " + missing.join(", "));
    process.exit(1);
  }
}

module.exports = { config, assertConfig };
