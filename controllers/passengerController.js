const { Trip, Subscription, Contract, RideSchedule } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { getDriverById } = require("../utils/userService");
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
    // Prefer getting info from token to avoid external calls
    const { getUserInfo } = require("../utils/tokenHelper");
    const tokenDriver = await getUserInfo(req, String(driverId), 'driver');
    let driver = tokenDriver && tokenDriver.id ? tokenDriver : null;
    if (!driver) {
      const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
      const fetched = await getDriverById(driverId, authHeader);
      if (fetched) {
        driver = {
          id: String(fetched.id),
          name: fetched.name,
          phone: fetched.phone,
          email: fetched.email,
          vehicle_info: {
            carModel: fetched.carModel,
            carPlate: fetched.carPlate,
            carColor: fetched.carColor,
            vehicleType: fetched.vehicleType,
          }
        };
      }
    }

    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver information not found" });
    }

    res.json({
      success: true,
      data: {
        passenger_id: passengerId,
        subscription: {
          id: subscription.id,
          status: subscription.status,
          start_date: subscription.start_date,
          end_date: subscription.end_date,
        },
        assigned_driver: driver,
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Error fetching driver information", error: error.message });
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