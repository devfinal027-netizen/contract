const { Trip, Subscription, Contract, RideSchedule } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { getUserInfo } = require("../utils/tokenHelper");
const jwt = require('jsonwebtoken');

function decodeToken(req) {
  try {
    const authz = req.headers && req.headers.authorization ? req.headers.authorization : null;
    if (!authz) return null;
    const clean = authz.startsWith('Bearer ') ? authz.slice(7) : authz;
    return jwt.verify(clean, process.env.JWT_SECRET || 'secret');
  } catch (_) { return null; }
}

function findDriverInDecoded(decoded, driverId) {
  if (!decoded) return null;
  const candidates = [
    decoded.drivers,
    decoded.driver,
    decoded.assignedDrivers,
    decoded.assignedDriver,
    decoded.users,
    decoded.userList,
    decoded.data,
    decoded.payload,
    decoded.context,
    decoded.user && decoded.user.drivers,
    decoded.user && decoded.user.driver,
    decoded.user && decoded.user.users,
    decoded.user && decoded.user.data
  ];
  const isMatch = (u) => {
    if (!u) return false;
    const id = u.id || u._id || (u.user && (u.user.id || u.user.__id));
    return id != null && String(id) === String(driverId);
  };
  for (const cont of candidates) {
    if (!cont) continue;
    if (Array.isArray(cont)) {
      const found = cont.find(isMatch);
      if (found) return found;
    } else if (typeof cont === 'object') {
      if (cont[String(driverId)]) return cont[String(driverId)];
      const found = Object.values(cont).find(isMatch);
      if (found) return found;
    }
  }
  return null;
}
const { calculateFareFromCoordinates } = require("../utils/pricingService");

// GET /passenger/:id/driver - Get assigned driver for latest subscription (ACTIVE first, else most recent)
exports.getAssignedDriver = asyncHandler(async (req, res) => {
  const passengerId = String(req.params.id);

  // Check if user can access this passenger's data
  if (req.user.type === "passenger" && String(req.user.id) !== passengerId) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  // Find latest ACTIVE subscription, else most recent any status
  let subscription = await Subscription.findOne({
    where: { passenger_id: passengerId, status: "ACTIVE" },
    include: [{
      model: Contract,
      as: "contract",
      include: [{ model: RideSchedule, as: "ride_schedules", where: { is_active: true }, required: false }]
    }],
    order: [["createdAt", "DESC"]],
  });

  if (!subscription) {
    subscription = await Subscription.findOne({
      where: { passenger_id: passengerId },
      include: [{
        model: Contract,
        as: "contract",
        include: [{ model: RideSchedule, as: "ride_schedules", where: { is_active: true }, required: false }]
      }],
      order: [["createdAt", "DESC"]],
    });
  }

  if (!subscription) {
    return res.status(404).json({ success: false, message: "No subscription found for this passenger" });
  }

  // Prefer subscription-level driver assignment, fallback to ride schedule
  const driverId = subscription.driver_id || subscription.contract?.ride_schedules?.[0]?.driver_id;
  if (!driverId) {
    return res.status(404).json({ success: false, message: "No driver assigned to this subscription" });
  }

  try {
    const decoded = decodeToken(req);
    const dTok = findDriverInDecoded(decoded, driverId);
    let dInfo = null;
    try { dInfo = await getUserInfo(req, driverId, 'driver'); } catch (_) {}

    const subData = subscription.toJSON();
    const name = (dTok && (dTok.name || dTok.fullName)) || dInfo?.name || subData.driver_name || `Driver ${String(driverId).slice(-4)}`;
    const phone = (dTok && (dTok.phone || dTok.msisdn)) || dInfo?.phone || subData.driver_phone || 'Not available';
    const email = (dTok && dTok.email) || dInfo?.email || subData.driver_email || 'Not available';

    const v = (dTok && (dTok.vehicle_info || { carModel: dTok.carModel, carPlate: dTok.carPlate, carColor: dTok.carColor, vehicleType: dTok.vehicleType })) || dInfo?.vehicle_info || {};
    const vehFromSub = subData.vehicle_info || {};
    const vehicle_info = {
      carModel: v?.carModel || v?.vehicleType || vehFromSub?.car_model || 'Not available',
      carPlate: v?.carPlate || vehFromSub?.car_plate || 'Not available',
      carColor: v?.carColor || vehFromSub?.car_color || 'Not available'
    };

    return res.json({
      success: true,
      data: {
        passenger_id: passengerId,
        subscription: {
          id: subscription.id,
          status: subscription.status,
          start_date: subscription.start_date,
          end_date: subscription.end_date,
        },
        assigned_driver: {
          id: String(driverId),
          name,
          phone,
          email,
          vehicle_info,
          type: "driver"
        },
      }
    });
  } catch (error) {
    // As a last resort, respond with subscription-stored fields, mapped to top-level
    const subData = subscription.toJSON();
    const carModel = (subData.vehicle_info && subData.vehicle_info.car_model) || null;
    const carPlate = (subData.vehicle_info && subData.vehicle_info.car_plate) || null;
    const carColor = (subData.vehicle_info && subData.vehicle_info.car_color) || null;

    const fallbackDriverRaw = {
      id: String(driverId),
      name: subData.driver_name || `Driver ${String(driverId).slice(-4)}`,
      phone: subData.driver_phone || 'Not available',
      email: subData.driver_email || 'Not available',
      carModel,
      carPlate,
      carColor,
      type: "driver"
    };
    const fallbackDriver = Object.fromEntries(Object.entries(fallbackDriverRaw).filter(([_, v]) => v !== null && v !== undefined));

    return res.json({
      success: true,
      data: {
        passenger_id: passengerId,
        subscription: {
          id: subscription.id,
          status: subscription.status,
          start_date: subscription.start_date,
          end_date: subscription.end_date,
        },
        assigned_driver: fallbackDriver,
      }
    });
  }
});

