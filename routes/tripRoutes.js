const express = require("express");
const router = express.Router();
const controller = require("../controllers/tripController");
const { authorize } = require("../middleware/auth");

// Trip management routes
router.get("/", authorize("admin", "passenger"), controller.listTrips);
router.post("/pickup", authorize("passenger"), controller.createTripOnPickup);
router.post("/", authorize("admin"), controller.createTrip);
router.get("/:id", authorize("admin", "passenger"), controller.getTripDetails);
router.patch("/:id/start", authorize("admin"), controller.startTrip);
router.patch("/:id/complete", authorize("admin", "passenger"), controller.completeTrip);
router.patch("/:id/pickup", authorize("passenger"), controller.confirmPickup);
router.patch("/:id/dropoff", authorize("passenger"), controller.confirmDropoff);

module.exports = router;