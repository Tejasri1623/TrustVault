const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const adminOnly = require("../middlewares/admin.middleware");
const adminController = require("../controllers/admin.controller");
const { authorizeDocument } = require("../middlewares/documentAuthorization.middleware");
const AuditEvent = require("../models/auditEvent.model");
const { validateMongoId } = require("../middlewares/validators");
const logger = require("../config/logger").createChildLogger("AdminRoutes");

router.get("/activity", auth, adminOnly, (req, res) => res.render("admin/activity"));
router.get("/pending-docs", auth, adminOnly, (req, res) => res.render("admin/pending-docs"));
router.get("/users", auth, adminOnly, (req, res) => res.render("admin/users"));
router.get("/api/users", auth, adminOnly, adminController.listUsers);
router.patch("/api/users/:id/role", auth, adminOnly, validateMongoId, adminController.updateUserRole);
router.get("/api/activity", auth, adminOnly, async (req, res) => {
  try {
    const events = await AuditEvent.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("actorUserId", "username email");
    return res.json({ events });
  } catch (error) {
    logger.error("Admin audit activity fetch failed", { error: error.message });
    return res.status(500).json({ message: "Failed to load audit activity" });
  }
});
router.get("/document/:id", auth, adminOnly, validateMongoId, authorizeDocument("read"), adminController.getDocument);

module.exports = router;
