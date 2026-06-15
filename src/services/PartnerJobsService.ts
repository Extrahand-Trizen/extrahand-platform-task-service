import Task from '../models/Task';
import Assignment from '../models/Assignment';
import AssignmentOffer from '../models/AssignmentOffer';

type JobTab = 'offered' | 'upcoming' | 'ongoing' | 'completed' | 'cancelled';

const ONGOING_STATUSES = new Set([
  'assigned',
  'arrived',
  'start_otp_pending',
  'started',
  'in_progress',
  'proof_submitted',
  'pickup_reached',
  'picked_up',
  'in_transit',
  'drop_reached',
]);

export class PartnerJobsService {
  static async listJobs(partnerUid: string, tab: JobTab) {
    if (tab === 'offered') {
      const offers = await AssignmentOffer.find({
        partnerUid,
        status: 'offered',
        expiresAt: { $gt: new Date() },
      })
        .sort({ createdAt: -1 })
        .lean();

      const taskIds = offers.map((o) => o.taskId);
      const tasks = await Task.find({ _id: { $in: taskIds } }).lean();
      const taskMap = new Map(tasks.map((t) => [String(t._id), t]));

      return offers.map((offer) => ({
        offerId: String(offer._id),
        task: taskMap.get(String(offer.taskId)),
        expiresAt: offer.expiresAt,
        status: offer.status,
      }));
    }

    const assignments = await Assignment.find({
      helperUid: partnerUid,
      status: 'assigned',
    }).lean();
    const taskIds = assignments.map((a) => a.taskId);
    const tasks = await Task.find({
      _id: { $in: taskIds },
      bookingSource: 'book_now',
    }).lean();

    return tasks.filter((task) => {
      const pe = task.partnerExecution?.status;
      if (!pe) return tab === 'upcoming' && task.status === 'assigned';

      switch (tab) {
        case 'upcoming':
          return pe === 'assigned' && task.status === 'assigned';
        case 'ongoing':
          return ONGOING_STATUSES.has(pe);
        case 'completed':
          return pe === 'completed' || task.status === 'completed';
        case 'cancelled':
          return pe === 'cancelled' || task.status === 'cancelled';
        default:
          return false;
      }
    });
  }

  static async getJobDetail(taskId: string, partnerUid: string) {
    const task = await Task.findById(taskId).lean();
    if (!task) return null;

    const offer = await AssignmentOffer.findOne({
      taskId,
      partnerUid,
      status: { $in: ['offered', 'accepted'] },
    }).lean();

    return { task, offer };
  }
}
