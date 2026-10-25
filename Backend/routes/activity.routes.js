const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware");
const Activity = require("../models/activity.model");
const logger = require("../config/logger").createChildLogger("ActivityRoutes");

router.get("/activities/recent", auth, async (req, res) => {
  try {
    const query = req.userRole === "admin" ? {} : { user: req.user.id };
    const activities = await Activity.find(query)
      .populate("user", "username")
      .sort({ createdAt: -1 })
      .limit(5);

    res.json(activities);
  } catch (err) {
    logger.error("Recent activity fetch failed", { error: err.message });
    res.status(500).json({ message: "Failed to load activity" });
  }
});
router.post("/activities", auth, async (req, res) => {
  try {
    const { action, entityType, entityName, comment } = req.body;
    const activity = new Activity({ action, entityType, entityName, comment, user: req.user.id });
    await activity.save();
    res.status(201).json(activity);
  } catch (err) {
    logger.error("Activity creation failed", { error: err.message });
    res.status(400).json({ message: "Failed to create activity" });
  }
});
module.exports = router;
