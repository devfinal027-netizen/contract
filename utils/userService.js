const axios = require('axios');
const { getLocalDriver, getLocalPassenger, getAllLocalDrivers, getAllLocalPassengers } = require('./localDataStore');

function buildUrlFromTemplate(template, params) {
  if (!template) return null;
  return Object.keys(params || {}).reduce(
    (acc, key) => acc.replace(new RegExp(`{${key}}`, 'g'), encodeURIComponent(String(params[key]))),
    template
  );
}

function getAuthHeaders(tokenOrHeader) {
  const headers = { 'Accept': 'application/json' };
  if (tokenOrHeader) {
    if (typeof tokenOrHeader === 'string') {
      headers['Authorization'] = tokenOrHeader.startsWith('Bearer ') ? tokenOrHeader : `Bearer ${tokenOrHeader}`;
    } else if (typeof tokenOrHeader === 'object' && tokenOrHeader.Authorization) {
      headers['Authorization'] = tokenOrHeader.Authorization;
    }
  } else if (process.env.AUTH_SERVICE_BEARER) {
    headers['Authorization'] = `Bearer ${process.env.AUTH_SERVICE_BEARER}`;
  }
  return headers;
}

async function httpGet(url, headers) {
  const timeout = parseInt(process.env.USER_SERVICE_TIMEOUT_MS || process.env.HTTP_TIMEOUT_MS || '5000');
  const res = await axios.get(url, { headers, timeout });
  return res.data;
}

async function httpPost(url, body, headers) {
  const timeout = parseInt(process.env.USER_SERVICE_TIMEOUT_MS || process.env.HTTP_TIMEOUT_MS || '5000');
  const res = await axios.post(url, body, { headers: { 'Content-Type': 'application/json', ...(headers || {}) }, timeout });
  return res.data;
}

