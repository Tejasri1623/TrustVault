const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const logger = require("../config/logger").createChildLogger("Auth");
const { recordAuditEvent } = require("../services/auditLog.service");
const { normalizeSystemRole } = require("../services/rolePolicy.service");

module.exports = async (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    if (req.params?.id) {
      await recordAuditEvent({
        req,
        actorRole: "anonymous",
        action: "document.authentication",
        outcome: "denied",
        resourceId: req.params.id,
        details: { reason: "Missing authentication token" }
      }).catch((error) => {
        logger.error("Failed to record unauthenticated document access", { error: error.message });
      });
    }
    return res.status(401).send("No token");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Fetch full user from database
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      return res.status(401).send("User not found");
    }
    if ((decoded.tokenVersion || 0) !== (user.tokenVersion || 0)) {
      if (req.params?.id) {
        await recordAuditEvent({
          req,
          actorUserId: user._id,
          actorRole: normalizeSystemRole(user.role),
          action: "document.authentication",
          outcome: "denied",
          resourceId: req.params.id,
          details: { reason: "Revoked authentication token" }
        }).catch((auditError) => {
          logger.error("Failed to record revoked-token document access", { error: auditError.message });
        });
      }
      return res.status(401).send("Invalid token");
    }

    const systemRole = normalizeSystemRole(user.role);
    req.user = {
      id: user._id.toString()
    };
    req.userRole = systemRole;
    
    // Set for EJS templates
    res.locals.userRole = systemRole;
    res.locals.user = { ...user.toObject(), role: systemRole };

    next();
  } catch (err) {
    logger.error("Auth error", { error: err.message });
    if (req.params?.id) {
      await recordAuditEvent({
        req,
        actorRole: "anonymous",
        action: "document.authentication",
        outcome: "denied",
        resourceId: req.params.id,
        details: { reason: "Invalid authentication token" }
      }).catch((auditError) => {
        logger.error("Failed to record invalid-token document access", { error: auditError.message });
      });
    }
    res.status(401).send("Invalid token");
  }
};
