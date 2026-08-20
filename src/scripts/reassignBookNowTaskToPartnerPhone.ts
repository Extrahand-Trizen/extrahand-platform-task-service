/**
 * Reassign a Book Now / painting consultation task to a partner by phone.
 *
 * Usage:
 *   npx ts-node src/scripts/reassignBookNowTaskToPartnerPhone.ts --phone=8888888888
 *   npx ts-node src/scripts/reassignBookNowTaskToPartnerPhone.ts --taskId=<mongoId> --phone=8888888888
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Task from '../models/Task';
import { Database } from '../config/database';
import { BookNowAutoAssignService } from '../services/BookNowAutoAssignService';
import { resolvePartnerUidByPhone } from '../utils/resolvePartnerUidByPhone';

dotenv.config();

function argValue(flag: string): string {
  const hit = process.argv.find((entry) => entry.startsWith(`${flag}=`));
  return hit ? hit.split('=').slice(1).join('=').trim() : '';
}

async function main(): Promise<void> {
  const phone = argValue('--phone') || '8888888888';
  const taskId = argValue('--taskId');

  await Database.connectToDb();

  const partnerUid = await resolvePartnerUidByPhone(phone);
  if (!partnerUid) {
    throw new Error(`No approved partner found for phone ${phone}`);
  }

  let task = null;
  if (taskId) {
    task = await Task.findById(taskId);
  } else {
    task = await Task.findOne({
      bookingKind: 'consultation',
      $or: [
        { serviceType: 'painting' },
        { serviceFlowType: 'consultation_project' },
        { categorySlug: /^painting/i },
        { subcategory: /^painting-consultation-/i },
      ],
    }).sort({ createdAt: -1 });
  }

  if (!task) {
    throw new Error('Painting consultation task not found');
  }

  const result = await BookNowAutoAssignService.forceAssignPartner(task, partnerUid);
  if (!result.assigned || !result.partner) {
    throw new Error(result.reason || 'Reassignment failed');
  }

  console.log(
    JSON.stringify(
      {
        taskId: String(task._id),
        assignedTo: result.partner.name,
        partnerUid: result.partner.uid,
        partnerProfileId: result.partner.profileId,
        phone,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
