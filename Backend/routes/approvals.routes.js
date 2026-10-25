const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const approvalsController = require("../controllers/approvals.controller");
const { validateMongoId, validateApprovalDecision } = require("../middlewares/validators");

router.use(auth);

router.get("/pending", approvalsController.getPendingApprovals);
router.post("/:id/decision", validateMongoId, validateApprovalDecision, approvalsController.makeDecision);

module.exports = router;
