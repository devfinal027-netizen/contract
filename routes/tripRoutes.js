const express = require("express");
const router = express.Router();
const controller = require("../controllers/tripController");
const { authorize } = require("../middleware/auth");

// Trip management routes
router.get("/", authorize("admin", "driver", "passenger"), controller.listTrips);
router.post("/pickup", authorize("passenger"), controller.createTripOnPickup);
router.post("/", authorize("driver"), controller.createTrip);
router.get("/:id", authorize("admin", "driver", "passenger"), controller.getTripDetails);
router.patch("/:id/start", authorize("admin", "driver"), controller.startTrip);
router.patch("/:id/complete", authorize("admin", "driver", "passenger"), controller.completeTrip);
router.patch("/:id/pickup", authorize("passenger"), controller.confirmPickup);
router.patch("/:id/dropoff", authorize("passenger"), controller.confirmDropoff);

module.exports = router;