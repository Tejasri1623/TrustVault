const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { sanitizeFileName } = require("../utils/fileSecurity");
const { ensureUploadRoot } = require("../utils/uploadPaths");

// Resolve the upload directory for this runtime. On Vercel this is under
// /tmp (the only writable location); locally it remains Backend/uploads.
// The directory is created defensively and never under /var/task.
const uploadDir = ensureUploadRoot();

const allowedTypes = require("../utils/fileSecurity").allowedTypes;

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const safeName = sanitizeFileName(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, "_");

    cb(null, `${Date.now()}-${crypto.randomUUID()}-${safeName}`);
  }
});

const fileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();
  if (allowedTypes[extension]?.includes(file.mimetype)) {
    return cb(null, true);
  }

  return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 20
  }
});

// Expose for diagnostics/tests without changing the multer instance contract.
upload.uploadDir = uploadDir;

module.exports = upload;
