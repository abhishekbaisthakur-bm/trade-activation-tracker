/**
 * Photo storage. Two drivers, chosen with STORAGE_DRIVER.
 *
 *   local : writes to a directory on your server (mount a volume or a NAS path)
 *   s3    : any S3 compatible bucket - AWS S3, MinIO, DigitalOcean Spaces, Wasabi
 *
 * Both drivers expose the same three calls, so switching is an env change and a
 * one-off copy of the existing files. Photos are never served directly from the
 * bucket; every read goes through the API so authentication is always enforced.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { config } = require("./config");

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const ALLOWED_MIME = Object.keys(EXT);

function buildKey(activationId, assetType, mime) {
  const ext = EXT[mime] || "jpg";
  const rand = crypto.randomBytes(6).toString("hex");
  return `activations/${activationId}/${assetType}-${rand}.${ext}`;
}

/* ------------------------------ local disk ------------------------------ */

const localDriver = {
  name: "local",
  async put(key, buffer) {
    const full = path.join(config.uploadDir, key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, buffer, { mode: 0o640 });
    return key;
  },
  async get(key) {
    const full = path.join(config.uploadDir, key);
    return fsp.readFile(full);
  },
  async remove(key) {
    const full = path.join(config.uploadDir, key);
    await fsp.rm(full, { force: true });
  },
  async healthy() {
    await fsp.mkdir(config.uploadDir, { recursive: true });
    await fsp.access(config.uploadDir, fs.constants.W_OK);
    return true;
  },
};

/* --------------------------- S3 compatible ------------------------------ */

function s3Client() {
  const { S3Client } = require("@aws-sdk/client-s3");
  return new S3Client({
    region: config.s3.region,
    endpoint: config.s3.endpoint,
    forcePathStyle: config.s3.forcePathStyle,
    credentials:
      config.s3.accessKeyId && config.s3.secretAccessKey
        ? { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey }
        : undefined,
  });
}

const s3Driver = {
  name: "s3",
  async put(key, buffer, mime) {
    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    await s3Client().send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: buffer,
        ContentType: mime,
        ServerSideEncryption: config.s3.endpoint ? undefined : "AES256",
      })
    );
    return key;
  },
  async get(key) {
    const { GetObjectCommand } = require("@aws-sdk/client-s3");
    const res = await s3Client().send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
    const chunks = [];
    for await (const chunk of res.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
  },
  async remove(key) {
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    await s3Client().send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  },
  async healthy() {
    const { HeadBucketCommand } = require("@aws-sdk/client-s3");
    await s3Client().send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
    return true;
  },
};

const driver = config.storageDriver === "s3" ? s3Driver : localDriver;

module.exports = { driver, buildKey, ALLOWED_MIME, EXT };
