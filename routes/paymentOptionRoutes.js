const express = require("express");
const router = express.Router();
const { authorize } = require("../middleware/auth");
const controller = require("../controllers/paymentOptionController");

// Admin manages options
router.get("/options", authorize("admin", "passenger", "driver"), controller.list);
router.post("/options", authorize("admin"), controller.create);

// User sets preference
router.get("/preference", authorize("passenger", "driver"), controller.getPreference);
router.post("/preference", authorize("passenger", "driver"), controller.setPreference);

module.exports = router;

