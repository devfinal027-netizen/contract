const { Payment, Subscription, Contract } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { deleteFile } = require("../utils/fileHelper");
const path = require("path");
const { getPassengerById, getAdminById } = require("../utils/userService");

// CREATE payment for subscription (used by newSubscriptionController)
exports.createPaymentForSubscription = asyncHandler(async (subscriptionId, paymentData, file = null) => {
  // Get subscription details
  const subscription = await Subscription.findByPk(subscriptionId, {
    include: [{ model: Contract, as: "contract" }]
  });

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  const payment = {
    subscription_id: subscriptionId,
    contract_id: subscription.contract_id,
    passenger_id: subscription.passenger_id,
    amount: paymentData.amount || subscription.final_fare,
    payment_method: paymentData.payment_method,
    transaction_reference: paymentData.transaction_reference,
    due_date: paymentData.due_date || new Date(),
    status: paymentData.status || "PENDING",
    admin_approved: false,
  };

  // Handle receipt image from form data or file upload
  if (paymentData.receipt_image) {
    payment.receipt_image = paymentData.receipt_image;
  } else if (file) {
    payment.receipt_image = path.join("uploads", "payments", file.filename);
  }

  const createdPayment = await Payment.create(payment);
  return createdPayment;
});

// CREATE with file upload (legacy endpoint)
exports.createPayment = asyncHandler(async (req, res) => {
  const { subscription_id, amount, payment_method, transaction_reference, due_date } = req.body;

  // Validate required fields
  if (!subscription_id || !amount || !payment_method) {
    return res.status(400).json({
      success: false,
      message: "subscription_id, amount, and payment_method are required"
    });
  }

  // Verify subscription exists and belongs to passenger
  const subscription = await Subscription.findOne({
    where: { 
      id: subscription_id,
      passenger_id: req.user.id 
    },
    include: [{ model: Contract, as: "contract" }]
  });

  if (!subscription) {
    return res.status(404).json({
      success: false,
      message: "Subscription not found or access denied"
    });
  }

  const paymentData = {
    subscription_id,
    contract_id: subscription.contract_id,
    passenger_id: req.user.id,
    amount: parseFloat(amount),
    payment_method,
    transaction_reference,
    due_date: due_date || new Date(),
    status: "PENDING",
    admin_approved: false,
  };

  if (req.file) {
    paymentData.receipt_image = path.join("uploads", "payments", req.file.filename);
  }

  const payment = await Payment.create(paymentData);
  
  res.status(201).json({ 
    success: true, 
    message: "Payment submitted for admin approval",
    data: payment 
  });
});

// READ all - Admin sees all, Passenger sees only their own
exports.getPayments = asyncHandler(async (req, res) => {
  let whereClause = {};

  if (req.user.type === "passenger") {
    whereClause.passenger_id = req.user.id;
  }

  const payments = await Payment.findAll({
    where: whereClause,
    include: [
      { model: Contract, as: "contract" },
      { model: Subscription, as: "subscription" }
    ],
  });

  const paymentsWithUrls = payments.map((payment) => ({
    ...payment.toJSON(),
    receipt_image_url: payment.receipt_image
      ? `${req.protocol}://${req.get("host")}/${payment.receipt_image}`
      : null,
  }));

  // Enrich with passenger info (name, phone, email)
  const uniquePassengerIds = [...new Set(paymentsWithUrls.map(p => p.passenger_id).filter(Boolean))];
  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  const passengerInfoMap = new Map();
  await Promise.all(uniquePassengerIds.map(async (pid) => {
    try {
      const info = await getPassengerById(pid, authHeader);
      if (info) passengerInfoMap.set(pid, info);
    } catch (_) {}
  }));

  const enriched = paymentsWithUrls.map(p => {
    const info = passengerInfoMap.get(p.passenger_id);
    if (!info) return p;
    return {
      ...p,
      passenger_name: info.name || null,
      passenger_phone: info.phone || null,
      passenger_email: info.email || null,
    };
  });

  res.json({ success: true, data: enriched });
});

// READ one - Admin sees all, Passenger sees only their own
exports.getPayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findByPk(req.params.id, {
    include: [
      { model: Contract, as: "contract" },
      { model: Subscription, as: "subscription" }
    ],
  });

  if (!payment) {
    return res
      .status(404)
      .json({ success: false, message: "Payment not found" });
  }

  // Ownership check for passengers
  if (req.user.type === "passenger" && payment.passenger_id !== req.user.id) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  // Add full URL for the receipt image
  const paymentWithUrl = {
    ...payment.toJSON(),
    receipt_image_url: payment.receipt_image
      ? `${req.protocol}://${req.get("host")}/${payment.receipt_image}`
      : null,
  };

  // Enrich single payment with passenger info
  try {
    if (paymentWithUrl.passenger_id) {
      const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
      const info = await getPassengerById(paymentWithUrl.passenger_id, authHeader);
      if (info) {
        paymentWithUrl.passenger_name = info.name || null;
        paymentWithUrl.passenger_phone = info.phone || null;
        paymentWithUrl.passenger_email = info.email || null;
      }
    }
  } catch (_) {}

  res.json({ success: true, data: paymentWithUrl });
});

