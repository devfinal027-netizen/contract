const express = require("express");
const router = express.Router();
const { authorize } = require("../middleware/auth");
const controller = require("../controllers/walletController");

// Topup and webhook
router.post("/topup", authorize("driver", "passenger"), controller.topup);
router.post("/webhook", controller.webhook);
router.get("/transactions/:userId?", authorize("admin", "driver", "passenger"), controller.transactions);
router.post("/withdraw", authorize("driver"), controller.withdraw);

module.exports = router;

