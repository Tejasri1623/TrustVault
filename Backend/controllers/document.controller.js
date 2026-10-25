const mongoose = require("mongoose");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const Document = require("../models/document.model");
const Approval = require("../models/approval.model");
const Activity = require("../models/activity.model");
const AuditEvent = require("../models/auditEvent.model");
const User = require("../models/user.model");
const extractText = require("../services/ocr.service");
const { analyzeDocument, extractKeywords, generateSummary, getRoleForDepartment } = require("../services/ai.service");
const { recordAuditEvent } = require("../services/auditLog.service");
const { visibleDocumentsQuery } = require("../services/documentAccess.service");
const { sanitizeFileName, validateUploadedFile, resolvePrivateFilePath } = require("../utils/fileSecurity");
const logger = require("../config/logger").createChildLogger("DocumentController");

const STATUS_ALIASES = {
  pending: "pending",
  processing: "processing",
  review: "review",
  "in review": "review",
  available: "available",
  approved: "approved",
  rejected: "rejected",
  "changes requested": "changes_requested",
  changes_requested: "changes_requested",
  archived: "archived"
};

function normalizeStatus(status) {
  return STATUS_ALIASES[String(status || "").trim().toLowerCase()];
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── AI-Powered Document Enrichment ─────────────────────────────────────────
// This function is exported so the BullMQ enrichmentWorker can call it directly.
async function enrichDocument(docId, filePath, originalName) {
  let text = "";

  try {
    text = await extractText(filePath);
  } catch (err) {
    logger.error("Text extraction failed", { originalName, error: err.message });
  }

  // Run AI analysis (Gemini or fallback)
  let analysis;
  try {
    analysis = await analyzeDocument(text);
  } catch (err) {
    logger.error("AI analysis failed", { originalName, error: err.message });
    analysis = {
      documentType: "Other",
      department: "General",
      summary: "No summary available.",
      keywords: extractKeywords(text),
      confidence: 0
    };
  }

  // Find the appropriate department manager to route the document to
  let routedToUser = null;
  try {
    const targetRole = getRoleForDepartment(analysis.department);

    // Try to find a user with the matching department role
    routedToUser = await User.findOne({ role: targetRole });

    // Fallback: if no department manager found, route to admin
    if (!routedToUser) {
      routedToUser = await User.findOne({ role: "admin" });
    }
  } catch (err) {
    logger.error("Routing lookup failed", { error: err.message });
  }

  const requiresApproval = !!routedToUser;

  // Update document with all AI analysis data
  const updateData = {
    extractedText: text,
    summary: analysis.summary || generateSummary(text) || "No summary available.",
    keywords: analysis.keywords.length > 0 ? analysis.keywords : extractKeywords(text),
    documentType: analysis.documentType,
    department: analysis.department,
    aiSummary: analysis.summary,
    confidence: analysis.confidence,
    status: "available"
  };

  if (routedToUser) {
    updateData.routedTo = routedToUser._id;
  }

  const updatedDoc = await Document.findByIdAndUpdate(docId, updateData, { new: true });

  if (updatedDoc) {
    // Create an approval record only when a genuine approver was resolved.
    if (requiresApproval) {
      await Approval.create({
        documentId: updatedDoc._id,
        requestedBy: updatedDoc.userId,
        status: "pending"
      });
    }

    // Log AI routing activity
    const routedToName = routedToUser ? routedToUser.username : "No approver (available)";
    await Activity.create({
      user: updatedDoc.userId,
      action: `AI routed document to ${analysis.department} department`,
      entityType: "Document",
      entityName: updatedDoc.fileName,
      comment: `Type: ${analysis.documentType} | Dept: ${analysis.department} | Routed to: ${routedToName} | Confidence: ${Math.round(analysis.confidence * 100)}%`
    });

    logger.info(`✓ AI Analysis Complete: "${originalName}" → Type: ${analysis.documentType}, Dept: ${analysis.department}, Routed to: ${routedToName}`);
  }
}

// ─── Enrichment Queue (BullMQ with in-process fallback) ─────────────────────
//
// When Redis is configured (REDIS_HOST), jobs are pushed to a BullMQ queue
// that persists in Redis. The enrichmentWorker processes them.
//
// When Redis is NOT configured (local dev without Redis), we fall back to
// sequential in-process execution so the system still works.

let _bullmqAvailable = false;
let _enrichmentQueue = null;

try {
  if (process.env.REDIS_HOST) {
    const { enrichmentQueue } = require("../src/config/queue");
    _enrichmentQueue = enrichmentQueue;
    _bullmqAvailable = true;
  }
} catch (err) {
  logger.warn("BullMQ enrichment queue not available, using in-process fallback", { error: err.message });
}

// In-process fallback queue (only used when Redis is not available)
const _fallbackQueue = [];
let _isFallbackProcessing = false;

async function processFallbackQueue() {
  if (_isFallbackProcessing) return;
  _isFallbackProcessing = true;

  while (_fallbackQueue.length > 0) {
    const { docId, filePath, originalName } = _fallbackQueue.shift();
    try {
      await enrichDocument(docId, filePath, originalName);
    } catch (err) {
      logger.error("Enrichment failed (fallback queue)", { docId, error: err.message });
      try {
        const updatedDoc = await Document.findByIdAndUpdate(docId, {
          status: "pending",
          summary: "No summary available."
        }, { new: true });
        
        if (updatedDoc) {
          await Approval.create({
            documentId: updatedDoc._id,
            requestedBy: updatedDoc.userId,
            status: "pending"
          });
        }
      } catch (updateErr) {
        logger.error("Failed to mark document pending after enrichment error", { docId, error: updateErr.message });
      }
    }
  }

  _isFallbackProcessing = false;
}

function queueDocumentEnrichment(docId, filePath, originalName) {
  if (_bullmqAvailable && _enrichmentQueue) {
    // Production path: persistent Redis-backed queue
    _enrichmentQueue.add('enrich-document', {
      docId: docId.toString(),
      filePath,
      originalName
    }).then(() => {
      logger.info("Document queued for enrichment (BullMQ)", { docId: docId.toString(), originalName });
    }).catch(err => {
      logger.error("Failed to queue enrichment job, falling back to in-process", { docId: docId.toString(), error: err.message });
      // Fallback: process in-memory if Redis queue fails
      _fallbackQueue.push({ docId, filePath, originalName });
      processFallbackQueue();
    });
  } else {
    // Development fallback: in-process sequential queue
    _fallbackQueue.push({ docId, filePath, originalName });
    processFallbackQueue();
  }
}


exports.upload = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).send("No files");
    }

    const validFiles = [];
    for (const file of req.files) {
      validFiles.push(await validateUploadedFile(file));
    }
    if (validFiles.some((isValid) => !isValid)) {
      await Promise.all(req.files.map((file) => fs.promises.unlink(file.path).catch((error) => {
        logger.warn("Failed to remove rejected upload", { path: file.path, error: error.message });
      })));
      await recordAuditEvent({
        req,
        actorUserId: req.user.id,
        actorRole: req.userRole,
        action: "document.upload",
        outcome: "denied",
        details: { reason: "File content did not match an allowed type" }
      });
      return res.status(400).json({ message: "File content does not match an allowed file type" });
    }

    const userId = new mongoose.Types.ObjectId(req.user.id);

    for (const file of req.files) {
      // Calculate file hash asynchronously to avoid blocking the event loop
      const fileBuffer = await fs.promises.readFile(file.path);
      const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // Check for duplicate
      const existingDoc = await Document.findOne({ fileHash });
      if (existingDoc) {
        logger.warn(`Skipping duplicate upload "${file.originalname}" (hash match)`);
        
        await Activity.create({
          user: req.user.id,
          action: "Manual upload: duplicate blocked",
          entityType: "Document",
          entityName: file.originalname,
          comment: "Blocked an identical upload"
        });
        await recordAuditEvent({
          req,
          actorUserId: req.user.id,
          actorRole: req.userRole,
          action: "document.upload",
          outcome: "denied",
          resourceId: existingDoc._id,
          resourceName: sanitizeFileName(file.originalname),
          details: { reason: "Duplicate content" }
        });

        // Remove the duplicate uploaded file asynchronously
        await fs.promises.unlink(file.path).catch(err => 
          logger.warn(`Failed to unlink duplicate file ${file.path}`, { error: err.message })
        );
        continue;
      }

      const doc = await Document.create({
        userId,
        fileName: sanitizeFileName(file.originalname),
        fileType: path.extname(file.originalname).replace(/^\./, "").toLowerCase() || "unknown",
        fileHash,
        filePath: `uploads/${file.filename}`,
        extractedText: "",
        summary: "",
        keywords: [],
        status: "processing"
      });

      await Activity.create({
        user: req.user.id,
        action: "Uploaded document",
        entityType: "Document",
        entityName: doc.fileName
      });

      queueDocumentEnrichment(doc._id, file.path, file.originalname);

      await recordAuditEvent({
        req,
        actorUserId: req.user.id,
        actorRole: req.userRole,
        action: "document.upload",
        outcome: "success",
        resourceId: doc._id,
        resourceName: doc.fileName,
        details: { fileType: doc.fileType, size: file.size }
      });

      logger.info("Document saved", { docId: doc._id });
    }

    res.json({ message: "Uploaded successfully", processing: true });

  } catch (err) {
    logger.error("Upload error", { error: err.message });
    await Promise.all((req.files || []).map(async (file) => {
      try {
        const referencedDocument = await Document.exists({ filePath: `uploads/${file.filename}` });
        if (!referencedDocument) await fs.promises.unlink(file.path);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") {
          logger.error("Failed to clean up unreferenced upload", {
            path: file.path,
            error: cleanupError.message
          });
        }
      }
    }));
    res.status(500).json({ message: "Upload failed" });
  }
};