// UPDATE with optional file upload
exports.updatePayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findByPk(req.params.id);

  if (!payment) {
    return res
      .status(404)
      .json({ success: false, message: "Payment not found" });
  }

  const updateData = { ...req.body };

  // Handle file upload - delete old file if new one is uploaded
  if (req.file) {
    // Delete old file if it exists
    if (payment.receipt_image) {
      deleteFile(payment.receipt_image);
    }

    // Save the relative path to the new file
    updateData.receipt_image = path.join(
      "uploads",
      "payments",
      req.file.filename
    );
  }

  const [updated] = await Payment.update(updateData, {
    where: { id: req.params.id },
  });

  if (!updated) {
    return res
      .status(404)
      .json({ success: false, message: "Payment not found" });
  }

  res.json({ success: true, message: "Payment updated" });
});

// DELETE with file cleanup
exports.deletePayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findByPk(req.params.id);

  if (!payment) {
    return res
      .status(404)
      .json({ success: false, message: "Payment not found" });
  }

  // Delete associated file if it exists
  if (payment.receipt_image) {
    deleteFile(payment.receipt_image);
  }

  const deleted = await Payment.destroy({ where: { id: req.params.id } });

  if (!deleted) {
    return res
      .status(404)
      .json({ success: false, message: "Payment not found" });
  }

  res.json({ success: true, message: "Payment deleted" });
});

// ADMIN: Approve payment
exports.approvePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user.id;

  const payment = await Payment.findByPk(id, {
    include: [
      { model: Subscription, as: "subscription" },
      { model: Contract, as: "contract" }
    ]
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: "Payment not found"
    });
  }

  if (payment.admin_approved) {
    return res.status(400).json({
      success: false,
      message: "Payment already approved"
    });
  }

  // Update payment status
  await Payment.update({
    admin_approved: true,
    approved_by: adminId,
    approved_at: new Date(),
    status: "SUCCESS",
    rejection_reason: null
  }, {
    where: { id }
  });

  // Update subscription payment status
  if (payment.subscription) {
    await Subscription.update({
      payment_status: "PAID",
      status: "ACTIVE"
    }, {
      where: { id: payment.subscription_id }
    });
  }

  // Get admin details for response
  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  let adminInfo = null;
  try {
    adminInfo = await getAdminById(adminId, authHeader);
  } catch (_) {}

  res.json({
    success: true,
    message: "Payment approved successfully",
    data: {
      payment_id: id,
      approved_by: adminInfo ? adminInfo.name : adminId,
      approved_at: new Date(),
      subscription_status: "ACTIVE"
    }
  });
});

// ADMIN: Reject payment
exports.rejectPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rejection_reason } = req.body;
  const adminId = req.user.id;

  if (!rejection_reason) {
    return res.status(400).json({
      success: false,
      message: "rejection_reason is required"
    });
  }

  const payment = await Payment.findByPk(id, {
    include: [{ model: Subscription, as: "subscription" }]
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: "Payment not found"
    });
  }

  if (payment.admin_approved) {
    return res.status(400).json({
      success: false,
      message: "Cannot reject an already approved payment"
    });
  }

  // Update payment status
  await Payment.update({
    admin_approved: false,
    approved_by: adminId,
    approved_at: new Date(),
    status: "FAILED",
    rejection_reason
  }, {
    where: { id }
  });

  // Update subscription payment status
  if (payment.subscription) {
    await Subscription.update({
      payment_status: "FAILED"
    }, {
      where: { id: payment.subscription_id }
    });
  }

  // Get admin details for response
  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  let adminInfo = null;
  try {
    adminInfo = await getAdminById(adminId, authHeader);
  } catch (_) {}

  res.json({
    success: true,
    message: "Payment rejected",
    data: {
      payment_id: id,
      rejected_by: adminInfo ? adminInfo.name : adminId,
      rejected_at: new Date(),
      rejection_reason,
      subscription_status: "PENDING"
    }
  });
});

// Get pending payments for admin approval
exports.getPendingPayments = asyncHandler(async (req, res) => {
  const pendingPayments = await Payment.findAll({
    where: {
      admin_approved: false,
      status: "PENDING"
    },
    include: [
      { model: Contract, as: "contract" },
      { model: Subscription, as: "subscription" }
    ],
    order: [['createdAt', 'ASC']]
  });

  // Add receipt image URLs
  const paymentsWithUrls = pendingPayments.map((payment) => ({
    ...payment.toJSON(),
    receipt_image_url: payment.receipt_image
      ? `${req.protocol}://${req.get("host")}/${payment.receipt_image}`
      : null,
  }));

  // Enrich with passenger info
  const uniquePassengerIds = [...new Set(paymentsWithUrls.map(p => p.passenger_id).filter(Boolean))];
  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  const passengerInfoMap = new Map();
  
  await Promise.all(uniquePassengerIds.map(async (pid) => {
    try {
      const info = await getPassengerById(pid, authHeader);
      if (info) passengerInfoMap.set(pid, info);
    } catch (_) {}
  }));

  const enriched = paymentsWithUrls.map(p => {
    const info = passengerInfoMap.get(p.passenger_id);
    if (!info) return p;
    return {
      ...p,
      passenger_name: info.name || null,
      passenger_phone: info.phone || null,
      passenger_email: info.email || null,
    };
  });

  res.json({
    success: true,
    data: {
      pending_payments: enriched,
      total_count: enriched.length
    }
  });
});
