const { Wallet, Transaction } = require("../models/indexModel");
const { getUserInfo } = require("../services/userService");

// Admin list all driver wallets
exports.adminListWallets = async (req, res) => {
  try {
    const wallets = await Wallet.findAll({
      where: { role: 'driver', isActive: true },
      attributes: ['id', 'userId', 'balance', 'currency', 'lastTransactionAt', 'createdAt', 'updatedAt'],
      order: [['updatedAt', 'DESC']]
    });

    // Enrich with driver information
    const enrichedWallets = await Promise.all(
      wallets.map(async (wallet) => {
        try {
          const driverInfo = await getUserInfo(wallet.userId, 'driver');
          return {
            ...wallet.toJSON(),
            driver: {
              id: driverInfo?.id || wallet.userId,
              name: driverInfo?.name || 'Unknown Driver',
              phone: driverInfo?.phone || 'N/A',
              email: driverInfo?.email || 'N/A'
            }
          };
        } catch (error) {
          return {
            ...wallet.toJSON(),
            driver: {
              id: wallet.userId,
              name: 'Unknown Driver',
              phone: 'N/A',
              email: 'N/A'
            }
          };
        }
      })
    );

    return res.json({
      success: true,
      data: enrichedWallets,
      count: enrichedWallets.length
    });
  } catch (error) {
    console.error('Error fetching driver wallets:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch driver wallets',
      error: error.message
    });
  }
};

// Admin get specific driver wallet
exports.adminGetDriverWallet = async (req, res) => {
  try {
    const { driverId } = req.params;

    // Get wallet
    const wallet = await Wallet.findOne({
      where: { userId: driverId, role: 'driver' },
      attributes: ['id', 'userId', 'balance', 'currency', 'lastTransactionAt', 'createdAt', 'updatedAt', 'metadata']
    });

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Driver wallet not found'
      });
    }

    // Get recent transactions
    const transactions = await Transaction.findAll({
      where: { userId: driverId, role: 'driver' },
      attributes: ['id', 'refId', 'txnId', 'amount', 'type', 'method', 'status', 'createdAt', 'metadata'],
      order: [['createdAt', 'DESC']],
      limit: 50
    });

    // Get driver information
    let driverInfo = null;
    try {
      driverInfo = await getUserInfo(driverId, 'driver');
    } catch (error) {
      console.error('Error fetching driver info:', error);
    }

    return res.json({
      success: true,
      data: {
        wallet: wallet.toJSON(),
        driver: {
          id: driverInfo?.id || driverId,
          name: driverInfo?.name || 'Unknown Driver',
          phone: driverInfo?.phone || 'N/A',
          email: driverInfo?.email || 'N/A'
        },
        recentTransactions: transactions.map(tx => tx.toJSON())
      }
    });
  } catch (error) {
    console.error('Error fetching driver wallet:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch driver wallet',
      error: error.message
    });
  }
};