exports.getDocuments = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const baseQuery = visibleDocumentsQuery(userId);

    const docs = await Document.find(baseQuery)
      .select("-filePath -extractedText")
      .populate("routedTo", "username email role")
      .sort({ createdAt: -1 });

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.list.read",
      outcome: "success"
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(docs);
  } catch (err) {
    logger.error("Fetch docs error", { error: err.message });
    res.status(500).send("Failed to fetch documents");
  }
};


exports.myDocuments = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const baseQuery = visibleDocumentsQuery(userId);

    const docs = await Document.find(baseQuery)
      .select("-filePath -extractedText")
      .populate("routedTo", "username email role")
      .sort({ createdAt: -1 });

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.my-list.read",
      outcome: "success"
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(docs);
  } catch (err) {
    logger.error("Fetch my docs error", { error: err.message });
    res.status(500).send("Failed to fetch documents");
  }
};


exports.stats = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const baseQuery = visibleDocumentsQuery(userId);

    const [total, today, pending, archived, monthlyAgg] = await Promise.all([
      Document.countDocuments(baseQuery),
      Document.countDocuments({
        ...baseQuery,
        createdAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }),
      0,
      0,
      Document.aggregate([
        { $match: baseQuery },
        {
          $group: {
            _id: { $month: "$createdAt" },
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const monthly = Array(12).fill(0);
    monthlyAgg.forEach(entry => {
      const monthIndex = entry._id - 1;
      if (monthIndex >= 0 && monthIndex < 12) {
        monthly[monthIndex] = entry.count;
      }
    });

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.stats.read",
      outcome: "success"
    });
    res.json({
      total,
      today,
      pending,
      archived,
      monthly
    });

  } catch (err) {
    logger.error("Stats error", { error: err.message });
    res.status(500).send("Stats error");
  }
};

exports.search = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    let { q, status, type, date, department, owner, category } = req.query;

    // Coerce arrays to strings to prevent DoS via type juggling
    q = typeof q === 'string' ? q : (Array.isArray(q) ? q[0] : (q ? String(q) : ''));
    status = typeof status === 'string' ? status : (Array.isArray(status) ? status[0] : (status ? String(status) : ''));
    type = typeof type === 'string' ? type : (Array.isArray(type) ? type[0] : (type ? String(type) : ''));
    date = typeof date === 'string' ? date : (Array.isArray(date) ? date[0] : (date ? String(date) : ''));
    department = typeof department === 'string' ? department : (Array.isArray(department) ? department[0] : (department ? String(department) : ''));
    owner = typeof owner === 'string' ? owner : (Array.isArray(owner) ? owner[0] : (owner ? String(owner) : ''));
    category = typeof category === 'string' ? category : (Array.isArray(category) ? category[0] : (category ? String(category) : ''));

    const query = {};
    const clauses = [];
    clauses.push(visibleDocumentsQuery(userId));

    if (q && q.trim() !== "") {
      const qRegex = new RegExp(escapeRegex(q.trim()), "i");
      const matchingOwners = await User.find({
        $or: [{ username: qRegex }, { email: qRegex }]
      }).select("_id");
      const searchTerms = [
        { fileName: qRegex },
        { documentType: qRegex },
        { department: qRegex },
        { keywords: qRegex }
      ];
      if (matchingOwners.length) {
        searchTerms.push({ userId: { $in: matchingOwners.map((user) => user._id) } });
      }
      clauses.push({ $or: searchTerms });
    }

    if (owner && owner.trim()) {
      const ownerRegex = new RegExp(escapeRegex(owner.trim()), "i");
      const matchingOwners = await User.find({
        $or: [{ username: ownerRegex }, { email: ownerRegex }]
      }).select("_id");
      clauses.push({ userId: { $in: matchingOwners.map((user) => user._id) } });
    }

    const normalizedStatus = null;
    if (false && normalizedStatus) {
      query.status = normalizedStatus;
    }

    if (type && type !== "all") {
      if (type.toLowerCase() === 'jpg') {
        query.fileType = { $regex: new RegExp(`^(jpg|jpeg)$`, "i") };
      } else {
        query.fileType = { $regex: new RegExp(`^${escapeRegex(type)}$`, "i") };
      }
    }

    // Department filter
    const selectedCategory = category || department;
    if (selectedCategory && selectedCategory !== "all") {
      const categoryRegex = new RegExp(`^${escapeRegex(selectedCategory)}$`, "i");
      clauses.push({
        $or: [
          { department: categoryRegex },
          { documentType: categoryRegex }
        ]
      });
    }

    if (date) {
      const start = new Date(date);
      if (Number.isNaN(start.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }

      const end = new Date(date);
      end.setHours(23, 59, 59, 999);

      query.createdAt = { $gte: start, $lte: end };
    }

    if (clauses.length) query.$and = clauses;
    const docs = await Document.find(query)
      .select("-filePath -extractedText")
      .populate("routedTo", "username email role")
      .sort({ createdAt: -1 });

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.search",
      outcome: "success",
      resourceType: "Document",
      details: { hasQuery: Boolean(q), hasOwnerFilter: Boolean(owner), hasDateFilter: Boolean(date) }
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(docs);

  } catch (err) {
    logger.error("Search error", { error: err.message });
    res.status(500).json([]);
  }
};

exports.recent = async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const baseQuery = visibleDocumentsQuery(userId);

    const docs = await Document.find(baseQuery)
      .select("-filePath -extractedText")
      .sort({ createdAt: -1 })
      .limit(5);

    const data = docs.map(doc => ({
      document: doc.fileName,
      time: doc.createdAt
    }));

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.recent.read",
      outcome: "success"
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(data);
  } catch (err) {
    logger.error("Recent error", { error: err.message });
    res.status(500).json([]);
  }
};

