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
  const { payment_option_id, is_active = true } = req.body || {};
  if (!payment_option_id) return res.status(400).json({ message: 'payment_option_id is required' });
  const opt = await PaymentOption.findByPk(payment_option_id);
  if (!opt) return res.status(404).json({ message: 'Payment option not found' });

  const [row, created] = await PaymentPreference.findOrCreate({
    where: { user_id: userId, user_type: userType, payment_option_id },
    defaults: { user_id: userId, user_type: userType, payment_option_id, is_active: !!is_active }
  });
  if (!created) {
    await row.update({ is_active: !!is_active });
  }
  return res.json({ success: true, preference: { payment_option_id, is_active: !!is_active } });
});

exports.getPreference = asyncHandler(async (req, res) => {
  const userId = String(req.user.id);
  const userType = req.user.type;
  const prefs = await PaymentPreference.findAll({ where: { user_id: userId, user_type: userType, is_active: true } });
  return res.json({ preferences: prefs.map(p => ({ payment_option_id: p.payment_option_id, is_active: p.is_active })) });
});

