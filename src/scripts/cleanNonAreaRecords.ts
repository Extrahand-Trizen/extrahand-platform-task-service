import { Database } from '../config/database';
import HourlyHelperLocationAvailability from '../models/HourlyHelperLocationAvailability';
import mongoose from 'mongoose';

async function cleanup() {
  await Database.connectToDb();
  const ids = [
    '6ab4944973f89061654633b0',
    '6ab3d78673f890616546138b',
    '6ab3d81d73f890616546138e',
    '6ab3d78673f890616546138c',
    '6ab3d81d73f890616546138f',
    '6ab3d78773f890616546138d',
    '6ac8b133d5d8636a57e50794',
    '500038',
    '535558',
    'Bobbili',
    'Vizianagaram',
    'Hyderabad',
    'Andhra Pradesh',
  ];
  const objIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));

  await HourlyHelperLocationAvailability.deleteMany({
    $or: [
      { locationId: { $in: ids } },
      { locationId: { $in: objIds } },
      { locationType: { $in: ['city', 'state', 'pincode'] } },
    ],
  });
  console.log('Cleanup finished.');
  await mongoose.disconnect();
}
cleanup();
