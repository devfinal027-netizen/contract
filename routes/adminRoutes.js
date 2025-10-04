const express = require("express");
const router = express.Router();
const controller = require("../controllers/adminController");
const { authorize } = require("../middleware/auth");

// Admin-only routes
router.post("/contract/price", authorize("admin"), controller.setContractPricing);
router.get("/contract/price", authorize("admin"), controller.getContractPricing);
router.get("/pricing/history", authorize("admin"), controller.getPricingHistory);
router.put("/pricing/:id/deactivate", authorize("admin"), controller.deactivatePricing);

// Subscription calculation for admin
router.post("/subscription/calculate", authorize("admin"), controller.calculateSubscriptionForAdmin);

// Dashboard statistics
router.get("/dashboard/stats", authorize("admin"), controller.getDashboardStats);

module.exports = router;