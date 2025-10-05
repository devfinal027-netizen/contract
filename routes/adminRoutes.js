const express = require("express");
const router = express.Router();
const newAdmin = require("../controllers/newAdminController");
const { authorize } = require("../middleware/auth");

// Pricing and dashboard endpoints removed from legacy adminController to reduce duplication

module.exports = router;
// --- Additional admin management endpoints (mirrored for compatibility) ---
// Payments
router.get("/payments/pending", authorize("admin"), newAdmin.getPendingPayments);
router.post("/payment/:id/approve", authorize("admin"), newAdmin.approvePayment);
router.post("/payment/approve", authorize("admin"), (req, res, next) => {
  if (req.body && req.body.id) {
    req.params.id = req.body.id;
    return newAdmin.approvePayment(req, res, next);
  }
  return res.status(400).json({ success: false, message: "id is required in body" });
});
router.post("/payment/:id/reject", authorize("admin"), newAdmin.rejectPayment);

// Subscriptions
router.get("/subscriptions", authorize("admin"), newAdmin.getAllSubscriptions);
router.post("/subscription/:id/approve", authorize("admin"), newAdmin.approveSubscription);
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

// Drivers (external service backed)
router.get("/drivers", authorize("admin"), newAdmin.getDrivers);
router.get("/driver/:id", authorize("admin"), newAdmin.getDriverDetail);