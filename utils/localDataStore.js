// Local data store for fallback when external service is unavailable
const localDrivers = new Map();
const localPassengers = new Map();

// Initialize with some sample data
function initializeLocalData() {
  // Sample drivers - matching your examples
  localDrivers.set("1", {
    id: "1",
    name: "abel desalegn",
    phone: "+251921179292",
    email: "abeldesalegn@gmail.com",
    vehicleType: "mini",
    carModel: "Toyota Corolla",
    carPlate: "ASD1234",
    carColor: "White",
    rating: 5,
    available: false,
    lastKnownLocation: { lat: 9.0192, lng: 38.7525 },
    paymentPreference: "CASH"
  });
  
  localDrivers.set("2", {
    id: "2",
    name: "y g",
    phone: "+251988107722",
    email: "y@gmail.com",
    vehicleType: "mini",
    carModel: "Honda Civic",
    carPlate: "ASD1234",
    carColor: "Blue",
    rating: 5,
    available: false,
    lastKnownLocation: { lat: 9.0192, lng: 38.7525 },
    paymentPreference: "CARD"
  });
  
  // Add more sample drivers for testing
  localDrivers.set("3", {
    id: "3",
    name: "Michael Johnson",
    phone: "+251933456789",
    email: "michael.johnson@example.com",
    vehicleType: "sedan",
    carModel: "BMW 320i",
    carPlate: "ET1234",
    carColor: "Black",
    rating: 4.8,
    available: true,
    lastKnownLocation: { lat: 9.0192, lng: 38.7525 },
    paymentPreference: "CARD"
  });
  
  // Sample passengers
  localPassengers.set("1", {
    id: "1",
    name: "John Doe",
    phone: "+251911234567",
    email: "john.doe@example.com"
  });
  
  localPassengers.set("2", {
    id: "2",
    name: "Jane Smith",
    phone: "+251922345678",
    email: "jane.smith@example.com"
  });
  
  localPassengers.set("3", {
    id: "3",
    name: "Alice Brown",
    phone: "+251933456789",
    email: "alice.brown@example.com"
  });
  
  console.log('📦 Local data store initialized with sample data');
  console.log(`📦 Available drivers: ${localDrivers.size}`);
  console.log(`📦 Available passengers: ${localPassengers.size}`);
}

// Get driver from local store
function getLocalDriver(id) {
  const driver = localDrivers.get(String(id));
  if (driver) {
    console.log(`📦 [LocalStore] Found driver ${id} in local store`);
    return {
      id: String(driver.id),
      name: driver.name,
      phone: driver.phone,
      email: driver.email,
      vehicleType: driver.vehicleType,
      carPlate: driver.carPlate,
      carModel: driver.carModel,
      carColor: driver.carColor,
      rating: driver.rating,
      available: driver.available,
      lastKnownLocation: driver.lastKnownLocation,
      paymentPreference: driver.paymentPreference,
    };
  }
  console.log(`📦 [LocalStore] Driver ${id} not found in local store`);
  return null;
}

// Get passenger from local store
function getLocalPassenger(id) {
  const passenger = localPassengers.get(String(id));
  if (passenger) {
    console.log(`📦 [LocalStore] Found passenger ${id} in local store`);
    return {
      id: String(passenger.id),
      name: passenger.name,
      phone: passenger.phone,
      email: passenger.email,
    };
  }
  console.log(`📦 [LocalStore] Passenger ${id} not found in local store`);
  return null;
}

// Get all drivers from local store
function getAllLocalDrivers() {
  const drivers = Array.from(localDrivers.values()).map(driver => ({
    id: String(driver.id),
    name: driver.name,
    phone: driver.phone,
    email: driver.email,
    vehicleType: driver.vehicleType,
    carPlate: driver.carPlate,
    carModel: driver.carModel,
    carColor: driver.carColor,
    rating: driver.rating,
    available: driver.available,
    lastKnownLocation: driver.lastKnownLocation,
    paymentPreference: driver.paymentPreference,
  }));
  console.log(`📦 [LocalStore] Retrieved ${drivers.length} drivers from local store`);
  return drivers;
}

// Get all passengers from local store
function getAllLocalPassengers() {
  const passengers = Array.from(localPassengers.values()).map(passenger => ({
    id: String(passenger.id),
    name: passenger.name,
    phone: passenger.phone,
    email: passenger.email,
  }));
  console.log(`📦 [LocalStore] Retrieved ${passengers.length} passengers from local store`);
  return passengers;
}

// Add or update driver in local store
function setLocalDriver(driver) {
  localDrivers.set(String(driver.id), driver);
  console.log(`📦 [LocalStore] Stored driver ${driver.id} in local store`);
}

// Add or update passenger in local store
function setLocalPassenger(passenger) {
  localPassengers.set(String(passenger.id), passenger);
  console.log(`📦 [LocalStore] Stored passenger ${passenger.id} in local store`);
}

// Initialize on module load
initializeLocalData();

module.exports = {
  getLocalDriver,
  getLocalPassenger,
  getAllLocalDrivers,
  getAllLocalPassengers,
  setLocalDriver,
  setLocalPassenger
};