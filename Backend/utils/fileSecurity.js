const fs = require("fs");
const path = require("path");
const { TextDecoder } = require("util");

const allowedTypes = {
  ".pdf": ["application/pdf"],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".gif": ["image/gif"],
  ".webp": ["image/webp"],
  ".txt": ["text/plain"],
  ".md": ["text/markdown", "text/plain"],
  ".html": ["text/html"],
  ".htm": ["text/html"],
  ".csv": ["text/csv"],
  ".json": ["application/json"],
  ".xml": ["application/xml", "text/xml"],
  ".log": ["text/plain"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
};

const signatures = {
  ".pdf": (buffer) => buffer.subarray(0, 5).toString("ascii") === "%PDF-",
  ".png": (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  ".jpg": (buffer) => buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
  ".jpeg": (buffer) => buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
  ".gif": (buffer) => ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii")),
  ".webp": (buffer) => buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP",
  ".doc": (buffer) => buffer.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225])),
  ".xls": (buffer) => buffer.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225])),
  ".docx": (buffer) => buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])),
  ".xlsx": (buffer) => buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
};

function sanitizeFileName(fileName) {
  const normalized = String(fileName || "").replace(/\\/g, "/");
  const baseName = path.posix.basename(normalized)
    .replace(/[<>:"|?*\u0000-\u001f\u007f'`&]/g, "_")
    .trim()
    .slice(0, 180);
  return baseName || "document";
}

async function validateUploadedFile(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  const mimetypes = allowedTypes[extension];
  if (!mimetypes || !mimetypes.includes(file.mimetype)) {
    return false;
  }

  const handle = await fs.promises.open(file.path, "r");
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const content = buffer.subarray(0, bytesRead);
    const signatureCheck = signatures[extension];
    if (signatureCheck) {
      return signatureCheck(content);
    }

    const fileContent = await fs.promises.readFile(file.path);
    if (fileContent.includes(0)) return false;
    new TextDecoder("utf-8", { fatal: true }).decode(fileContent);
    return true;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  } finally {
    await handle.close();
  }
}

function resolvePrivateFilePath(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  if (!normalized.startsWith("uploads/")) {
    return null;
  }

  const uploadRoot = path.resolve(__dirname, "..", "uploads");
  const resolvedPath = path.resolve(__dirname, "..", normalized);
  const relativePath = path.relative(uploadRoot, resolvedPath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid private document path");
  }
  return resolvedPath;
}

module.exports = { allowedTypes, sanitizeFileName, validateUploadedFile, resolvePrivateFilePath };
