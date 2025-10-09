const express = require("express");
const router = express.Router();
const controller = require("../controllers/passengerController");
const { authorize } = require("../middleware/auth");
const { getPassengerSubscriptions } = require("../controllers/newSubscriptionController");

// Passenger-specific routes
// Convenience alias: current passenger
router.get("/me/driver", authorize("admin", "passenger"), (req, res, next) => {
  req.params.id = String(req.user.id);
  return controller.getAssignedDriver(req, res, next);
});

router.get("/:id/driver", authorize("admin", "passenger"), controller.getAssignedDriver);
router.get("/:id/trips", authorize("admin", "passenger"), controller.getTripHistory);
router.get("/:id/subscriptions", authorize("admin", "passenger"), getPassengerSubscriptions);

// Trip confirmation routes
router.patch("/trip/:id/pickup", authorize("admin", "passenger"), controller.confirmPickup);
router.patch("/trip/:id/end", authorize("admin", "passenger"), controller.confirmTripEnd);

// Subscription pricing endpoint removed; price is calculated during creation

module.exports = router;