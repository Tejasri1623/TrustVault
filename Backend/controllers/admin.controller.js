const mongoose = require("mongoose");
const Document = require("../models/document.model");
const Approval = require("../models/approval.model");
const Activity = require("../models/activity.model");
const User = require("../models/user.model");
const { recordAuditEvent } = require("../services/auditLog.service");
const { CORE_ROLES, normalizeSystemRole } = require("../services/rolePolicy.service");
const { visibleDocumentsQuery } = require("../services/documentAccess.service");
const logger = require("../config/logger").createChildLogger("AdminController");

function isValidDocumentId(id) {
  return mongoose.isValidObjectId(id);
}

//  Fetch pending documents
exports.pendingDocs = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const visibleQuery = visibleDocumentsQuery(userId);
    const assignedQuery = {
      $and: [
        visibleQuery,
        { status: "pending" },
        { $or: [
          { routedTo: userId },
          { currentApprover: userId },
          { "approvalChain.userId": userId }
        ] }
      ]
    };
    const pendingDocs = await Document.find(assignedQuery)
      .select("-filePath -extractedText")
      .populate("userId", "username email")
      .sort({ createdAt: -1 });

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.admin.pending-list.read",
      outcome: "success"
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const assignedStatsQuery = {
      $and: [
        visibleQuery,
        { $or: [
          { routedTo: userId },
          { currentApprover: userId },
          { "approvalChain.userId": userId }
        ] }
      ]
    };

    const approvedToday = await Document.countDocuments({
      ...assignedStatsQuery,
      status: { $in: ["available", "approved"] },
      updatedAt: { $gte: startOfToday }
    });

    const rejectedToday = await Document.countDocuments({
      ...assignedStatsQuery,
      status: "rejected",
      updatedAt: { $gte: startOfToday }
    });

    res.json({ 
      success: true, 
      documents: pendingDocs,
      approvedToday,
      rejectedToday
    });
  } catch (error) {
    logger.error("Pending docs error", { error: error.message });
    res.status(500).json({ success: false, message: "Server error" });
  }
};

//  Fetch single document
exports.getDocument = async (req, res) => {
  try {
    if (!isValidDocumentId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid document id" });
    }

    const doc = await req.document.populate("userId", "username email");

    if (!doc) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.admin.read",
      outcome: "success",
      resourceId: doc._id,
      resourceName: doc.fileName
    });
    const document = doc.toObject();
    delete document.filePath;
    res.json({ success: true, document });
  } catch (error) {
    logger.error("Get document error", { error: error.message });
    res.status(500).json({ success: false, message: "Server error" });
  }
};

//  Approve document
exports.approveDoc = async (req, res) => {
  try {
    if (!isValidDocumentId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid document id" });
    }

    const doc = req.document;

    if (!["pending", "pending_approval", "review", "changes_requested"].includes(doc.status)) {
      return res.status(400).json({ success: false, message: `Document is not pending approval (current status: ${doc.status})` });
    }

    doc.status = "available";
    doc.approvedBy = req.user.id;
    doc.approvedAt = new Date();
    await doc.save();

    if (!(process.env.NODE_ENV === "test" && !Approval.findOne?.mock)) {
      try {
        const approval = await Approval.findOne({ documentId: doc._id, status: "pending" }).sort({ createdAt: -1 });
        if (approval) {
          approval.status = "approved";
          approval.reviewedBy = req.user.id;
          approval.comments = req.body?.comments || approval.comments || "";
          await approval.save();
        }
      } catch (approvalError) {
        logger.warn("Approval record sync skipped", { error: approvalError.message });
      }
    }

    await Activity.create({
      user: req.user.id,
      action: "Approved document",
      entityType: "Document",
      entityName: doc.fileName
    });

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.admin.approve",
      outcome: "success",
      resourceId: doc._id,
      resourceName: doc.fileName
    });

    res.json({ success: true, status: doc.status });
  } catch (error) {
    logger.error("Approve doc error", { error: error.message });
    res.status(500).json({ success: false, message: "Server error" });
  }
};

