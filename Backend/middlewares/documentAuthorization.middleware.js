const mongoose = require("mongoose");
const Document = require("../models/document.model");
const logger = require("../config/logger").createChildLogger("DocumentAuthorization");
const { recordAuditEvent } = require("../services/auditLog.service");

function idEquals(value, userId) {
  return value != null && value.toString() === userId;
}

function canAccessDocument(document, userId, userRole, action) {
  if (!document || !userId) return false;
  if (action === "approve" || action === "reject") return false;
  if (idEquals(document.userId, userId)) return true;
  if (action === "activity") return false;
  if (action === "manage" || action === "delete") return false;

  const permission = (document.permissions || []).find(
    (entry) => idEquals(entry.userId, userId) && entry.revokedAt == null
  );
  if (action === "read" && permission && permission.access.some((access) => access === "read" || access === "edit")) {
    return true;
  }
  if (action === "edit" && permission && permission.access.includes("edit")) {
    return true;
  }

  return false;
}

function authorizeDocument(action) {
  return async (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid document id" });
    }

    try {
      const document = await Document.findById(req.params.id);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      const allowed = canAccessDocument(document, req.user?.id, req.userRole, action);
      if (!allowed) {
        await recordAuditEvent({
          req,
          actorUserId: req.user?.id,
          actorRole: req.userRole,
          action: `document.${action}`,
          outcome: "denied",
          resourceId: document._id,
          resourceName: document.fileName,
          details: { reason: "Document permission denied" }
        }).catch((auditError) => {
          logger.error("Failed to record denied document access", {
            documentId: document._id.toString(),
            error: auditError.message
          });
        });
        return res.status(404).json({ message: "Document not found" });
      }

      req.document = document;
      return next();
    } catch (error) {
      logger.error("Document authorization failed", {
        documentId: req.params.id,
        action,
        error: error.message
      });
      return res.status(503).json({ message: "Unable to verify document permissions" });
    }
  };
}

module.exports = { authorizeDocument, canAccessDocument };