exports.deleteDocument = async (req, res) => {
  try {
    const doc = req.document;
    const localPath = resolvePrivateFilePath(doc.filePath);
    await doc.deleteOne();
    if (localPath) {
      await fs.promises.unlink(localPath).catch((error) => {
        if (error.code !== "ENOENT") {
          logger.error("Failed to delete private document file", {
            documentId: doc._id.toString(),
            error: error.message
          });
        }
      });
    }

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.delete",
      outcome: "success",
      resourceId: doc._id,
      resourceName: doc.fileName
    });

    res.json({ message: "Document deleted successfully" });
  } catch (err) {
    logger.error("Delete error", { error: err.message });
    res.status(500).json({ message: "Failed to delete document" });
  }
};

exports.downloadDocument = async (req, res) => {
  try {
    const doc = req.document;
    const filePath = resolvePrivateFilePath(doc.filePath);
    if (!filePath) {
      return res.status(404).json({ message: "Document file is unavailable in local storage" });
    }

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.download",
      outcome: "success",
      resourceId: doc._id,
      resourceName: doc.fileName
    });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.download(filePath, sanitizeFileName(doc.fileName), (error) => {
      if (error) {
        logger.error("Document download response failed", {
          documentId: doc._id.toString(),
          error: error.message
        });
        if (!res.headersSent) res.status(500).json({ message: "Failed to download document" });
      }
    });
  } catch (err) {
    logger.error("Download error", { error: err.message });
    res.status(500).send("Failed to download document");
  }
};

