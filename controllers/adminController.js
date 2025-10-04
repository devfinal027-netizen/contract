const { Pricing, Contract, Subscription, Trip } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { calculateFareFromCoordinates } = require("../utils/pricingService");

// POST /admin/contract/price - Set/update price per kilometer for contracts
exports.setContractPricing = asyncHandler(async (req, res) => {
  const { 
    contract_type, 
    price_per_km, 
    base_fare = 0, 
    minimum_fare = 0,
    effective_from,
    effective_until 
  } = req.body;

  if (!contract_type || !price_per_km) {
    return res.status(400).json({
      success: false,
      message: "contract_type and price_per_km are required"
    });
  }

  if (!["INDIVIDUAL", "GROUP", "INSTITUTIONAL"].includes(contract_type)) {
    return res.status(400).json({
      success: false,
      message: "contract_type must be one of: INDIVIDUAL, GROUP, INSTITUTIONAL"
    });
  }

  try {
    // Deactivate existing pricing for this contract type
    await Pricing.update(
      { is_active: false },
      { 
        where: { 
          contract_type: contract_type,
          is_active: true 
        } 
      }
    );

    // Create new pricing
    const newPricing = await Pricing.create({
      contract_type,
      price_per_km: parseFloat(price_per_km),
      base_fare: parseFloat(base_fare),
      minimum_fare: parseFloat(minimum_fare),
      effective_from: effective_from ? new Date(effective_from) : new Date(),
      effective_until: effective_until ? new Date(effective_until) : null,
      created_by: req.user.id,
      is_active: true,
    });

    res.status(201).json({
      success: true,
      message: "Pricing updated successfully",
      data: newPricing
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error updating pricing",
      error: error.message
    });
  }
});

// GET /admin/contract/price - Get current pricing for all contract types
exports.getContractPricing = asyncHandler(async (req, res) => {
  const { contract_type } = req.query;

  let whereClause = { is_active: true };
  if (contract_type) {
    whereClause.contract_type = contract_type;
  }

  const pricing = await Pricing.findAll({
    where: whereClause,
    order: [['contract_type', 'ASC'], ['effective_from', 'DESC']],
  });

  res.json({
    success: true,
    data: pricing
  });
});

// GET /admin/pricing/history - Get pricing history
exports.getPricingHistory = asyncHandler(async (req, res) => {
  const { contract_type } = req.query;

  let whereClause = {};
  if (contract_type) {
    whereClause.contract_type = contract_type;
  }

  const pricingHistory = await Pricing.findAll({
    where: whereClause,
    order: [['contract_type', 'ASC'], ['effective_from', 'DESC']],
  });

  res.json({
    success: true,
    data: pricingHistory
  });
});

// POST /admin/subscription/calculate - Calculate subscription price for admin review
exports.calculateSubscriptionForAdmin = asyncHandler(async (req, res) => {
  const { 
    pickup_lat, 
    pickup_lon, 
    dropoff_lat, 
    dropoff_lon, 
    contract_type = "INDIVIDUAL",
    passenger_id,
    monthly_trips = 22 // Default working days
  } = req.body;

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

    const monthlyTrips = parseInt(monthly_trips);
    const estimatedMonthlyCost = Math.round(fareResult.data.final_fare * monthlyTrips * 100) / 100;
    const estimatedYearlyCost = Math.round(estimatedMonthlyCost * 12 * 100) / 100;

    res.json({
      success: true,
      data: {
        ...fareResult.data,
        contract_type,
        passenger_id,
        monthly_trips: monthlyTrips,
        estimated_monthly_cost: estimatedMonthlyCost,
        estimated_yearly_cost: estimatedYearlyCost,
        calculation_timestamp: new Date(),
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

// GET /admin/dashboard/stats - Get admin dashboard statistics
exports.getDashboardStats = asyncHandler(async (req, res) => {
  try {
    // Get contract statistics
    const contractStats = await Contract.findAll({
      attributes: [
        'status',
        [Contract.sequelize.fn('COUNT', '*'), 'count']
      ],
      group: ['status']
    });

    // Get subscription statistics
    const subscriptionStats = await Subscription.findAll({
      attributes: [
        'status',
        [Subscription.sequelize.fn('COUNT', '*'), 'count']
      ],
      group: ['status']
    });

    // Get trip statistics
    const tripStats = await Trip.findAll({
      attributes: [
        'status',
        [Trip.sequelize.fn('COUNT', '*'), 'count']
      ],
      group: ['status']
    });

    // Get revenue statistics (from subscriptions)
    const revenueStats = await Subscription.findAll({
      attributes: [
        [Subscription.sequelize.fn('SUM', Subscription.sequelize.col('amount_paid')), 'total_revenue'],
        [Subscription.sequelize.fn('COUNT', '*'), 'total_subscriptions']
      ],
      where: { status: ['ACTIVE', 'PARTIAL'] }
    });

    // Get active pricing
    const activePricing = await Pricing.findAll({
      where: { is_active: true },
      order: [['contract_type', 'ASC']]
    });

    res.json({
      success: true,
      data: {
        contracts: contractStats.reduce((acc, stat) => {
          acc[stat.status] = parseInt(stat.dataValues.count);
          return acc;
        }, {}),
        subscriptions: subscriptionStats.reduce((acc, stat) => {
          acc[stat.status] = parseInt(stat.dataValues.count);
          return acc;
        }, {}),
        trips: tripStats.reduce((acc, stat) => {
          acc[stat.status] = parseInt(stat.dataValues.count);
          return acc;
        }, {}),
        revenue: {
          total_revenue: parseFloat(revenueStats[0]?.dataValues.total_revenue || 0),
          total_subscriptions: parseInt(revenueStats[0]?.dataValues.total_subscriptions || 0)
        },
        active_pricing: activePricing,
        last_updated: new Date()
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching dashboard statistics",
      error: error.message
    });
  }
});

// PUT /admin/pricing/:id/deactivate - Deactivate a pricing rule
exports.deactivatePricing = asyncHandler(async (req, res) => {
  const pricingId = req.params.id;

  const pricing = await Pricing.findByPk(pricingId);
  if (!pricing) {
    return res.status(404).json({
      success: false,
      message: "Pricing rule not found"
    });
  }

  await pricing.update({ 
    is_active: false,
    effective_until: new Date()
  });

  res.json({
    success: true,
    message: "Pricing rule deactivated successfully",
    data: pricing
  });
});