const mongoose = require("mongoose");

const auditEventSchema = new mongoose.Schema(
  {
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      immutable: true
    },
    actorRole: {
      type: String,
      default: "system",
      immutable: true
    },
    action: {
      type: String,
      required: true,
      immutable: true
    },
    resourceType: {
      type: String,
      default: "Document",
      immutable: true
    },
    resourceId: {
      type: String,
      default: "",
      immutable: true
    },
    resourceName: {
      type: String,
      default: "",
      immutable: true
    },
    outcome: {
      type: String,
      enum: ["success", "denied", "failure"],
      required: true,
      immutable: true
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      immutable: true
    },
    ipAddress: {
      type: String,
      default: "",
      immutable: true
    },
    userAgent: {
      type: String,
      default: "",
      immutable: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    strict: "throw"
  }
);

auditEventSchema.index({ createdAt: -1 });
auditEventSchema.index({ actorUserId:  1, createdAt: -1 });
auditEventSchema.index({ resourceId: 1, createdAt: -1 });

module.exports = mongoose.models.AuditEvent || mongoose.model("AuditEvent", auditEventSchema);