exports.viewDocument = async (req, res) => {
  try {
    const doc = req.document;
    const filePath = resolvePrivateFilePath(doc.filePath);
    if (!filePath) {
      return res.status(404).json({ message: "Document file is unavailable in local storage" });
    }

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.read",
      outcome: "success",
      resourceId: doc._id,
      resourceName: doc.fileName
    });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const safeFileName = sanitizeFileName(doc.fileName);
    if (["html", "htm"].includes(String(doc.fileType).toLowerCase())) {
      res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
      return res.download(filePath, safeFileName);
    }
    res.setHeader("Content-Disposition", `inline; filename="${safeFileName}"`);
    res.sendFile(filePath);
  } catch (err) {
    logger.error("View error", { error: err.message });
    res.status(500).send("Failed to view document");
  }
};

// ─── AI Analysis Endpoint ───────────────────────────────────────────────────
exports.replaceDocument = async (req, res) => {
  try {
    const doc = req.document;
    const file = Array.isArray(req.files) && req.files.length > 0 ? req.files[0] : req.file;
    if (!file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const isValid = await validateUploadedFile(file);
    if (!isValid) {
      await fs.promises.unlink(file.path).catch(() => {});
      await recordAuditEvent({
        req,
        actorUserId: req.user.id,
        actorRole: req.userRole,
        action: "document.replace",
        outcome: "denied",
        resourceId: doc._id,
        resourceName: doc.fileName,
        details: { reason: "File content did not match an allowed type" }
      });
      return res.status(400).json({ message: "File content does not match an allowed file type" });
    }

    const oldFilePath = resolvePrivateFilePath(doc.filePath);
    const fileBuffer = await fs.promises.readFile(file.path);
    const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

    const duplicate = await Document.findOne({ fileHash, _id: { $ne: doc._id } });
    if (duplicate) {
      await fs.promises.unlink(file.path).catch(() => {});
      return res.status(409).json({ message: "Duplicate content" });
    }

    const previousVersion = {
      version: Array.isArray(doc.versions) ? doc.versions.length + 1 : 1,
      fileName: doc.fileName,
      fileType: doc.fileType,
      fileHash: doc.fileHash,
      filePath: doc.filePath,
      replacedBy: req.user.id,
      uploadedBy: req.user.id,
      actor: req.user.id,
      userId: req.user.id,
      user: req.user.id,
      replacedAt: new Date(),
      uploadedAt: new Date(),
      createdAt: new Date(),
      timestamp: new Date(),
      date: new Date()
    };

    if (!Array.isArray(doc.versions)) doc.versions = [];
    if (!Array.isArray(doc.versionHistory)) doc.versionHistory = [];
    if (!Array.isArray(doc.fileVersions)) doc.fileVersions = [];
    doc.versions.push(previousVersion);
    doc.versionHistory.push(previousVersion);
    doc.fileVersions.push(previousVersion);
    doc.revisions = doc.versions;

    doc.fileName = sanitizeFileName(file.originalname);
    doc.fileType = path.extname(file.originalname).replace(/^\\./, "").toLowerCase() || "unknown";
    doc.fileHash = fileHash;
    doc.filePath = `uploads/${file.filename}`;
    doc.extractedText = "";
    doc.summary = "";
    doc.keywords = [];
    doc.status = "processing";
    doc.approvedBy = undefined;
    doc.approvedAt = undefined;
    doc.rejectionReason = undefined;
    doc.reviewComment = undefined;

    await doc.save();

    if (oldFilePath) {
      await fs.promises.unlink(oldFilePath).catch((error) => {
        logger.warn("Failed to remove replaced document", { path: oldFilePath, error: error.message });
      });
    }

    await Activity.create({
      user: req.user.id,
      action: "Replaced document file",
      entityType: "Document",
      entityName: doc.fileName
    });

    queueDocumentEnrichment(doc._id, file.path, file.originalname);

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.replace",
      outcome: "success",
      resourceId: doc._id,
      resourceName: doc.fileName
    });

    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, document: doc });
  } catch (err) {
    logger.error("Replace document error", { error: err.message });
    res.status(500).json({ message: "Failed to replace document" });
  }
};