function getAuthBase() {
  return (process.env.AUTH_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function getTemplate(name) {
  return process.env[name] || null;
}

async function getPassengerDetails(id, token) {
  try {
    const tpl = getTemplate('PASSENGER_LOOKUP_URL_TEMPLATE') || `${getAuthBase()}/passengers/{id}`;
    const url = buildUrlFromTemplate(tpl, { id });
    const data = await httpGet(url, getAuthHeaders(token));
    const u = data?.data || data?.user || data?.passenger || data;
    return { success: true, user: { id: String(u.id || u._id || id), name: u.name, phone: u.phone, email: u.email, externalId: u.externalId } };
  } catch (e) {
    return { success: false, message: e.response?.data?.message || e.message };
  }
}

async function getDriverDetails(id, token) {
  try {
    const tpl = getTemplate('DRIVER_LOOKUP_URL_TEMPLATE') || `${getAuthBase()}/drivers/{id}`;
    const url = buildUrlFromTemplate(tpl, { id });
    console.log(`🌐 [getDriverDetails] Making HTTP request to: ${url}`);
    console.log(`🌐 [getDriverDetails] Auth base: ${getAuthBase()}`);
    console.log(`🌐 [getDriverDetails] Template: ${tpl}`);
    console.log(`🌐 [getDriverDetails] Headers:`, JSON.stringify(getAuthHeaders(token), null, 2));
    
    const data = await httpGet(url, getAuthHeaders(token));
    console.log(`🌐 [getDriverDetails] Raw response data:`, JSON.stringify(data, null, 2));
    
    const u = data?.data || data?.user || data?.driver || data;
    console.log(`🌐 [getDriverDetails] Extracted user object:`, JSON.stringify(u, null, 2));
    
    const result = { 
      success: true, 
      user: { 
        id: String(u.id || u._id || id), 
        name: u.name, 
        phone: u.phone, 
        email: u.email, 
        externalId: u.externalId, 
        vehicleType: u.vehicleType, 
        carPlate: u.carPlate, 
        carModel: u.carModel, 
        carColor: u.carColor, 
        rating: u.rating, 
        available: u.available, 
        lastKnownLocation: u.lastKnownLocation, 
        paymentPreference: u.paymentPreference,
      } 
    };
    
    console.log(`✅ [getDriverDetails] Successfully processed driver data:`, JSON.stringify(result, null, 2));
    return result;
  } catch (e) {
    console.log(`❌ [getDriverDetails] Error occurred:`, e.message);
    console.log(`❌ [getDriverDetails] Error response:`, e.response?.data);
    console.log(`❌ [getDriverDetails] Error status:`, e.response?.status);
    return { success: false, message: e.response?.data?.message || e.message };
  }
}

async function getDriverById(id, options) {
  console.log(`🔍 [getDriverById] Attempting to fetch driver with ID: ${id}`);
  console.log(`🔍 [getDriverById] Options:`, JSON.stringify(options, null, 2));
  
  const token = options && options.headers ? options.headers.Authorization : undefined;
  console.log(`🔍 [getDriverById] Using token: ${token ? 'Yes (length: ' + token.length + ')' : 'No'}`);
  
  let res = await getDriverDetails(id, token);
  console.log(`🔍 [getDriverById] First attempt result:`, JSON.stringify(res, null, 2));
  
  if (!res.success) {
    console.log(`⚠️ [getDriverById] First attempt failed, trying without token...`);
    res = await getDriverDetails(id, undefined);
    console.log(`🔍 [getDriverById] Second attempt result:`, JSON.stringify(res, null, 2));
  }
  
  if (!res.success) {
    console.log(`❌ [getDriverById] Both external attempts failed for driver ID: ${id}`);
    console.log(`📦 [getDriverById] Trying local data store fallback...`);
    
    const localDriver = getLocalDriver(id);
    if (localDriver) {
      console.log(`✅ [getDriverById] Found driver ${id} in local data store`);
      return localDriver;
    }
    
    console.log(`❌ [getDriverById] Driver ${id} not found in external service or local store`);
    return null;
  }
  
  const mappedDriver = {
    id: String(res.user.id),
    name: res.user.name,
    phone: res.user.phone,
    email: res.user.email,
    vehicleType: res.user.vehicleType,
    carPlate: res.user.carPlate,
    carModel: res.user.carModel,
    carColor: res.user.carColor,
    rating: res.user.rating,
    available: res.user.available,
    lastKnownLocation: res.user.lastKnownLocation,
    paymentPreference: res.user.paymentPreference,
  };
  
  console.log(`✅ [getDriverById] Successfully mapped driver:`, JSON.stringify(mappedDriver, null, 2));
  return mappedDriver;
}

async function getPassengerById(id, options) {
  console.log(`🔍 [getPassengerById] Attempting to fetch passenger with ID: ${id}`);
  
  const token = options && options.headers ? options.headers.Authorization : undefined;
  const res = await getPassengerDetails(id, token);
  
  if (!res.success) {
    console.log(`❌ [getPassengerById] External service failed for passenger ID: ${id}`);
    console.log(`📦 [getPassengerById] Trying local data store fallback...`);
    
    const localPassenger = getLocalPassenger(id);
    if (localPassenger) {
      console.log(`✅ [getPassengerById] Found passenger ${id} in local data store`);
      return localPassenger;
    }
    
    console.log(`❌ [getPassengerById] Passenger ${id} not found in external service or local store`);
    return null;
  }
  
  console.log(`✅ [getPassengerById] Found passenger ${id} in external service`);
  return { 
    id: String(res.user.id), 
    name: res.user.name, 
    phone: res.user.phone, 
    email: res.user.email,
    externalId: res.user.externalId,
    vehicleType: res.user.vehicleType,
    paymentPreference: res.user.paymentPreference
  };
}

async function getDriversByIds(ids = [], token) {
  try {
    const base = getAuthBase();
    const url = `${base}/drivers/batch`;
    const data = await httpPost(url, { ids }, getAuthHeaders(token));
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone, email: u.email, vehicleType: u.vehicleType, carModel: u.carModel, carPlate: u.carPlate, carColor: u.carColor, rating: u.rating, available: u.available, lastKnownLocation: u.lastKnownLocation, paymentPreference: u.paymentPreference }));
  } catch (e) {
    const results = await Promise.all((ids || []).map(id => getDriverById(id, {})));
    return results.filter(Boolean);
  }
}

