const { Trip, Subscription, Contract, RideSchedule } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { getDriverById } = require("../utils/userService");
const { getUserInfo } = require("../utils/tokenHelper");
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
    // Prioritize token-derived info (as requested), then external service, then stored fields
    const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
    let tokenHelperInfo = null;
    let fetched = null;
    try { tokenHelperInfo = await getUserInfo(req, driverId, 'driver'); } catch (_) {}
    try { fetched = await getDriverById(driverId, authHeader); } catch (_) {}

    const subData = subscription.toJSON();
    const name = (tokenHelperInfo && tokenHelperInfo.name) || (fetched && fetched.name) || subData.driver_name || `Driver ${String(driverId).slice(-4)}`;
    const phone = (tokenHelperInfo && tokenHelperInfo.phone) || (fetched && fetched.phone) || subData.driver_phone || 'Not available';
    const email = (tokenHelperInfo && tokenHelperInfo.email) || (fetched && fetched.email) || subData.driver_email || 'Not available';

    // Derive vehicle details in both admin-like top-level fields and snake_case vehicle_info
    const vehicleType = (tokenHelperInfo && tokenHelperInfo.vehicle_info && tokenHelperInfo.vehicle_info.vehicleType) || (fetched && fetched.vehicleType) || null;
    const carModel = (tokenHelperInfo && tokenHelperInfo.vehicle_info && tokenHelperInfo.vehicle_info.carModel) || (fetched && fetched.carModel) || null;
    const carPlate = (tokenHelperInfo && tokenHelperInfo.vehicle_info && tokenHelperInfo.vehicle_info.carPlate) || (fetched && fetched.carPlate) || null;
    const carColor = (tokenHelperInfo && tokenHelperInfo.vehicle_info && tokenHelperInfo.vehicle_info.carColor) || (fetched && fetched.carColor) || null;

    const assignedDriver = {
      id: String(driverId),
      name,
      phone,
      email,
      // Admin-like fields for parity
      vehicleType,
      carModel,
      carPlate,
      carColor,
      rating: (fetched && fetched.rating) != null ? fetched.rating : null,
      available: (fetched && fetched.available) != null ? !!fetched.available : null,
      lastKnownLocation: fetched && fetched.lastKnownLocation ? fetched.lastKnownLocation : null,
      paymentPreference: fetched && fetched.paymentPreference ? fetched.paymentPreference : null,
      // Backward compatible nested vehicle_info
      vehicle_info: (function() {
        if (carModel || carPlate || carColor || vehicleType) {
          return { car_model: carModel || vehicleType || null, car_plate: carPlate || null, car_color: carColor || null };
        }
        return subData.vehicle_info || null;
      })(),
      type: "driver"
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
        assigned_driver: assignedDriver,
      }
    });
  } catch (error) {
    // As a last resort, respond with subscription-stored fields instead of failing
    const subData = subscription.toJSON();
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
          name: subData.driver_name || `Driver ${String(driverId).slice(-4)}`,
          phone: subData.driver_phone || 'Not available',
          email: subData.driver_email || 'Not available',
          vehicle_info: subData.vehicle_info || null,
          type: "driver"
        }
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