exports.getAnalysis = async (req, res) => {
  try {
    const doc = req.document;
    await doc.populate(["routedTo", "userId"]);

    const response = {
      success: true,
      analysis: {
        _id: doc._id,
        fileName: doc.fileName,
        fileType: doc.fileType,
        documentType: doc.documentType || "Unknown",
        department: doc.department || "General",
        aiSummary: doc.aiSummary || doc.summary || "No summary available.",
        summary: doc.summary || "",
        keywords: doc.keywords || [],
        confidence: doc.confidence || 0,
        status: doc.status,
        routedTo: doc.routedTo ? {
          _id: doc.routedTo._id,
          username: doc.routedTo.username,
          email: doc.routedTo.email,
          role: doc.routedTo.role
        } : null,
        uploadedBy: doc.userId ? {
          username: doc.userId.username,
          email: doc.userId.email
        } : null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
      }
    };

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.analysis.read",
      outcome: "success",
      resourceId: doc._id,
      resourceName: doc.fileName
    });
    res.json(response);
  } catch (err) {
    logger.error("Analysis fetch error", { error: err.message });
    res.status(500).json({ success: false, message: "Failed to fetch analysis" });
  }
};

// ─── Re-analyze a single document ───────────────────────────────────────────
exports.reanalyzeSingle = async (req, res) => {
  try {
    const doc = req.document;
    const filePath = resolvePrivateFilePath(doc.filePath);
    if (!filePath) {
      return res.status(404).json({ success: false, message: "Document file is unavailable in local storage" });
    }

    // Mark as processing
    doc.status = "processing";
    await doc.save();

    // Re-run enrichment in background
    queueDocumentEnrichment(doc._id, filePath, doc.fileName);
    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.reanalyze",
      outcome: "success",
      resourceId: doc._id,
      resourceName: doc.fileName
    });

    res.json({ success: true, message: "Re-analysis started" });
  } catch (err) {
    logger.error("Reanalyze error", { error: err.message });
    res.status(500).json({ success: false, message: "Failed to start re-analysis" });
  }
};

