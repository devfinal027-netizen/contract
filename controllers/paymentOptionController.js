const { PaymentOption, PaymentPreference } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");

exports.list = asyncHandler(async (req, res) => {
  const rows = await PaymentOption.findAll({ order: [["name", "ASC"]] });
  return res.json(rows.map(r => ({ id: r.id, name: r.name, logo: r.logo })));
});

exports.create = asyncHandler(async (req, res) => {
  const { name, logo } = req.body || {};
  if (!name || String(name).trim() === '') return res.status(400).json({ message: 'name is required' });
  const exists = await PaymentOption.findOne({ where: { name: String(name).trim() } });
  if (exists) return res.status(409).json({ message: 'Payment option already exists' });
  const row = await PaymentOption.create({ name: String(name).trim(), logo });
  return res.status(201).json({ id: row.id, name: row.name, logo: row.logo });
});

exports.setPreference = asyncHandler(async (req, res) => {
  const userId = String(req.user.id);
  const userType = req.user.type;
  const { payment_option_id } = req.body || {};
  if (!payment_option_id) return res.status(400).json({ message: 'payment_option_id is required' });
  const opt = await PaymentOption.findByPk(payment_option_id);
  if (!opt) return res.status(404).json({ message: 'Payment option not found' });

  const [row, created] = await PaymentPreference.findOrCreate({
    where: { user_id: userId, user_type: userType },
    defaults: { user_id: userId, user_type: userType, payment_option_id }
  });
  if (!created) {
    await row.update({ payment_option_id });
  }
  return res.json({ success: true, preference: { payment_option_id } });
});

exports.getPreference = asyncHandler(async (req, res) => {
  const userId = String(req.user.id);
  const userType = req.user.type;
  const pref = await PaymentPreference.findOne({ where: { user_id: userId, user_type: userType } });
  if (!pref) return res.json({ payment_option_id: null });
  return res.json({ payment_option_id: pref.payment_option_id });
});

