const { Subscription, Trip, TripSchedule } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { getPassengerById } = require("../utils/userService");
const { getUserInfo } = require("../utils/tokenHelper");
const { Op } = require("sequelize");

// GET /driver/:id/passengers - Get driver's subscribed passengers with contract expiration and payment status
exports.getDriverPassengers = asyncHandler(async (req, res) => {
  const driverId = req.params.id;

  // Check if user can access this driver's data
  // Allow admin access or driver accessing their own data
  if (req.user.type === "driver" && String(req.user.id) !== String(driverId)) {
    return res.status(403).json({
      success: false,
      message: "Access denied - driver can only access their own data"
    });
  }

  try {
    const subscriptions = await Subscription.findAll({
      where: {
        driver_id: driverId,
        status: ["ACTIVE", "PENDING"]
      },
      order: [['end_date', 'ASC']],
    });

    // Enrich with passenger information and expiration details
    const enrichedPassengers = await Promise.all(
      subscriptions.map(async (subscription) => {
        const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
        let externalPassenger = null;
        let tokenPassenger = null;
        try { externalPassenger = await getPassengerById(subscription.passenger_id, authHeader); } catch (_) {}
        try { tokenPassenger = await getUserInfo(req, subscription.passenger_id, 'passenger'); } catch (_) {}

        const subData = subscription.toJSON();
        const name = (externalPassenger && externalPassenger.name) || (tokenPassenger && tokenPassenger.name) || subData.passenger_name || `Passenger ${String(subscription.passenger_id).slice(-4)}`;
        const phone = (externalPassenger && externalPassenger.phone) || (tokenPassenger && tokenPassenger.phone) || subData.passenger_phone || 'Not available';
        const email = (externalPassenger && externalPassenger.email) || (tokenPassenger && tokenPassenger.email) || subData.passenger_email || 'Not available';

        const endDate = new Date(subscription.end_date);
        const today = new Date();
        const daysUntilExpiry = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
        
        return {
          subscription_id: subscription.id,
          passenger_id: subscription.passenger_id,
          passenger_name: name,
          passenger_phone: phone,
          passenger_email: email,
          contract_type: subscription.contract_type,
          pickup_location: subscription.pickup_location,
          dropoff_location: subscription.dropoff_location,
          start_date: subscription.start_date,
          end_date: subscription.end_date,
          expiration_date: subscription.end_date,
          days_until_expiry: daysUntilExpiry,
          is_expired: daysUntilExpiry < 0,
          payment_status: subscription.payment_status,
          subscription_status: subscription.status,
          fare: subscription.final_fare,
        };
      })
    );

    // Separate by expiration status
    const activePassengers = enrichedPassengers.filter(p => !p.is_expired && p.subscription_status === "ACTIVE");
    const expiringPassengers = enrichedPassengers.filter(p => p.days_until_expiry <= 7 && p.days_until_expiry > 0);
    const pendingPayment = enrichedPassengers.filter(p => p.payment_status === "PENDING");

    res.json({
      success: true,
      data: {
        driver_id: driverId,
        passengers: enrichedPassengers,
        active_passengers: activePassengers,
        expiring_soon: expiringPassengers,
        pending_payment: pendingPayment,
        counters: {
          total_passengers: enrichedPassengers.length,
          active_count: activePassengers.length,
          expiring_count: expiringPassengers.length,
          pending_payment_count: pendingPayment.length,
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching driver passengers",
      error: error.message
    });
  }
});

// GET /driver/:id/schedule - Get driver's schedule and subscription details
exports.getDriverSchedule = asyncHandler(async (req, res) => {
  const driverId = req.params.id;
  const { date, contract_type } = req.query;

  // Check if user can access this driver's data
  // Allow admin access or driver accessing their own data
  if (req.user.type === "driver" && String(req.user.id) !== String(driverId)) {
    return res.status(403).json({
      success: false,
      message: "Access denied - driver can only access their own data"
    });
  }

  try {
    let whereClause = {
      driver_id: driverId,
      status: "ACTIVE"
    };

    // Filter by contract type if provided
    if (contract_type) {
      whereClause.contract_type = contract_type;
    }

    // Filter by date range if provided
    if (date) {
      const targetDate = new Date(date);
      whereClause.start_date = {
        [Op.lte]: targetDate
      };
      whereClause.end_date = {
        [Op.gte]: targetDate
      };
    }

    const scheduleSubscriptions = await Subscription.findAll({
      where: whereClause,
      order: [['start_date', 'ASC'], ['createdAt', 'DESC']],
    });

    // Enrich schedule with passenger information and organize by contract type
    const enrichedSchedule = await Promise.all(
      scheduleSubscriptions.map(async (subscription) => {
        const subData = subscription.toJSON();
        const passengerInfo = await getUserInfo(req, subscription.passenger_id, 'passenger');
        
        return {
          ...subData,
          passenger_name: passengerInfo?.name || subscription.passenger_name || null,
          passenger_phone: passengerInfo?.phone || subscription.passenger_phone || null,
          passenger_email: passengerInfo?.email || subscription.passenger_email || null,
        };
      })
    );

    // Group by contract type for better organization
    const scheduleByType = enrichedSchedule.reduce((acc, subscription) => {
      const type = subscription.contract_type;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(subscription);
      return acc;
    }, {});

    // Calculate schedule statistics
    const stats = {
      total_active_subscriptions: enrichedSchedule.length,
      individual_subscriptions: scheduleByType.INDIVIDUAL?.length || 0,
      group_subscriptions: scheduleByType.GROUP?.length || 0,
      institutional_subscriptions: scheduleByType.INSTITUTIONAL?.length || 0,
    };

    res.json({
      success: true,
      data: {
        schedule: enrichedSchedule,
        schedule_by_type: scheduleByType,
        statistics: stats,
        filters_applied: { date, contract_type }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching driver schedule",
      error: error.message
    });
  }
});

// GET /driver/:id/earnings - Get driver's earnings summary
exports.getDriverEarnings = asyncHandler(async (req, res) => {
  const driverId = req.params.id;
  const { start_date, end_date } = req.query;

  // Check if user can access this driver's data
  // Allow admin access or driver accessing their own data
  if (req.user.type === "driver" && String(req.user.id) !== String(driverId)) {
    return res.status(403).json({
      success: false,
      message: "Access denied - driver can only access their own data"
    });
  }

  try {
    let whereClause = {
      driver_id: driverId,
      payment_status: "PAID"
    };

    // Filter by date range if provided
    if (start_date || end_date) {
      whereClause.createdAt = {};
      if (start_date) {
        whereClause.createdAt[Op.gte] = new Date(start_date);
      }
      if (end_date) {
        whereClause.createdAt[Op.lte] = new Date(end_date);
      }
    }

    const paidSubscriptions = await Subscription.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
    });

    // Calculate earnings
    const totalEarnings = paidSubscriptions.reduce((sum, sub) => {
      return sum + parseFloat(sub.final_fare || 0);
    }, 0);

    // Group by contract type
    const earningsByType = paidSubscriptions.reduce((acc, sub) => {
      const type = sub.contract_type;
      if (!acc[type]) {
        acc[type] = { count: 0, total: 0 };
      }
      acc[type].count += 1;
      acc[type].total += parseFloat(sub.final_fare || 0);
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        total_earnings: Math.round(totalEarnings * 100) / 100,
        total_subscriptions: paidSubscriptions.length,
        earnings_by_type: earningsByType,
        date_range: { start_date, end_date },
        subscriptions: paidSubscriptions.map(sub => ({
          id: sub.id,
          contract_type: sub.contract_type,
          final_fare: sub.final_fare,
          pickup_location: sub.pickup_location,
          dropoff_location: sub.dropoff_location,
          start_date: sub.start_date,
          end_date: sub.end_date,
          created_at: sub.createdAt,
        }))
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching driver earnings",
      error: error.message
    });
  }
});

// GET /driver/:id/triphistory - Get driver's completed trips
exports.getDriverTripHistory = asyncHandler(async (req, res) => {
  const driverId = req.params.id;
  const { start_date, end_date, status } = req.query;

  // Check if user can access this driver's data
  // Allow admin access or driver accessing their own data
  if (req.user.type === "driver" && String(req.user.id) !== String(driverId)) {
    return res.status(403).json({
      success: false,
      message: "Access denied - driver can only access their own data"
    });
  }

  try {
    let whereClause = {
      driver_id: driverId,
    };

    // Filter by status if provided, default to completed trips
    if (status) {
      whereClause.status = status;
    } else {
      whereClause.status = ["COMPLETED", "CANCELLED"];
    }

    // Filter by date range if provided
    if (start_date || end_date) {
      whereClause.createdAt = {};
      if (start_date) {
        whereClause.createdAt[Op.gte] = new Date(start_date);
      }
      if (end_date) {
        whereClause.createdAt[Op.lte] = new Date(end_date);
      }
    }

  const trips = await Trip.findAll({
      where: whereClause,
    order: [['actual_dropoff_time', 'DESC'], ['createdAt', 'DESC']],
    });

    // Enrich trips with passenger information
    const enrichedTrips = await Promise.all(
      trips.map(async (trip) => {
        const tripData = trip.toJSON();
        const passengerInfo = await getUserInfo(req, trip.passenger_id, 'passenger');
        
        return {
          ...tripData,
          passenger_name: passengerInfo?.name || null,
          passenger_phone: passengerInfo?.phone || null,
          passenger_email: passengerInfo?.email || null,
          trip_duration: trip.actual_dropoff_time && trip.actual_pickup_time ? 
            Math.round((new Date(trip.actual_dropoff_time) - new Date(trip.actual_pickup_time)) / (1000 * 60)) : null, // in minutes
        };
      })
    );

    // Calculate statistics
    const completedTrips = enrichedTrips.filter(t => t.status === "COMPLETED");
    const cancelledTrips = enrichedTrips.filter(t => t.status === "CANCELLED");
    const totalDistance = completedTrips.reduce((sum, trip) => sum + (parseFloat(trip.distance_km) || 0), 0);
    const totalFare = completedTrips.reduce((sum, trip) => sum + (parseFloat(trip.fare_amount) || 0), 0);

    res.json({
      success: true,
      data: {
        driver_id: driverId,
        trips: enrichedTrips,
        statistics: {
          total_trips: enrichedTrips.length,
          completed_trips: completedTrips.length,
          cancelled_trips: cancelledTrips.length,
          total_distance_km: Math.round(totalDistance * 100) / 100,
          total_fare: Math.round(totalFare * 100) / 100,
          average_trip_distance: completedTrips.length > 0 ? Math.round((totalDistance / completedTrips.length) * 100) / 100 : 0,
          average_fare_per_trip: completedTrips.length > 0 ? Math.round((totalFare / completedTrips.length) * 100) / 100 : 0,
        },
        filters_applied: { start_date, end_date, status }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching driver trip history",
      error: error.message
    });
  }
});

// POST /driver/:driverId/trip/:tripId/notify - Send notification to passenger
exports.notifyPassenger = asyncHandler(async (req, res) => {
  const { driverId, tripId } = req.params;
  const { notification_type, message } = req.body;

  // Check if user can access this driver's data
  // Allow admin access or driver accessing their own data
  if (req.user.type === "driver" && String(req.user.id) !== String(driverId)) {
    return res.status(403).json({
      success: false,
      message: "Access denied - driver can only send notifications for their own trips"
    });
  }

  try {
    // Find the trip and verify it belongs to the driver
    const trip = await Trip.findOne({
      where: {
        id: tripId,
        driver_id: driverId
      },
      include: [
        { model: Subscription, as: "subscription" },
        { model: TripSchedule, as: "schedule" }
      ]
    });

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: "Trip not found or not assigned to this driver"
      });
    }

    // Find or create trip schedule
    let tripSchedule = trip.schedule;
    if (!tripSchedule) {
      tripSchedule = await TripSchedule.create({
        trip_id: tripId,
        scheduled_time: new Date(), // Default to current time if no schedule exists
        notified: false,
        notification_type: notification_type || "ARRIVAL"
      });
    }

    // Update notification status
    await tripSchedule.update({
      notified: true,
      notification_sent_at: new Date(),
      notification_type: notification_type || tripSchedule.notification_type || "ARRIVAL",
      notes: message || tripSchedule.notes
    });

    // Get user info for notification
    const passengerInfo = await getUserInfo(req, trip.passenger_id, 'passenger');
    const driverInfo = await getUserInfo(req, driverId, 'driver');

    // Here you would integrate with your notification service (SMS, Push, Email)
    // For now, we'll just log and return success
    const notificationData = {
      recipient: {
        id: trip.passenger_id,
        name: passengerInfo?.name,
        phone: passengerInfo?.phone,
        email: passengerInfo?.email
      },
      sender: {
        id: driverId,
        name: driverInfo?.name,
        phone: driverInfo?.phone,
        vehicle_info: driverInfo?.vehicle_info
      },
      trip: {
        id: tripId,
        pickup_location: trip.pickup_location,
        dropoff_location: trip.dropoff_location,
        status: trip.status
      },
      notification: {
        type: notification_type || "ARRIVAL",
        message: message || `Driver ${driverInfo?.name || 'is'} arriving for your scheduled trip`,
        sent_at: new Date()
      }
    };

    // TODO: Integrate with actual notification service
    console.log('Notification sent:', notificationData);

    res.json({
      success: true,
      message: "Notification sent successfully to passenger",
      data: {
        trip_id: tripId,
        driver_id: driverId,
        passenger_id: trip.passenger_id,
        passenger_name: passengerInfo?.name,
        passenger_phone: passengerInfo?.phone,
        notification: {
          type: notification_type || "ARRIVAL",
          message: message || `Driver ${driverInfo?.name || 'is'} arriving for your scheduled trip`,
          sent_at: new Date(),
          delivery_status: "SENT" // In real implementation, this would be from notification service
        },
        trip_details: {
          pickup_location: trip.pickup_location,
          dropoff_location: trip.dropoff_location,
          status: trip.status,
          scheduled_time: tripSchedule.scheduled_time
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error sending notification",
      error: error.message
    });
  }
});