// PATCH /trip/:id/pickup - Passenger confirms pickup
exports.confirmPickup = asyncHandler(async (req, res) => {
  const tripId = req.params.id;
  
  const trip = await Trip.findByPk(tripId);
  if (!trip) {
    return res.status(404).json({ success: false, message: "Trip not found" });
  }

  // Check if user can access this trip
  if (req.user.type === "passenger" && String(req.user.id) !== String(trip.passenger_id)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  // Update trip status
  await trip.update({
    pickup_confirmed_by_passenger: true,
    actual_pickup_time: new Date(),
    status: "IN_PROGRESS",
  });

  res.json({
    success: true,
    message: "Pickup confirmed successfully",
    data: {
      trip_id: trip.id,
      trip,
      links: {
        self: `/trip/${trip.id}`,
        dropoff: `/trip/${trip.id}/dropoff`
      }
    }
  });
});

// PATCH /trip/:id/end - Passenger confirms end of trip
exports.confirmTripEnd = asyncHandler(async (req, res) => {
  const tripId = req.params.id;
  
  const trip = await Trip.findByPk(tripId);
  if (!trip) {
    return res.status(404).json({ success: false, message: "Trip not found" });
  }

  // Check if user can access this trip
  if (req.user.type === "passenger" && String(req.user.id) !== String(trip.passenger_id)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  // Update trip status
  await trip.update({
    trip_ended_by_passenger: true,
    actual_dropoff_time: new Date(),
    status: "COMPLETED",
  });

  res.json({
    success: true,
    message: "Trip ended successfully",
    data: trip
  });
});

// GET /passenger/:id/trips - Get trip history for passenger
exports.getTripHistory = asyncHandler(async (req, res) => {
  const passengerId = req.params.id;

  // Check if user can access this passenger's data
  if (req.user.type === "passenger" && String(req.user.id) !== String(passengerId)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const trips = await Trip.findAll({
    where: { passenger_id: passengerId },
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
    order: [['createdAt', 'DESC']],
  });

  // Enrich with driver information
  const uniqueDriverIds = [...new Set(trips.map(t => t.driver_id).filter(Boolean))];
  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  const driverInfoMap = new Map();
  
  await Promise.all(uniqueDriverIds.map(async (driverId) => {
    try {
      const info = await getDriverById(driverId, authHeader);
      if (info) driverInfoMap.set(driverId, info);
    } catch (_) {}
  }));

  const enrichedTrips = trips.map(trip => {
    const tripData = trip.toJSON();
    const driverInfo = driverInfoMap.get(trip.driver_id);
    
    return {
      ...tripData,
      driver_name: driverInfo?.name || null,
      driver_phone: driverInfo?.phone || null,
      driver_email: driverInfo?.email || null,
      vehicle_info: driverInfo ? {
        car_model: driverInfo.carModel,
        car_plate: driverInfo.carPlate,
        car_color: driverInfo.carColor,
      } : null,
    };
  });

  res.json({
    success: true,
    data: enrichedTrips
  });
});

// GET /subscription/price - Calculate subscription price based on pickup/dropoff
exports.calculateSubscriptionPrice = asyncHandler(async (req, res) => {
  const { pickup_lat, pickup_lon, dropoff_lat, dropoff_lon, contract_type = "INDIVIDUAL" } = req.query;

  if (!pickup_lat || !pickup_lon || !dropoff_lat || !dropoff_lon) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameters: pickup_lat, pickup_lon, dropoff_lat, dropoff_lon"
    });
  }

  try {
    const pickupLat = parseFloat(pickup_lat);
    const pickupLon = parseFloat(pickup_lon);
    const dropoffLat = parseFloat(dropoff_lat);
    const dropoffLon = parseFloat(dropoff_lon);

    const fareResult = await calculateFareFromCoordinates(
      pickupLat, pickupLon, dropoffLat, dropoffLon, contract_type
    );

    if (!fareResult.success) {
      return res.status(400).json(fareResult);
    }

    res.json({
      success: true,
      data: {
        ...fareResult.data,
        contract_type,
        estimated_monthly_cost: Math.round(fareResult.data.final_fare * 22 * 100) / 100, // 22 working days
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error calculating subscription price",
      error: error.message
    });
  }
});