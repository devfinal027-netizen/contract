const express = require("express");
const router = express.Router();
const controller = require("../controllers/newSubscriptionController");
const { authorize } = require("../middleware/auth");

// Subscription creation and payment routes
router.post("/create", authorize("passenger"), controller.createSubscription);
router.post("/:id/payment", authorize("admin", "passenger"), controller.processPayment);

// Admin routes for pending items
router.get("/pending", authorize("admin", "superadmin"), controller.getPendingSubscriptions);

module.exports = router;