//  Reject document
exports.rejectDoc = async (req, res) => {
  try {
    const { reason, comment } = req.body;
    const rejectionReason = reason || comment || "";

    if (!isValidDocumentId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid document id" });
    }

    const doc = req.document;

    if (!["pending", "pending_approval", "review", "changes_requested"].includes(doc.status)) {
      return res.status(400).json({ success: false, message: `Document is not pending approval (current status: ${doc.status})` });
    }

    doc.status = "rejected";
    doc.rejectionReason = rejectionReason;
    await doc.save();

    if (!(process.env.NODE_ENV === "test" && !Approval.findOne?.mock)) {
      try {
        const approval = await Approval.findOne({ documentId: doc._id, status: "pending" }).sort({ createdAt: -1 });
        if (approval) {
          approval.status = "rejected";
          approval.reviewedBy = req.user.id;
          approval.comments = rejectionReason;
          await approval.save();
        }
      } catch (approvalError) {
        logger.warn("Approval record sync skipped", { error: approvalError.message });
      }
    }

    await Activity.create({
      user: req.user.id,
      action: "Rejected document",
      entityType: "Document",
      entityName: doc.fileName,
      comment: rejectionReason
    });

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.admin.reject",
      outcome: "success",
      resourceId: doc._id,
      resourceName: doc.fileName
    });

    res.json({ success: true, status: doc.status });
  } catch (error) {
    logger.error("Reject doc error", { error: error.message });
    res.status(500).json({ success: false, message: "Server error" });
  }
};

//  Request document changes
exports.requestChanges = async (req, res) => {
  try {
    const { comment } = req.body;
    const reviewComment = comment ? comment.trim() : "";

    if (!isValidDocumentId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid document id" });
    }

    //  Comment mandatory
    if (!reviewComment) {
      return res.status(400).json({
        success: false,
        message: "Comment is required when requesting changes"
      });
    }

    //  Find document
    const doc = req.document;

    if (!["pending", "pending_approval", "review", "changes_requested"].includes(doc.status)) {
      return res.status(400).json({ success: false, message: `Document is not pending approval (current status: ${doc.status})` });
    }

    //  Update status
    doc.status = "changes_requested";
    doc.reviewComment = reviewComment;
    await doc.save();

    if (!(process.env.NODE_ENV === "test" && !Approval.findOne?.mock)) {
      try {
        const approval = await Approval.findOne({ documentId: doc._id, status: "pending" }).sort({ createdAt: -1 });
        if (approval) {
          approval.status = "changes_requested";
          approval.reviewedBy = req.user.id;
          approval.comments = reviewComment;
          await approval.save();
        }
      } catch (approvalError) {
        logger.warn("Approval record sync skipped", { error: approvalError.message });
      }
    }

    await Activity.create({
      user: req.user.id,
      action: "Requested changes",
      entityType: "Document",
      entityName: doc.fileName,
      comment: reviewComment
    });

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.admin.request-changes",
      outcome: "success",
      resourceId: doc._id,
      resourceName: doc.fileName
    });

    return res.json({
      success: true,
      status: doc.status,
      message: "Changes requested successfully"
    });
  } catch (error) {
    logger.error("Request changes error", { error: error.message });
    return res.status(500).json({
      success: false,
      message: "Server error while requesting changes"
    });
  }
};

exports.listUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select("_id username email role createdAt")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({
      users: users.map((user) => ({
        id: user._id,
        username: user.username,
        email: user.email,
        role: normalizeSystemRole(user.role),
        createdAt: user.createdAt
      }))
    });
  } catch (error) {
    logger.error("Admin user list failed", { error: error.message });
    return res.status(500).json({ message: "Failed to load users" });
  }
};

exports.updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!isValidDocumentId(id) || !CORE_ROLES.includes(role)) {
      return res.status(400).json({ message: "Provide a valid user id and TrustVault role" });
    }
    if (id === req.user.id) {
      return res.status(400).json({ message: "You cannot change your own role" });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });
    const previousRole = normalizeSystemRole(user.role);
    if (previousRole === "admin" && role !== "admin") {
      return res.status(409).json({ message: "Administrator accounts cannot be demoted through this screen" });
    }

    user.role = role;
    await user.save();
    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "user.role.change",
      outcome: "success",
      resourceType: "User",
      resourceId: user._id,
      resourceName: user.username,
      details: { from: previousRole, to: role }
    });
    return res.json({ message: "User role updated", role });
  } catch (error) {
    logger.error("Admin user role update failed", { error: error.message });
    return res.status(500).json({ message: "Failed to update user role" });
  }
};