async function listDrivers(query = {}, options) {
  console.log(`🔍 [listDrivers] Attempting to fetch drivers with query:`, JSON.stringify(query, null, 2));
  console.log(`🔍 [listDrivers] Options:`, JSON.stringify(options, null, 2));
  
  try {
    const base = getAuthBase();
    const url = new URL(`${base}/drivers`);
    Object.entries(query || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
    const token = options && options.headers ? options.headers.Authorization : undefined;
    
    console.log(`🌐 [listDrivers] Making HTTP request to: ${url.toString()}`);
    console.log(`🌐 [listDrivers] Auth base: ${base}`);
    console.log(`🌐 [listDrivers] Using token: ${token ? 'Yes (length: ' + token.length + ')' : 'No'}`);
    
    let data = await httpGet(url.toString(), getAuthHeaders(token));
    console.log(`🌐 [listDrivers] Raw response data:`, JSON.stringify(data, null, 2));
    
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    console.log(`🌐 [listDrivers] Extracted array length: ${arr.length}`);
    
    const mappedDrivers = arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone, email: u.email, vehicleType: u.vehicleType, carModel: u.carModel, carPlate: u.carPlate, carColor: u.carColor, rating: u.rating, available: u.available, lastKnownLocation: u.lastKnownLocation, paymentPreference: u.paymentPreference }));
    
    console.log(`✅ [listDrivers] Successfully mapped ${mappedDrivers.length} drivers`);
    return mappedDrivers;
  } catch (e) {
    console.log(`❌ [listDrivers] First attempt failed:`, e.message);
    console.log(`❌ [listDrivers] Error response:`, e.response?.data);
    console.log(`❌ [listDrivers] Error status:`, e.response?.status);
    
    try {
      console.log(`⚠️ [listDrivers] Trying fallback without token...`);
      const base = getAuthBase();
      const url = new URL(`${base}/drivers`);
      Object.entries(query || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
      const data = await httpGet(url.toString(), getAuthHeaders(undefined));
      const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      const mappedDrivers = arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone, email: u.email, vehicleType: u.vehicleType, carModel: u.carModel, carPlate: u.carPlate, carColor: u.carColor, rating: u.rating, available: u.available, lastKnownLocation: u.lastKnownLocation, paymentPreference: u.paymentPreference }));
      
      console.log(`✅ [listDrivers] Fallback successful, mapped ${mappedDrivers.length} drivers`);
      return mappedDrivers;
    } catch (e2) {
      console.log(`❌ [listDrivers] External fallback also failed:`, e2.message);
      console.log(`📦 [listDrivers] Trying local data store fallback...`);
      
      const localDrivers = getAllLocalDrivers();
      if (localDrivers.length > 0) {
        console.log(`✅ [listDrivers] Found ${localDrivers.length} drivers in local data store`);
        return localDrivers;
      }
      
      console.log(`❌ [listDrivers] No drivers found in external service or local store`);
      return [];
    }
  }
}

async function listPassengers(query = {}, options) {
  try {
    const base = getAuthBase();
    const url = new URL(`${base}/passengers`);
    Object.entries(query || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
    const data = await httpGet(url.toString(), getAuthHeaders(options && options.headers ? options.headers.Authorization : undefined));
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone, email: u.email }));
  } catch (_) { return []; }
}

async function getStaffById(id) {
  try {
    const base = getAuthBase();
    const url = `${base}/staff/${encodeURIComponent(String(id))}`;
    const data = await httpGet(url, getAuthHeaders());
    const u = data?.data || data || {};
    return { id: String(u.id || u._id || id), name: u.name, phone: u.phone };
  } catch (_) { return null; }
}

async function listStaff(query = {}) {
  try {
    const base = getAuthBase();
    const url = new URL(`${base}/staff`);
    Object.entries(query || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
    const data = await httpGet(url.toString(), getAuthHeaders());
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone }));
  } catch (_) { return []; }
}

async function getAdminById(id) {
  try {
    const base = getAuthBase();
    const url = `${base}/admins/${encodeURIComponent(String(id))}`;
    const data = await httpGet(url, getAuthHeaders());
    const u = data?.data || data || {};
    return { id: String(u.id || u._id || id), name: u.name, phone: u.phone };
  } catch (_) { return null; }
}

async function listAdmins(query = {}) {
  try {
    const base = getAuthBase();
    const url = new URL(`${base}/admins`);
    Object.entries(query || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
    const data = await httpGet(url.toString(), getAuthHeaders());
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone }));
  } catch (_) { return []; }
}

module.exports = {
  getPassengerDetails,
  getDriverDetails,
  getDriversByIds,
  getPassengerById,
  getDriverById,
  listDrivers,
  listPassengers,
  getStaffById,
  listStaff,
  getAdminById,
  listAdmins
};

