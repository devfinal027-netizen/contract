const express = require("express");
const router = express.Router();
const { authorize } = require("../middleware/auth");
const controller = require("../controllers/walletController");
const driverWalletController = require("../controllers/driverWalletController");

// Topup and webhook
router.post("/topup", authorize("driver", "passenger"), controller.topup);
router.post("/webhook", controller.webhook);
router.get("/transactions", authorize("admin", "driver", "passenger"), controller.transactions);
router.get("/transactions/:userId", authorize("admin"), controller.transactions);
router.get("/admin/balances", authorize("admin"), controller.adminBalances);
router.get("/admin/transactions", authorize("admin"), controller.adminTransactions);
router.get("/debug", controller.debug); // Debug endpoint to see MySQL storage
router.post("/withdraw", authorize("driver"), controller.withdraw);

// Driver wallet admin endpoints
router.get(
  "/admin/wallets",
  authorize("admin", "superadmin"),
  driverWalletController.adminListWallets
);
router.get(
  "/admin/wallets/:driverId",
  authorize("admin", "superadmin"),
  driverWalletController.adminGetDriverWallet
);

module.exports = router;

