const express = require("express");
const router = express.Router();
const controller = require("../controllers/passengerController");
const { authorize } = require("../middleware/auth");

// Passenger-specific routes
router.get("/:id/driver", authorize("admin", "passenger"), controller.getAssignedDriver);
router.get("/:id/trips", authorize("admin", "passenger"), controller.getTripHistory);

// Trip confirmation routes
router.patch("/trip/:id/pickup", authorize("admin", "passenger"), controller.confirmPickup);
router.patch("/trip/:id/end", authorize("admin", "passenger"), controller.confirmTripEnd);

// Subscription pricing
router.get("/subscription/price", authorize("admin", "passenger"), controller.calculateSubscriptionPrice);

module.exports = router;