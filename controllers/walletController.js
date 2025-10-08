const { randomUUID } = require("crypto");
const santim = require("../utils/santimpay");

// NOTE: This project uses Sequelize models; SantimPay wallet requires Mongo models (Wallet, Transaction, PaymentOption, Driver, Commission).
// Since they are not present in this codebase, we stub minimal in-memory replacements to avoid runtime errors.
// Replace these with your actual Mongoose models in your environment.

const memory = { wallets: new Map(), txs: new Map() };

const Wallet = {
  async findOne(query) {
    const key = `${query.userId}:${query.role}`;
    const found = memory.wallets.get(key);
    return found ? { ...found, save: async function() { memory.wallets.set(key, this); } } : null;
  },
  async create(doc) {
    const key = `${doc.userId}:${doc.role}`;
    memory.wallets.set(key, { ...doc });
    return memory.wallets.get(key);
  },
  async updateOne(filter, update) {
    const key = `${filter.userId}:${filter.role}`;
    const cur = memory.wallets.get(key) || { userId: filter.userId, role: filter.role, balance: 0 };
    const inc = (update.$inc && update.$inc.balance) || 0;
    cur.balance = (cur.balance || 0) + inc;
    memory.wallets.set(key, cur);
    return { acknowledged: true };
  }
};

const Transaction = {
  async create(doc) {
    const id = doc._id || randomUUID();
    const entry = { ...doc, _id: id, createdAt: new Date(), updatedAt: new Date() };
    memory.txs.set(String(id), entry);
    return entry;
  },
  async findByIdAndUpdate(id, update) {
    const cur = memory.txs.get(String(id));
    if (!cur) return null;
    Object.assign(cur, update, { updatedAt: new Date() });
    memory.txs.set(String(id), cur);
    return cur;
  },
  async findById(id) { return memory.txs.get(String(id)) || null; },
  async findOne(filter) {
    for (const v of memory.txs.values()) {
      let ok = true;
      for (const [k, val] of Object.entries(filter)) { if (String(v[k]) !== String(val)) ok = false; }
      if (ok) return v;
    }
    return null;
  },
  async find(filter) {
    const out = [];
    for (const v of memory.txs.values()) {
      if (!filter || String(v.userId) === String(filter.userId)) out.push(v);
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }
};

function normalizeMsisdnEt(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/\s+/g, "").replace(/[-()]/g, "");
  if (/^\+?251/.test(s)) {
    s = s.replace(/^\+?251/, "+251");
  } else if (/^0\d+/.test(s)) {
    s = s.replace(/^0/, "+251");
  } else if (/^9\d{8}$/.test(s)) {
    s = "+251" + s;
  }
  if (!/^\+2519\d{8}$/.test(s)) return null;
  return s;
}

function normalizePaymentMethod(method) {
  const raw = String(method || "").trim();
  const m = raw.toLowerCase();
  const table = {
    telebirr: 'Telebirr', tele: 'Telebirr', 'tele-birr': 'Telebirr', 'tele birr': 'Telebirr',
    cbe: 'CBE', 'cbe-birr': 'CBE', cbebirr: 'CBE', 'cbe birr': 'CBE',
    hellocash: 'HelloCash', 'hello-cash': 'HelloCash', 'hello cash': 'HelloCash',
    mpesa: 'MPesa', 'm-pesa': 'MPesa', 'm pesa': 'MPesa', 'm_pesa': 'MPesa',
    abyssinia: 'Abyssinia', 'bank of abyssinia': 'Abyssinia',
    awash: 'Awash', 'awash bank': 'Awash',
    dashen: 'Dashen', 'dashen bank': 'Dashen',
    bunna: 'Bunna', 'bunna bank': 'Bunna',
    amhara: 'Amhara', 'amhara bank': 'Amhara',
    berhan: 'Berhan', 'berhan bank': 'Berhan',
    zamzam: 'ZamZam', 'zamzam bank': 'ZamZam',
    yimlu: 'Yimlu',
  };
  if (table[m]) return table[m];
  if (m.includes('bank')) return 'CBE';
  return raw;
}

