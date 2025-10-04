const express = require("express");
const router = express.Router();
const controller = require("../controllers/driverController");
const { authorize } = require("../middleware/auth");

// Driver-specific routes
router.get("/:id/passengers", authorize("admin", "driver"), controller.getSubscribedPassengers);
router.get("/:id/contracts", authorize("admin", "driver"), controller.getContractExpirations);
router.get("/:id/trips", authorize("admin", "driver"), controller.getDriverTrips);
router.get("/:id/schedule", authorize("admin", "driver"), controller.getDriverSchedule);

module.exports = router;