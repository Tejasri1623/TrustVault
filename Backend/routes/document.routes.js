const express = require("express");

const auth = require("../middlewares/auth.middleware");
const checkRole = require("../middlewares/role.middleware");
const upload = require("../middlewares/upload.middleware");
const { authorizeDocument } = require("../middlewares/documentAuthorization.middleware");
const controller = require("../controllers/document.controller");

const router = express.Router();

router.post("/upload", auth, checkRole(["admin", "owner"]), upload.array("documents", 20), controller.upload);
router.get("/", auth, controller.getDocuments);
router.get("/my", auth, controller.myDocuments);
router.get("/stats", auth, controller.stats);
router.get("/search", auth, controller.search);
router.get("/recent", auth, controller.recent);
router.post("/reanalyze", auth, checkRole(["admin"]), controller.reanalyzeAll);

router.get("/:id/permissions", auth, authorizeDocument("manage"), controller.listPermissions);
router.put("/:id/permissions", auth, authorizeDocument("manage"), controller.grantPermission);
router.delete("/:id/permissions/:userId", auth, authorizeDocument("manage"), controller.revokePermission);
router.get("/:id/activity", auth, authorizeDocument("activity"), controller.documentActivity);
router.patch("/:id/metadata", auth, authorizeDocument("edit"), controller.updateMetadata);
router.post("/:id/replace", auth, authorizeDocument("edit"), upload.any(), controller.replaceDocument);
router.put("/:id/file", auth, authorizeDocument("edit"), upload.any(), controller.replaceDocument);
router.post("/:id/save", auth, authorizeDocument("edit"), upload.any(), controller.replaceDocument);
router.get("/:id/view", auth, authorizeDocument("read"), controller.viewDocument);
router.get("/:id/download", auth, authorizeDocument("read"), controller.downloadDocument);
router.get("/:id/analysis", auth, authorizeDocument("read"), controller.getAnalysis);
router.post("/:id/reanalyze", auth, authorizeDocument("edit"), controller.reanalyzeSingle);
router.delete("/:id", auth, authorizeDocument("delete"), controller.deleteDocument);

module.exports = router;