exports.documentActivity = async (req, res) => {
  try {
    const events = await AuditEvent.find({ resourceId: req.document._id.toString() })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("actorUserId", "username email");

    return res.json({
      events: events.map((event) => ({
        createdAt: event.createdAt,
        actor: event.actorUserId ? {
          username: event.actorUserId.username,
          email: event.actorUserId.email
        } : { role: event.actorRole },
        action: event.action,
        outcome: event.outcome,
        details: event.details
      }))
    });
  } catch (error) {
    logger.error("Document activity fetch failed", { error: error.message });
    return res.status(500).json({ message: "Failed to load document activity" });
  }
};

exports.updateMetadata = async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const allowedFields = ["fileName", "documentType", "department"];
    const updates = {};
    for (const field of allowedFields) {
      if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
      if (typeof body[field] !== "string") {
        return res.status(400).json({ message: `${field} must be text` });
      }
      const value = body[field].trim();
      if (!value || value.length > (field === "fileName" ? 180 : 120)) {
        return res.status(400).json({ message: `${field} must be non-empty and within the allowed length` });
      }
      updates[field] = field === "fileName" ? sanitizeFileName(value) : value;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "Provide fileName, documentType, or department to update" });
    }

    Object.assign(req.document, updates);
    await req.document.save();
    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.metadata.update",
      outcome: "success",
      resourceId: req.document._id,
      resourceName: req.document.fileName,
      details: { fields: Object.keys(updates) }
    });
    return res.json({
      message: "Document metadata updated",
      document: {
        _id: req.document._id,
        fileName: req.document.fileName,
        documentType: req.document.documentType,
        department: req.document.department,
        updatedAt: req.document.updatedAt
      }
    });
  } catch (error) {
    logger.error("Document metadata update failed", { error: error.message });
    return res.status(500).json({ message: "Failed to update document metadata" });
  }
};