exports.topup = async (req, res) => {
  try {
    const { amount, paymentMethod, reason = "Wallet Topup" } = req.body || {};
    if (!amount || amount <= 0) return res.status(400).json({ message: "amount must be > 0" });

    const tokenPhone = req.user && (req.user.phone || req.user.phoneNumber || req.user.mobile);
    if (!tokenPhone) return res.status(400).json({ message: "phoneNumber missing in token" });

    const msisdn = normalizeMsisdnEt(tokenPhone);
    if (!msisdn) return res.status(400).json({ message: "Invalid phone format in token. Required: +2519XXXXXXXX" });

    const userId = String(req.user.id);
    const role = req.user.type;

    let wallet = await Wallet.findOne({ userId, role });
    if (!wallet) wallet = await Wallet.create({ userId, role, balance: 0 });

    const txId = randomUUID();
    const tx = await Transaction.create({ _id: txId, refId: String(txId), userId, role, amount, type: "credit", method: "santimpay", status: "pending", msisdn, metadata: { reason } });

    const methodForGateway = normalizePaymentMethod(paymentMethod);

    const notifyUrl = process.env.SANTIMPAY_NOTIFY_URL || `${process.env.PUBLIC_BASE_URL || ""}/wallet/webhook`;
    let gw;
    try {
      gw = await santim.directPayment({ id: String(txId), amount, paymentReason: reason, notifyUrl, phoneNumber: msisdn, paymentMethod: methodForGateway });
    } catch (err) {
      await Transaction.findByIdAndUpdate(txId, { status: 'failed', metadata: { gatewayError: String(err && err.message || err) } });
      return res.status(400).json({ message: 'payment failed' });
    }

    const gwTxnId = gw?.TxnId || gw?.txnId || gw?.data?.TxnId || gw?.data?.txnId;
    await Transaction.findByIdAndUpdate(txId, { txnId: gwTxnId, metadata: { ...tx.metadata, gatewayResponse: gw } });

    return res.status(202).json({ message: "Topup initiated", transactionId: String(txId), gatewayTxnId: gwTxnId });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

exports.webhook = async (req, res) => {
  try {
    const body = req.body || {};
    const data = body.data || body;
    const thirdPartyId = data.thirdPartyId || data.ID || data.id || data.transactionId || data.clientReference;
    const providerRefId = data.RefId || data.refId;
    const gwTxnId = data.TxnId || data.txnId;
    if (!thirdPartyId && !gwTxnId) return res.status(200).json({ ok: false, message: "Transaction not found for webhook" });

    let tx = null;
    if (thirdPartyId) tx = await Transaction.findById(thirdPartyId);
    if (!tx && thirdPartyId) tx = await Transaction.findOne({ refId: String(thirdPartyId) });
    if (!tx && gwTxnId) tx = await Transaction.findOne({ txnId: String(gwTxnId) });
    if (!tx) return res.status(200).json({ ok: false, message: "Transaction not found for webhook", thirdPartyId, txnId: gwTxnId, providerRefId });

    const rawStatus = (data.Status || data.status || "").toString().toUpperCase();
    const normalizedStatus = ["COMPLETED", "SUCCESS", "APPROVED"].includes(rawStatus) ? "success" : ["FAILED", "CANCELLED", "DECLINED"].includes(rawStatus) ? "failed" : "pending";

    const previousStatus = tx.status;
    tx.txnId = gwTxnId || tx.txnId;
    tx.refId = tx.refId || (thirdPartyId && String(thirdPartyId));
    tx.status = normalizedStatus;
    tx.msisdn = data.Msisdn || data.msisdn || tx.msisdn;
    tx.metadata = { ...tx.metadata, webhook: data, raw: body };
    tx.updatedAt = new Date();
    await Transaction.findByIdAndUpdate(tx._id, tx);

    const wasFinal = previousStatus === "success" || previousStatus === "failed";
    if (!wasFinal && normalizedStatus === "success") {
      const providerAmount = Number(data.adjustedAmount || data.amount || tx.amount);
      await Wallet.updateOne({ userId: tx.userId, role: tx.role }, { $inc: { balance: providerAmount } }, { upsert: true });
    }

    return res.status(200).json({ ok: true, txnId: data.TxnId || data.txnId, refId: data.RefId || data.refId, thirdPartyId: data.thirdPartyId, status: data.Status || data.status, amount: data.amount || data.Amount || data.TotalAmount, msisdn: data.Msisdn || data.msisdn, updatedAt: new Date() });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};

exports.transactions = async (req, res) => {
  try {
    const userId = req.params.userId || req.user.id;
    const rows = await Transaction.find({ userId: String(userId) });
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

exports.withdraw = async (req, res) => {
  try {
    return res.status(501).json({ message: "Withdraw not implemented in this environment" });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

