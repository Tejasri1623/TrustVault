const User = require("../models/user.model");
const logger = require("../config/logger").createChildLogger("AdminAuth");
const { recordAuditEvent } = require("../services/auditLog.service");
const { normalizeSystemRole } = require("../services/rolePolicy.service");

module.exports = async (req, res, next) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const user = await User.findById(req.user.id).select("role");

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const systemRole = normalizeSystemRole(user.role);
    req.userRole = systemRole;

    if (systemRole !== "admin") {
      await recordAuditEvent({
        req,
        actorUserId: user._id,
        actorRole: systemRole,
        action: req.params.id ? "document.admin.access" : "admin.access",
        outcome: "denied",
        resourceType: req.params.id ? "Document" : "AdminArea",
        resourceId: req.params.id || "",
        details: { reason: "Administrator role required", method: req.method }
      });
      return res.status(403).json({ message: "Admin access only" });
    }

    next();
  } catch (error) {
    logger.error("Admin auth error", { error: error.message });
    return res.status(500).json({ message: "Failed to verify admin access" });
  }
};