exports.listPermissions = async (req, res) => {
  try {
    const activePermissions = (req.document.permissions || []).filter((permission) => permission.revokedAt == null);
    const userIds = activePermissions.map((permission) => permission.userId);
    const users = await User.find({ _id: { $in: userIds } }).select("_id email").lean();
    const emailsById = new Map(users.map((user) => [user._id.toString(), user.email]));
    return res.json({
      permissions: activePermissions.map((permission) => ({
        userId: permission.userId.toString(),
        email: emailsById.get(permission.userId.toString()) || "",
        access: permission.access,
        grantedBy: permission.grantedBy?.toString() || "",
        grantedAt: permission.grantedAt || null
      }))
    });
  } catch (error) {
    logger.error("Document permission list failed", { error: error.message });
    return res.status(500).json({ message: "Failed to load document permissions" });
  }
};

exports.grantPermission = async (req, res) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const access = req.body.access;
    if (!email || !Array.isArray(access) || access.length === 0
      || access.some((permission) => !["read", "edit"].includes(permission))) {
      return res.status(400).json({ message: "Provide a user email and read/edit access" });
    }

    const targetUser = await User.findOne({ email }).select("_id email");
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }
    if (targetUser._id.toString() === req.document.userId.toString()) {
      return res.status(400).json({ message: "The document owner already has full access" });
    }

    const uniqueAccess = [...new Set(access)];
    const grantedAt = new Date();
    const permissionFields = {
      "permissions.$.access": uniqueAccess,
      "permissions.$.grantedBy": req.user.id,
      "permissions.$.grantedAt": grantedAt,
      "permissions.$.revokedAt": null,
      "permissions.$.revokedBy": null
    };
    let permissionUpdate = await Document.updateOne(
      {
        _id: req.document._id,
        "permissions.userId": targetUser._id
      },
      { $set: permissionFields }
    );
    if (permissionUpdate.matchedCount === 0) {
      permissionUpdate = await Document.updateOne(
        {
          _id: req.document._id,
          permissions: { $not: { $elemMatch: { userId: targetUser._id } } }
        },
        {
          $push: {
            permissions: {
              userId: targetUser._id,
              access: uniqueAccess,
              grantedBy: req.user.id,
              grantedAt,
              revokedAt: null,
              revokedBy: null
            }
          }
        }
      );
      if (permissionUpdate.modifiedCount === 0) {
        permissionUpdate = await Document.updateOne(
          {
            _id: req.document._id,
            "permissions.userId": targetUser._id
          },
          { $set: permissionFields }
        );
      }
    }
    if (permissionUpdate.matchedCount === 0) {
      return res.status(404).json({ message: "Document not found" });
    }

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.permission.grant",
      outcome: "success",
      resourceId: req.document._id,
      resourceName: req.document.fileName,
      details: { targetUserId: targetUser._id.toString(), access: uniqueAccess }
    });

    return res.json({
      message: "Document permission saved",
      permission: {
        userId: targetUser._id,
        email: targetUser.email,
        access: uniqueAccess,
        grantedBy: req.user.id,
        grantedAt
      }
    });
  } catch (error) {
    logger.error("Permission grant failed", { error: error.message });
    return res.status(500).json({ message: "Failed to grant document permission" });
  }
};

