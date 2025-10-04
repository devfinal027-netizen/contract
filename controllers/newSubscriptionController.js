const { Subscription, Contract, ContractSettings, ContractType } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { getPassengerById, getDriverById } = require("../utils/userService");
const { calculateSubscriptionFare, getAvailableContracts } = require("../services/subscriptionService");
const { createPaymentForSubscription } = require("./paymentController");
const { getUserInfo, populateUserFields } = require("../utils/tokenHelper");

// Helper function to get contract type ID from contract
function getContractTypeId(contract) {
  // If it's a virtual contract from ContractType, use the contract's ID
  if (contract.contract_type_id) {
    return contract.contract_type_id;
  }
  // If it's a ContractType object, use its ID
  if (contract.contractType && contract.contractType.id) {
    return contract.contractType.id;
  }
  // If it's the contract ID itself (when using contract type ID as contract_id)
  if (contract.id) {
    return contract.id;
  }
  return null;
}

// POST /subscription/create - Create subscription with fare estimation
exports.createSubscription = asyncHandler(async (req, res) => {
  const {
    contract_id,
    pickup_location,
    dropoff_location,
    pickup_latitude,
    pickup_longitude,
    dropoff_latitude,
    dropoff_longitude,
    start_date,
    end_date,
  } = req.body;

  // Debug user information
  console.log("User info:", {
    id: req.user.id,
    type: req.user.type,
    roles: req.user.roles
  });

  // Validate required fields
  if (!contract_id || !pickup_location || !dropoff_location || !start_date || !end_date) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: contract_id, pickup_location, dropoff_location, start_date, end_date"
    });
  }

  // Validate contract exists and is active
  let contract = await Contract.findOne({
    where: { id: contract_id, status: 'ACTIVE' }
  });

  // If no contract found, check if it's a contract type ID
  if (!contract) {
    const contractType = await ContractType.findByPk(contract_id);
    if (contractType && contractType.is_active) {
      // Create a virtual contract from contract type
      contract = {
        id: contractType.id,
        contract_type_id: contractType.id,
        cost: contractType.base_price_per_km,
        status: 'ACTIVE',
        contractType: contractType
      };
    } else {
      return res.status(404).json({
        success: false,
        message: "Contract not found or not active"
      });
    }
  }

  // Get passenger ID from authenticated user
  const passengerId = req.user.id;

  try {
    // Get passenger info from token
    const passengerInfo = await getUserInfo(req, passengerId, 'passenger');

    // Calculate fare estimation
    // Pass the contract type object or contract type string
    const contractTypeForFare = contract.contractType || contract.contract_type || contract;
    
    const fareResult = await calculateSubscriptionFare(
      pickup_location,
      dropoff_location,
      pickup_latitude,
      pickup_longitude,
      dropoff_latitude,
      dropoff_longitude,
      contractTypeForFare
    );

    if (!fareResult.success) {
      return res.status(400).json(fareResult);
    }

    // Determine if we're using a contract type directly or an actual contract
    const isUsingContractTypeDirectly = contract.id === contract_id && contract.contract_type_id === contract_id;
    
    // Create subscription with PENDING status and passenger info
    const subscriptionData = {
      contract_id: isUsingContractTypeDirectly ? null : contract_id, // Set to null if using contract type directly
      passenger_id: passengerId,
      passenger_name: passengerInfo?.name || null,
      passenger_phone: passengerInfo?.phone || null,
      passenger_email: passengerInfo?.email || null,
      pickup_location,
      dropoff_location,
      pickup_latitude: pickup_latitude || null,
      pickup_longitude: pickup_longitude || null,
      dropoff_latitude: dropoff_latitude || null,
      dropoff_longitude: dropoff_longitude || null,
      contract_type_id: getContractTypeId(contract),
      start_date,
      end_date,
      fare: fareResult.data.base_fare,
      discount_applied: fareResult.data.discount_amount,
      final_fare: fareResult.data.total_fare,
      distance_km: fareResult.data.distance_km,
      status: "PENDING",
      payment_status: "PENDING",
    };

    const subscription = await Subscription.create(subscriptionData);

    res.status(201).json({
      success: true,
      message: "Subscription created successfully with fare estimation",
      data: {
        subscription: {
          ...subscription.toJSON(),
          passenger_name: passengerInfo?.name || null,
          passenger_phone: passengerInfo?.phone || null,
          passenger_email: passengerInfo?.email || null,
        },
        fare_estimation: fareResult.data,
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error creating subscription",
      error: error.message
    });
  }
});

