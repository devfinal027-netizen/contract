//routes/indexRoutes.js
const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");

// Import all route files
const contractRoutes = require("./contractRoutes");
const discountRoutes = require("./discountRoutes");
const paymentRoutes = require("./paymentRoutes");
const subscriptionRoutes = require("./subscriptionRoutes");
const scheduleRoutes = require("./scheduleRoutes");
const tripRoutes = require("./tripRoutes");
const passengerRoutes = require("./passengerRoutes");
const driverRoutes = require("./driverRoutes");
const adminRoutes = require("./adminRoutes");
const contractTypeRoutes = require("./contractTypeRoutes");

// New workflow routes
const newSubscriptionRoutes = require("./newSubscriptionRoutes");
// using newAdminController via adminRoutes only

// ✅ all routes require authentication
router.use(authenticate);

// Mount routes with appropriate prefixes
// IMPORTANT: /contract-types must be registered BEFORE /contracts to avoid route conflicts
router.use("/contract-types", contractTypeRoutes);
router.use("/discounts", authorize("admin"), discountRoutes);
router.use("/contracts", contractRoutes);
router.use("/payments", paymentRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/schedules", scheduleRoutes);
router.use("/trips", tripRoutes);
// Alias singular form for clients using /trip
router.use("/trip", tripRoutes);
router.use("/passenger", passengerRoutes);
router.use("/driver", driverRoutes);
router.use("/admin", adminRoutes);

// New workflow routes
router.use("/subscription", newSubscriptionRoutes);
// Note: /passenger routes are already registered above
// router.use("/passenger", newPassengerRoutes);

// Export the main router
module.exports = router;
