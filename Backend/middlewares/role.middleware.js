const logger = require("../config/logger").createChildLogger("RoleAuth");
const { recordAuditEvent } = require("../services/auditLog.service");

module.exports = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.userRole) {
        return res.status(401).json({ message: "Authentication required" });
      }

      if (!allowedRoles.includes(req.userRole)) {
        await recordAuditEvent({
          req,
          actorUserId: req.user.id,
          actorRole: req.userRole,
          action: req.params.id ? "document.role-access" : "authorization.role",
          outcome: "denied",
          resourceType: req.params.id ? "Document" : "Endpoint",
          resourceId: req.params.id || "",
          details: {
            reason: "Required role missing",
            requiredRoles: allowedRoles,
            endpoint: `${req.baseUrl}${req.path}`.slice(0, 300)
          }
        });
        return res.status(403).json({ message: "Forbidden: You do not have the required role to perform this action." });
      }

      next();
    } catch (error) {
      logger.error("Role auth error", { error: error.message });
      return res.status(500).json({ message: "Failed to verify access" });
    }
  };
};