// POST /subscription/:id/payment - Process payment for subscription
exports.processPayment = asyncHandler(async (req, res) => {
  const subscriptionId = req.params.id;
  
  // Debug logging
  console.log("Payment request received:", {
    subscriptionId,
    contentType: req.headers['content-type'],
    body: req.body,
    method: req.method
  });
  
  // Check if request body exists
  if (!req.body) {
    return res.status(400).json({
      success: false,
      message: "Request body is required. Please include Content-Type: application/json header.",
      debug: {
        contentType: req.headers['content-type'],
        method: req.method,
        hasBody: !!req.body
      }
    });
  }
  
  const { 
    payment_method, 
    transaction_reference, 
    amount, 
    due_date, 
    receipt_image, 
    status = "PENDING",
    subscription_id 
  } = req.body;

  if (!payment_method) {
    return res.status(400).json({
      success: false,
      message: "payment_method is required"
    });
  }

  const subscription = await Subscription.findByPk(subscriptionId, {
    include: [{ model: Contract, as: "contract" }]
  });
  
  if (!subscription) {
    return res.status(404).json({
      success: false,
      message: "Subscription not found"
    });
  }

  // Check if user can access this subscription
  if (req.user.type === "passenger" && subscription.passenger_id !== req.user.id) {
    return res.status(403).json({
      success: false,
      message: "Access denied"
    });
  }

  // Check if subscription is in valid state for payment
  if (subscription.payment_status === "PAID") {
    return res.status(400).json({
      success: false,
      message: "Subscription is already paid"
    });
  }

  try {
    // Create payment record for admin approval
    const paymentData = {
      amount: amount || subscription.final_fare,
      payment_method,
      transaction_reference,
      due_date: due_date ? new Date(due_date) : new Date(),
      status: status
    };

    const payment = await createPaymentForSubscription(subscriptionId, paymentData, req.file);

    // Return the expected response format
    res.json({
      success: true,
      data: {
        id: payment.id,
        contract_id: payment.contract_id,
        passenger_id: payment.passenger_id,
        payment_method: payment.payment_method,
        due_date: payment.due_date,
        transaction_reference: payment.transaction_reference,
        status: payment.status,
        receipt_image: payment.receipt_image,
        createdAt: payment.createdAt
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error processing payment",
      error: error.message
    });
  }
});

// GET /subscriptions/pending - Get all pending subscriptions (Admin only)
exports.getPendingSubscriptions = asyncHandler(async (req, res) => {
  // Check if user is admin
  if (req.user.type !== "admin" && req.user.type !== "superadmin") {
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin privileges required."
    });
  }

  const pendingSubscriptions = await Subscription.findAll({
    where: {
      status: "PENDING"
    },
    include: [
      { model: Contract, as: "contract" },
      { model: ContractType, as: "contractType" }
    ],
    order: [['createdAt', 'ASC']]
  });

  // Enrich with passenger info
  const uniquePassengerIds = [...new Set(pendingSubscriptions.map(s => s.passenger_id).filter(Boolean))];
  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  const passengerInfoMap = new Map();
  
  await Promise.all(uniquePassengerIds.map(async (pid) => {
    try {
      const info = await getPassengerById(pid, authHeader);
      if (info) passengerInfoMap.set(pid, info);
    } catch (_) {}
  }));

  const enriched = pendingSubscriptions.map(subscription => {
    const info = passengerInfoMap.get(subscription.passenger_id);
    return {
      ...subscription.toJSON(),
      passenger_name: info?.name || null,
      passenger_phone: info?.phone || null,
      passenger_email: info?.email || null,
    };
  });

  res.json({
    success: true,
    data: {
      pending_subscriptions: enriched,
      total_count: enriched.length
    }
  });
});

