const { getTrucksList } = require('./controller/vehicleCache');

async function example() {
  try {
    const result = await getTrucksList();
    console.log('Trucks data:', result.trucks);
    console.log('From cache:', result.fromCache);
  } catch (error) {
    console.error('Error fetching trucks:', error);
  }
}

example();