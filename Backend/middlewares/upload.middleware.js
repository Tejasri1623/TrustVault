const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { sanitizeFileName } = require("../utils/fileSecurity");

const uploadDir = path.join(__dirname, "..", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

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

module.exports = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 20
  }
});
