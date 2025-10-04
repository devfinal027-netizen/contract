const { Trip, Subscription, Contract, RideSchedule, Payment } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { getPassengerById } = require("../utils/userService");
const { Op } = require("sequelize");

// GET /driver/:id/passengers - Get subscribed passengers with payment status
exports.getSubscribedPassengers = asyncHandler(async (req, res) => {
  const driverId = req.params.id;

  // Check if user can access this driver's data
  if (req.user.type === "driver" && String(req.user.id) !== String(driverId)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  // Find ride schedules assigned to this driver
  const rideSchedules = await RideSchedule.findAll({
    where: { 
      driver_id: driverId,
      is_active: true 
    },
    include: [{
      model: Contract,
      as: "contract",
      include: [{
        model: Subscription,
        as: "subscriptions",
        where: { status: ["ACTIVE", "PARTIAL"] },
        required: true,
        include: [{
          model: Trip,
          as: "trips",
          required: false,
        }]
      }]
    }]
  });

  if (!rideSchedules.length) {
    return res.json({
      success: true,
      data: [],
      message: "No active subscriptions found for this driver"
    });
  }

  // Extract unique passenger IDs
  const passengerIds = new Set();
  const subscriptionData = [];

  rideSchedules.forEach(schedule => {
    schedule.contract.subscriptions.forEach(subscription => {
      passengerIds.add(subscription.passenger_id);
      subscriptionData.push({
        subscription_id: subscription.id,
        passenger_id: subscription.passenger_id,
        contract_id: subscription.contract_id,
        status: subscription.status,
        amount_paid: subscription.amount_paid,
        start_date: subscription.start_date,
        end_date: subscription.end_date,
        contract_cost: schedule.contract.cost,
        contract_type: schedule.contract.contract_type,
        pickup_location: schedule.contract.pickup_location,
        dropoff_location: schedule.contract.dropoff_location,
        schedule: {
          pickup_time: schedule.pickup_time,
          days_of_week: schedule.days_of_week,
          pattern_type: schedule.pattern_type,
        },
        trips: subscription.trips || []
      });
    });
  });

  // Get passenger information
  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  const passengerInfoMap = new Map();
  
  await Promise.all([...passengerIds].map(async (passengerId) => {
    try {
      const info = await getPassengerById(passengerId, authHeader);
      if (info) passengerInfoMap.set(passengerId, info);
    } catch (_) {}
  }));

  // Get payment status for each subscription
  const subscriptionIds = subscriptionData.map(s => s.subscription_id);
  const payments = await Payment.findAll({
    where: {
      passenger_id: [...passengerIds],
    },
    include: [{
      model: Contract,
      as: "contract",
      include: [{
        model: Subscription,
        as: "subscriptions",
        where: { id: subscriptionIds },
        required: true,
      }]
    }]
  });

  // Create payment map
  const paymentMap = new Map();
  payments.forEach(payment => {
    const key = `${payment.passenger_id}-${payment.contract_id}`;
    if (!paymentMap.has(key)) {
      paymentMap.set(key, []);
    }
    paymentMap.get(key).push(payment);
  });

  // Enrich subscription data
  const enrichedData = subscriptionData.map(sub => {
    const passengerInfo = passengerInfoMap.get(sub.passenger_id);
    const paymentKey = `${sub.passenger_id}-${sub.contract_id}`;
    const passengerPayments = paymentMap.get(paymentKey) || [];
    
    const totalPaid = passengerPayments.reduce((sum, payment) => {
      return sum + parseFloat(payment.amount || 0);
    }, 0);

    const paymentStatus = sub.status === "ACTIVE" ? "PAID" : 
                         sub.status === "PARTIAL" ? "PARTIAL" : "PENDING";

    return {
      ...sub,
      passenger_name: passengerInfo?.name || null,
      passenger_phone: passengerInfo?.phone || null,
      passenger_email: passengerInfo?.email || null,
      payment_status: paymentStatus,
      total_paid: Math.round(totalPaid * 100) / 100,
      balance_due: Math.round((parseFloat(sub.contract_cost) - totalPaid) * 100) / 100,
      recent_payments: passengerPayments.slice(0, 3), // Last 3 payments
    };
  });

  res.json({
    success: true,
    data: enrichedData
  });
});

// GET /driver/:id/contracts - Get contract expiration dates
exports.getContractExpirations = asyncHandler(async (req, res) => {
  const driverId = req.params.id;

  // Check if user can access this driver's data
  if (req.user.type === "driver" && String(req.user.id) !== String(driverId)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const rideSchedules = await RideSchedule.findAll({
    where: { 
      driver_id: driverId,
      is_active: true 
    },
    include: [{
      model: Contract,
      as: "contract",
      include: [{
        model: Subscription,
        as: "subscriptions",
        where: { status: ["ACTIVE", "PARTIAL"] },
        required: true,
      }]
    }]
  });

  const contractData = rideSchedules.map(schedule => {
    const contract = schedule.contract;
    const activeSubscriptions = contract.subscriptions.filter(s => s.status === "ACTIVE");
    const nearestExpiry = activeSubscriptions.reduce((nearest, sub) => {
      const subEndDate = new Date(sub.end_date);
      const nearestDate = nearest ? new Date(nearest) : null;
      return !nearestDate || subEndDate < nearestDate ? sub.end_date : nearest;
    }, null);

    return {
      contract_id: contract.id,
      contract_type: contract.contract_type,
      contract_status: contract.status,
      contract_start_date: contract.start_date,
      contract_end_date: contract.end_date,
      pickup_location: contract.pickup_location,
      dropoff_location: contract.dropoff_location,
      total_subscriptions: contract.subscriptions.length,
      active_subscriptions: activeSubscriptions.length,
      nearest_subscription_expiry: nearestExpiry,
      schedule: {
        pickup_time: schedule.pickup_time,
        days_of_week: schedule.days_of_week,
        pattern_type: schedule.pattern_type,
      }
    };
  });

  res.json({
    success: true,
    data: contractData
  });
});

// GET /driver/:id/trips - Get all assigned trips with details
exports.getDriverTrips = asyncHandler(async (req, res) => {
  const driverId = req.params.id;
  const { status, date_from, date_to } = req.query;

  // Check if user can access this driver's data
  if (req.user.type === "driver" && req.user.id !== driverId) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  let whereClause = { driver_id: driverId };
  
  if (status) {
    whereClause.status = status;
  }

  if (date_from || date_to) {
    whereClause.createdAt = {};
    if (date_from) {
      whereClause.createdAt[Op.gte] = new Date(date_from);
    }
    if (date_to) {
      whereClause.createdAt[Op.lte] = new Date(date_to);
    }
  }

  const trips = await Trip.findAll({
    where: whereClause,
    include: [
      {
        model: Contract,
        as: "contract",
        attributes: ["id", "contract_type", "pickup_location", "dropoff_location"]
      },
      {
        model: Subscription,
        as: "subscription",
        attributes: ["id", "status", "start_date", "end_date"]
      }
    ],
    order: [['scheduled_pickup_time', 'DESC'], ['createdAt', 'DESC']],
  });

  // Enrich with passenger information
  const uniquePassengerIds = [...new Set(trips.map(t => t.passenger_id).filter(Boolean))];
  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  const passengerInfoMap = new Map();
  
  await Promise.all(uniquePassengerIds.map(async (passengerId) => {
    try {
      const info = await getPassengerById(passengerId, authHeader);
      if (info) passengerInfoMap.set(passengerId, info);
    } catch (_) {}
  }));

  const enrichedTrips = trips.map(trip => {
    const tripData = trip.toJSON();
    const passengerInfo = passengerInfoMap.get(trip.passenger_id);
    
    return {
      ...tripData,
      passenger_name: passengerInfo?.name || null,
      passenger_phone: passengerInfo?.phone || null,
      passenger_email: passengerInfo?.email || null,
    };
  });

  res.json({
    success: true,
    data: enrichedTrips
  });
});

// GET /driver/:id/schedule - Get upcoming trips with passenger details
exports.getDriverSchedule = asyncHandler(async (req, res) => {
  const driverId = req.params.id;
  const { date } = req.query;

  // Check if user can access this driver's data
  if (req.user.type === "driver" && req.user.id !== driverId) {
    return res.status(403).json({ 
      success: false, 
      message: "Access denied",
      debug: {
        userType: req.user.type,
        userId: req.user.id,
        requestedDriverId: driverId
      }
    });
  }

  // Get upcoming trips (scheduled or in progress)
  let whereClause = { 
    driver_id: driverId,
    status: ["SCHEDULED", "PICKUP_CONFIRMED", "IN_PROGRESS"]
  };

  if (date) {
    const targetDate = new Date(date);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);
    
    whereClause.scheduled_pickup_time = {
      [Op.gte]: targetDate,
      [Op.lt]: nextDay
    };
  } else {
    // Default to today and future
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    whereClause.scheduled_pickup_time = {
      [Op.gte]: today
    };
  }

  const upcomingTrips = await Trip.findAll({
    where: whereClause,
    include: [
      {
        model: Contract,
        as: "contract",
        attributes: ["id", "contract_type", "pickup_location", "dropoff_location"]
      },
      {
        model: Subscription,
        as: "subscription",
        attributes: ["id", "status", "start_date", "end_date"]
      }
    ],
    order: [['scheduled_pickup_time', 'ASC']],
  });

  // Also get ride schedules for recurring trips
  const rideSchedules = await RideSchedule.findAll({
    where: { 
      driver_id: driverId,
      is_active: true 
    },
    include: [{
      model: Contract,
      as: "contract",
      include: [{
        model: Subscription,
        as: "subscriptions",
        where: { status: "ACTIVE" },
        required: true,
      }]
    }]
  });

  // Enrich with passenger information
  const passengerIds = new Set();
  upcomingTrips.forEach(trip => passengerIds.add(trip.passenger_id));
  rideSchedules.forEach(schedule => {
    schedule.contract.subscriptions.forEach(sub => passengerIds.add(sub.passenger_id));
  });

  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  const passengerInfoMap = new Map();
  
  await Promise.all([...passengerIds].map(async (passengerId) => {
    try {
      const info = await getPassengerById(passengerId, authHeader);
      if (info) passengerInfoMap.set(passengerId, info);
    } catch (_) {}
  }));

  // Enrich upcoming trips
  const enrichedTrips = upcomingTrips.map(trip => {
    const tripData = trip.toJSON();
    const passengerInfo = passengerInfoMap.get(trip.passenger_id);
    
    return {
      ...tripData,
      passenger_name: passengerInfo?.name || null,
      passenger_phone: passengerInfo?.phone || null,
      passenger_email: passengerInfo?.email || null,
    };
  });

  // Process ride schedules for recurring schedule info
  const scheduleInfo = rideSchedules.map(schedule => {
    const activeSubscriptions = schedule.contract.subscriptions.filter(s => s.status === "ACTIVE");
    
    return {
      schedule_id: schedule.id,
      contract_id: schedule.contract_id,
      pickup_time: schedule.pickup_time,
      days_of_week: schedule.days_of_week,
      pattern_type: schedule.pattern_type,
      pickup_location: schedule.contract.pickup_location,
      dropoff_location: schedule.contract.dropoff_location,
      active_passengers: activeSubscriptions.map(sub => {
        const passengerInfo = passengerInfoMap.get(sub.passenger_id);
        return {
          subscription_id: sub.id,
          passenger_id: sub.passenger_id,
          passenger_name: passengerInfo?.name || null,
          passenger_phone: passengerInfo?.phone || null,
        };
      })
    };
  });

  res.json({
    success: true,
    data: {
      upcoming_trips: enrichedTrips,
      recurring_schedules: scheduleInfo,
      total_upcoming_trips: enrichedTrips.length,
    }
  });
});