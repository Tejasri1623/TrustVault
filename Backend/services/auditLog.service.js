const AuditEvent = require("../models/auditEvent.model");

async function recordAuditEvent({
  req,
  actorUserId,
  actorRole,
  action,
  outcome,
  resourceType = "Document",
  resourceId = "",
  resourceName = "",
  details = {}
}) {
  return AuditEvent.create({
    actorUserId: actorUserId || null,
    actorRole: actorRole || "system",
    action,
    outcome,
    resourceType,
    resourceId: String(resourceId || ""),
    resourceName: String(resourceName || ""),
    details,
    ipAddress: req?.ip || "",
    userAgent: String(req?.get?.("user-agent") || "").slice(0, 500)
  });
}

module.exports = { recordAuditEvent };