// GET /passenger/:id/subscriptions - Get passenger's subscriptions (active and history)
exports.getPassengerSubscriptions = asyncHandler(async (req, res) => {
  const passengerId = req.params.id;

  // Check if user can access this passenger's data
  if (req.user.type === "passenger" && req.user.id !== passengerId) {
    return res.status(403).json({
      success: false,
      message: "Access denied"
    });
  }

  try {
    const subscriptions = await Subscription.findAll({
      where: { passenger_id: passengerId },
      order: [['createdAt', 'DESC']],
    });

    // Get passenger info from token
    const passengerInfo = await getUserInfo(req, passengerId, 'passenger');

    // Enrich subscriptions with user information and expiration details
    const enrichedSubscriptions = await Promise.all(
      subscriptions.map(async (subscription) => {
        const subData = subscription.toJSON();
        let driverInfo = null;
        
        if (subscription.driver_id) {
          driverInfo = await getUserInfo(req, subscription.driver_id, 'driver');
        }
        
        const endDate = new Date(subscription.end_date);
        const today = new Date();
        const daysUntilExpiry = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
        
        return {
          ...subData,
          passenger_name: passengerInfo?.name || subData.passenger_name || null,
          passenger_phone: passengerInfo?.phone || subData.passenger_phone || null,
          passenger_email: passengerInfo?.email || subData.passenger_email || null,
          driver_name: driverInfo?.name || subData.driver_name || null,
          driver_phone: driverInfo?.phone || subData.driver_phone || null,
          driver_email: driverInfo?.email || subData.driver_email || null,
          vehicle_info: driverInfo?.vehicle_info || subData.vehicle_info || null,
          expiration_date: subscription.end_date,
          days_until_expiry: daysUntilExpiry,
          is_expired: daysUntilExpiry < 0,
        };
      })
    );

    // Separate active and completed subscriptions
    const activeSubscriptions = enrichedSubscriptions.filter(s => 
      s.status === "ACTIVE" && !s.is_expired
    );
    const historySubscriptions = enrichedSubscriptions.filter(s => 
      s.status !== "ACTIVE" || s.is_expired
    );

    res.json({
      success: true,
      data: {
        passenger_id: passengerId,
        passenger_name: passengerInfo?.name || null,
        passenger_phone: passengerInfo?.phone || null,
        passenger_email: passengerInfo?.email || null,
        active_subscriptions: activeSubscriptions,
        subscription_history: historySubscriptions,
        counters: {
          total_subscriptions: enrichedSubscriptions.length,
          active_count: activeSubscriptions.length,
          history_count: historySubscriptions.length,
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching passenger subscriptions",
      error: error.message
    });
  }
});

// GET /subscription/contracts - Get available contracts for subscription
exports.getAvailableContracts = asyncHandler(async (req, res) => {
  const { contract_type } = req.query;

  try {
    let whereClause = { status: 'ACTIVE' };
    if (contract_type) {
      whereClause.contract_type = contract_type;
    }

    const contracts = await Contract.findAll({
      where: whereClause,
      attributes: ['id', 'has_discount', 'contract_type', 'status'], // Only return required fields
      order: [['contract_type', 'ASC'], ['createdAt', 'DESC']],
    });

    // Enrich contracts with discount information
    const enrichedContracts = await Promise.all(
      contracts.map(async (contract) => {
        const contractData = contract.toJSON();
        
        // Get contract settings for discount info
        const contractSettings = await ContractSettings.findOne({
          where: { contract_type: contract.contract_type }
        });

        return {
          ...contractData,
          discount_percentage: contractSettings?.discount_percentage || 0,
          discount_amount: null, // Will be calculated based on fare
          base_price_per_km: contractSettings?.base_price_per_km || 0,
          minimum_fare: contractSettings?.minimum_fare || 0,
        };
      })
    );

    res.json({
      success: true,
      data: {
        contracts: enrichedContracts,
        total_count: enrichedContracts.length,
        filter_applied: contract_type || null,
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching available contracts",
      error: error.message
    });
  }
});