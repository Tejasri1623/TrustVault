/**
 * Shared, environment-aware resolution of the TrustVault upload root.
 *
 * Local development keeps uploads under `Backend/uploads` (writable on
 * Windows/macOS/Linux). Vercel's serverless runtime only permits writes
 * under `/tmp`, so uploads are placed there instead. `/tmp` is NOT
 * persistent: files can disappear between invocations/cold starts, so this
 * mode is only a compatibility shim. Persistent documents on Vercel require
 * one of the configured cloud storage providers (GCS/S3/Azure).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);

function getUploadRoot() {
  if (isVercel) {
    return path.join(os.tmpdir(), "trustvault-uploads");
  }
  return path.resolve(__dirname, "..", "uploads");
}

function ensureUploadRoot(subpath) {
  const target = subpath
    ? path.join(getUploadRoot(), subpath)
    : getUploadRoot();

  try {
    fs.mkdirSync(target, { recursive: true });
  } catch (err) {
    // Never crash module loading on a read-only filesystem; callers handle
    // a missing directory as "file unavailable".
    // eslint-disable-next-line no-console
    console.warn("Unable to create upload directory:", target, err.message);
  }

  return target;
}

const UPLOAD_ROOT = getUploadRoot();

module.exports = {
  isVercel,
  getUploadRoot,
  ensureUploadRoot,
  UPLOAD_ROOT
};
