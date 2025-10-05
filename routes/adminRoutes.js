const express = require("express");
const router = express.Router();
const controller = require("../controllers/adminController");
const newAdmin = require("../controllers/newAdminController");
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
// --- Additional admin management endpoints (mirrored for compatibility) ---
// Payments
router.get("/payments/pending", authorize("admin"), newAdmin.getPendingPayments);
router.post("/payment/:id/approve", authorize("admin"), newAdmin.approvePayment);
router.patch("/payment/:id/approve", authorize("admin"), newAdmin.approvePayment);
router.post("/payment/approve", authorize("admin"), (req, res, next) => {
  if (req.body && req.body.id) {
    req.params.id = req.body.id;
    return newAdmin.approvePayment(req, res, next);
  }
  return res.status(400).json({ success: false, message: "id is required in body" });
});
router.post("/payment/:id/reject", authorize("admin"), newAdmin.rejectPayment);
router.patch("/payment/:id/reject", authorize("admin"), newAdmin.rejectPayment);

// Subscriptions
router.get("/subscriptions", authorize("admin"), newAdmin.getAllSubscriptions);
router.post("/subscription/:id/approve", authorize("admin"), newAdmin.approveSubscription);
router.patch("/subscription/:id/approve", authorize("admin"), newAdmin.approveSubscription);
router.post("/subscription/:id/assign-driver", authorize("admin"), newAdmin.assignDriverToSubscription);
router.post(
  "/subscription/passenger/:passengerId/assign-driver",
  authorize("admin"),
  async (req, res, next) => {
    req.params.id = req.params.passengerId;
    req.body = { ...(req.body || {}), passenger_id: req.params.passengerId };
    return newAdmin.assignDriverToSubscription(req, res, next);
  }
);

// Trips
router.get("/trips", authorize("admin"), newAdmin.getAllTrips);