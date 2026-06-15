import AssignmentOffer from '../models/AssignmentOffer';
import Task from '../models/Task';

export class DispatchMetricsService {
  static async getOverview() {
    const [offered, accepted, declined, expired, bookNowTasks] = await Promise.all([
      AssignmentOffer.countDocuments({ status: 'offered' }),
      AssignmentOffer.countDocuments({ status: 'accepted' }),
      AssignmentOffer.countDocuments({ status: 'declined' }),
      AssignmentOffer.countDocuments({ status: 'expired' }),
      Task.countDocuments({ bookingSource: 'book_now' }),
    ]);

    const acceptRate = offered + accepted > 0 ? accepted / (accepted + declined + expired) : 0;

    return {
      offers: { offered, accepted, declined, expired },
      bookNowTasks,
      acceptRate: Math.round(acceptRate * 1000) / 1000,
      source: 'book_now',
    };
  }
}