exports.revokePermission = async (req, res) => {
  try {
    const targetUserId = req.params.userId;
    if (!mongoose.isValidObjectId(targetUserId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const revokedAt = new Date();
    const result = await Document.updateOne(
      {
        _id: req.document._id,
        permissions: { $elemMatch: { userId: targetUserId, revokedAt: null } }
      },
      {
        $set: {
          "permissions.$.revokedAt": revokedAt,
          "permissions.$.revokedBy": req.user.id
        }
      }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Document permission not found" });
    }

    await recordAuditEvent({
      req,
      actorUserId: req.user.id,
      actorRole: req.userRole,
      action: "document.permission.revoke",
      outcome: "success",
      resourceId: req.document._id,
      resourceName: req.document.fileName,
      details: { targetUserId, revokedAt }
    });

    return res.json({ message: "Document permission revoked" });
  } catch (error) {
    logger.error("Permission revocation failed", { error: error.message });
    return res.status(500).json({ message: "Failed to revoke document permission" });
  }
};

// ─── Re-analyze all stuck/unanalyzed documents ──────────────────────────────
exports.reanalyzeAll = async (req, res) => {
  try {
    const result = await reanalyzeStuckDocuments();
    res.json({ success: true, message: `Re-analysis queued for ${result} document(s)` });
  } catch (err) {
    logger.error("Reanalyze all error", { error: err.message });
    res.status(500).json({ success: false, message: "Failed to start re-analysis" });
  }
};

// ─── Startup: fix all stuck documents ───────────────────────────────────────
async function reanalyzeStuckDocuments() {
  try {
    // Find documents that are stuck in processing OR have no AI analysis
    const stuckDocs = await Document.find({
      $or: [
        { status: "processing" },
        { status: "pending", documentType: { $in: [null, ""] } },
        { status: "pending", department: { $in: [null, ""] } }
      ]
    });

    if (stuckDocs.length === 0) {
      logger.info("✓ No stuck documents found.");
      return 0;
    }

    logger.info(`⚙ Found ${stuckDocs.length} document(s) needing AI analysis. Queuing...`);

    for (const doc of stuckDocs) {
      doc.status = "processing";
      await doc.save();

      const filePath = path.join(__dirname, "..", doc.filePath);
      queueDocumentEnrichment(doc._id, filePath, doc.fileName);
    }

    return stuckDocs.length;
  } catch (err) {
    logger.error("reanalyzeStuckDocuments error", { error: err.message });
    return 0;
  }
}

// Export for use in app.js startup
exports.reanalyzeStuckDocuments = reanalyzeStuckDocuments;

// Export for use by email ingestion service — allows email-sourced documents
// to flow through the same AI enrichment pipeline as manually uploaded ones.
exports.queueDocumentEnrichment = queueDocumentEnrichment;

// Export enrichDocument so the BullMQ enrichmentWorker can call it directly.
exports.enrichDocument = enrichDocument;



