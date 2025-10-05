const express = require("express");
const router = express.Router();
const controller = require("../controllers/newAdminController");
const { authorize } = require("../middleware/auth");

// Admin-only routes for contract settings and driver assignment
router.post("/contracts/sample", authorize("admin"), controller.createSampleContracts);
router.post("/subscription/:id/assign-driver", authorize("admin"), controller.assignDriverToSubscription);
router.post("/subscription/passenger/:passengerId/assign-driver", authorize("admin"), async (req, res, next) => {
  // proxy to same controller, passing passenger_id and a dummy id
  req.params.id = req.params.passengerId;
  req.body = { ...(req.body || {}), passenger_id: req.params.passengerId };
  return controller.assignDriverToSubscription(req, res, next);
});
// Accept POST for approve to match admin preference, keep PATCH for backward compatibility
router.post("/subscription/:id/approve", authorize("admin"), controller.approveSubscription);
router.patch("/subscription/:id/approve", authorize("admin"), controller.approveSubscription);
router.get("/subscriptions", authorize("admin"), controller.getAllSubscriptions);
router.get("/trips", authorize("admin"), controller.getAllTrips);

// Payment approval
router.get("/payments/pending", authorize("admin"), controller.getPendingPayments);
router.post("/payment/:id/approve", authorize("admin"), controller.approvePayment);
router.patch("/payment/:id/approve", authorize("admin"), controller.approvePayment);
router.post("/payment/:id/reject", authorize("admin"), controller.rejectPayment);
router.patch("/payment/:id/reject", authorize("admin"), controller.rejectPayment);

// Convenience: approve by body if :id is missing (handles Postman var issues)
router.post("/payment/approve", authorize("admin"), (req, res, next) => {
  if (req.body && req.body.id) {
    req.params.id = req.body.id;
    return controller.approvePayment(req, res, next);
  }
  return res.status(400).json({ success: false, message: "id is required in body" });
});

module.exports = router;