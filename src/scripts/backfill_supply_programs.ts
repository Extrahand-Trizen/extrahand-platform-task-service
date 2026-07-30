import dns from 'node:dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);

import mongoose from 'mongoose';
import { config } from '../config/env';

async function main() {
  const uri = config.MONGODB_URI;
  if (!uri) {
    console.error('No MONGODB_URI found');
    process.exit(1);
  }
  try {
    await mongoose.connect(uri, { dbName: 'extrahand' });
    const Profile = mongoose.connection.collection('profiles');
    
    // Find all profiles where partnerProfile.status is approved
    const approvedPartners = await Profile.find({
      'partnerProfile.status': 'approved'
    }).toArray();

    console.log(`Found ${approvedPartners.length} approved partners.`);

    let updatedCount = 0;
    for (const partner of approvedPartners) {
      const supplyPrograms = partner.supplyPrograms || [];
      const needsMarketplace = !supplyPrograms.includes('marketplace');
      const needsBookNow = !supplyPrograms.includes('book_now');
      
      if (needsMarketplace || needsBookNow) {
        const newSupplyPrograms = [...supplyPrograms];
        if (needsMarketplace) newSupplyPrograms.push('marketplace');
        if (needsBookNow) newSupplyPrograms.push('book_now');
        
        await Profile.updateOne(
          { _id: partner._id },
          { $set: { supplyPrograms: newSupplyPrograms } }
        );
        console.log(`Updated partner ${partner.name} (uid=${partner.uid}) to have supplyPrograms:`, newSupplyPrograms);
        updatedCount++;
      }
    }

    console.log(`Backfill complete. Updated ${updatedCount} profiles.`);
  } catch (error) {
    console.error('Error during backfill:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main();
