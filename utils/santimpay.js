const crypto = require("crypto");
const axios = require("axios");
const fs = require("fs");

const BASE_URL = process.env.SANTIMPAY_BASE_URL || "https://gateway.santimpay.com/api";
const GATEWAY_MERCHANT_ID = process.env.GATEWAY_MERCHANT_ID;

function resolvePrivateKeyPem() {
  // Priority: explicit PEM -> BASE64 -> PATH
  if (process.env.PRIVATE_KEY_IN_PEM && String(process.env.PRIVATE_KEY_IN_PEM).trim().length > 0) {
    return process.env.PRIVATE_KEY_IN_PEM;
  }
  if (process.env.PRIVATE_KEY_BASE64 && String(process.env.PRIVATE_KEY_BASE64).trim().length > 0) {
    try {
      return Buffer.from(process.env.PRIVATE_KEY_BASE64, "base64").toString("utf8");
    } catch (_) {}
  }
  if (process.env.PRIVATE_KEY_PATH && String(process.env.PRIVATE_KEY_PATH).trim().length > 0) {
    try {
      return fs.readFileSync(process.env.PRIVATE_KEY_PATH, "utf8");
    } catch (_) {}
  }
  return null;
}

function importPrivateKey(pem) {
  const effectivePem = pem || resolvePrivateKeyPem();
  if (!effectivePem || !String(effectivePem).trim()) {
    throw new Error("SantimPay config error: missing PRIVATE_KEY (set PRIVATE_KEY_IN_PEM, or PRIVATE_KEY_BASE64, or PRIVATE_KEY_PATH)");
  }
  return crypto.createPrivateKey({ key: effectivePem, format: "pem" });
}

function signES256(payload, privateKeyPem) {
  const header = { alg: "ES256", typ: "JWT" };
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const sign = crypto.createSign("SHA256");
  sign.update(unsigned);
  sign.end();
  const key = importPrivateKey(privateKeyPem);
  const signature = sign.sign({ key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${unsigned}.${signature}`;
}

function ensureMerchant() {
  if (!GATEWAY_MERCHANT_ID || !String(GATEWAY_MERCHANT_ID).trim()) {
    throw new Error("SantimPay config error: missing GATEWAY_MERCHANT_ID env");
  }
}

function tokenForInitiatePayment(amount, paymentReason) {
  ensureMerchant();
  const time = Math.floor(Date.now() / 1000);
  const payload = { amount, paymentReason, merchantId: GATEWAY_MERCHANT_ID, generated: time };
  return signES256(payload);
}

function tokenForDirectPayment(amount, paymentReason, paymentMethod, phoneNumber) {
  ensureMerchant();
  const time = Math.floor(Date.now() / 1000);
  const payload = { amount, paymentReason, paymentMethod, phoneNumber, merchantId: GATEWAY_MERCHANT_ID, generated: time };
  return signES256(payload);
}

function tokenForGetTransaction(id) {
  ensureMerchant();
  const time = Math.floor(Date.now() / 1000);
  const payload = { id, merId: GATEWAY_MERCHANT_ID, generated: time };
  return signES256(payload);
}

async function initiatePayment({ id, amount, paymentReason, successRedirectUrl, failureRedirectUrl, notifyUrl, phoneNumber = "", cancelRedirectUrl = "" }) {
  const token = tokenForInitiatePayment(amount, paymentReason);
  const payload = { id, amount, reason: paymentReason, merchantId: GATEWAY_MERCHANT_ID, signedToken: token, successRedirectUrl, failureRedirectUrl, notifyUrl, cancelRedirectUrl };
  if (phoneNumber) payload.phoneNumber = phoneNumber;
  const res = await axios.post(`${BASE_URL}/initiate-payment`, payload, { headers: { "Content-Type": "application/json" } });
  return res.data;
}

async function directPayment({ id, amount, paymentReason, notifyUrl, phoneNumber, paymentMethod }) {
  const token = tokenForDirectPayment(amount, paymentReason, paymentMethod, phoneNumber);
  const payload = { id, amount, reason: paymentReason, merchantId: GATEWAY_MERCHANT_ID, signedToken: token, phoneNumber, paymentMethod, notifyUrl };
  const res = await axios.post(`${BASE_URL}/direct-payment`, payload, { headers: { "Content-Type": "application/json" } });
  return res.data;
}

async function payoutTransfer({ id, amount, paymentReason, phoneNumber, paymentMethod, notifyUrl }) {
  const token = tokenForDirectPayment(amount, paymentReason, paymentMethod, phoneNumber);
  const payload = { id, clientReference: id, amount, reason: paymentReason, merchantId: GATEWAY_MERCHANT_ID, signedToken: token, receiverAccountNumber: phoneNumber, notifyUrl, paymentMethod };
  const res = await axios.post(`${BASE_URL}/payout-transfer`, payload, { headers: { "Content-Type": "application/json" } });
  return res.data;
}

async function checkTransactionStatus(id) {
  const token = tokenForGetTransaction(id);
  const payload = { id, merchantId: GATEWAY_MERCHANT_ID, signedToken: token };
  const res = await axios.post(`${BASE_URL}/fetch-transaction-status`, payload, { headers: { "Content-Type": "application/json" } });
  return res.data;
}

module.exports = {
  signES256,
  initiatePayment,
  directPayment,
  payoutTransfer,
  checkTransactionStatus,
};

