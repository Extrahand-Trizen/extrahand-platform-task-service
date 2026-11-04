import { Database } from '../config/database';
import logger from '../config/logger';
import BookNowLocationAvailability from '../models/BookNowLocationAvailability';
import LocationCity from '../models/LocationCity';
import LocationState from '../models/LocationState';
import { normalizeLocationName } from '../services/LocationPricingService';

const STATE_NAME = 'Telangana';
const CITY_NAME = 'Mahabubnagar';
const CITY_ALIASES = ['Mahabubnagar', 'Mahabub Nagar', 'Mahbubnagar', 'Mahbub Nagar'];

async function seedMahabubnagarBookNowLocation() {
  await Database.connectToDb();

  const stateKey = normalizeLocationName(STATE_NAME);
  const state = await LocationState.findOneAndUpdate(
    { normalizedKey: stateKey },
    {
      $setOnInsert: {
        canonicalName: STATE_NAME,
        displayName: STATE_NAME,
        normalizedKey: stateKey,
        countryCode: 'IN',
        isActive: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const cityKeys = Array.from(new Set(CITY_ALIASES.map(normalizeLocationName)));
  let city = await LocationCity.findOne({
    stateId: state._id,
    normalizedKey: { $in: cityKeys },
  });
  if (!city) {
    city = await LocationCity.findOne({
      stateId: state._id,
      aliases: { $in: CITY_ALIASES },
    });
  }

  if (city) {
    city.canonicalName = CITY_NAME;
    city.displayName = CITY_NAME;
    city.isActive = true;
    city.aliases = Array.from(new Set([...city.aliases, ...CITY_ALIASES]));
    await city.save();
  } else {
    city = await LocationCity.create({
      stateId: state._id,
      canonicalName: CITY_NAME,
      displayName: CITY_NAME,
      normalizedKey: normalizeLocationName(CITY_NAME),
      aliases: CITY_ALIASES,
      isActive: true,
    });
  }

  await BookNowLocationAvailability.findOneAndUpdate(
    { locationType: 'city', locationId: city._id },
    {
      $set: {
        isEnabled: true,
        isHidden: false,
        updatedBy: 'seed:mahabubnagar',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  logger.info('Mahabubnagar added to Book Now availability', {
    cityId: String(city._id),
    city: city.displayName,
    isEnabled: true,
  });
}

seedMahabubnagarBookNowLocation()
  .then(() => Database.disconnectFromDb())
  .catch(async (error) => {
    logger.error('Failed to add Mahabubnagar to Book Now availability', {
      error: error instanceof Error ? error.message : String(error),
    });
    await Database.disconnectFromDb();
    process.exitCode = 1;
  });
