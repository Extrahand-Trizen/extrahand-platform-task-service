import mongoose from 'mongoose';
import Task from '../models/Task';
import TaskApplication from '../models/TaskApplication';
import TaskQuestion from '../models/TaskQuestion';

const GENUINE_STATUSES = ['assigned', 'started', 'in_progress', 'review', 'completed'];

function getRangeStart(range?: string): Date {
  const now = Date.now();
  if (range === '7d') return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (range === '90d') return new Date(now - 90 * 24 * 60 * 60 * 1000);
  return new Date(now - 30 * 24 * 60 * 60 * 1000);
}

export class AnalyticsService {
  static async getUserAnalytics(
    profileId: string,
    uid: string,
    range?: string
  ): Promise<{
    profileId: string;
    uid: string;
    range: string;
    poster: {
      postedTasks: number;
      totalBidsReceived: number;
      tasksWithAtLeastOneBid: number;
      openTasks: number;
      activeTasks: number;
      completedTasks: number;
      questionsAskedOnMyTasks: number;
    };
    tasker: {
      applicationsPlaced: number;
      acceptedApplications: number;
      pendingApplications: number;
      activeAssignedTasks: number;
      completedAssignedTasks: number;
      questionsAsked: number;
      answersGiven: number;
    };
    generatedAt: string;
  }> {
    const rangeValue = range || '30d';
    const rangeStart = getRangeStart(rangeValue);
    const profileObjectId = new mongoose.Types.ObjectId(profileId);

    const [
      posterTaskStats,
      posterTaskIds,
      taskerApplicationStats,
      taskerAssignedStats,
      questionStats,
    ] = await Promise.all([
      Task.aggregate([
        {
          $match: {
            requesterId: profileObjectId,
            createdAt: { $gte: rangeStart },
          },
        },
        {
          $lookup: {
            from: 'taskapplications',
            localField: '_id',
            foreignField: 'taskId',
            as: 'applications',
          },
        },
        {
          $project: {
            status: 1,
            bidCount: { $size: '$applications' },
          },
        },
        {
          $group: {
            _id: null,
            postedTasks: { $sum: 1 },
            totalBidsReceived: { $sum: '$bidCount' },
            tasksWithAtLeastOneBid: {
              $sum: { $cond: [{ $gt: ['$bidCount', 0] }, 1, 0] },
            },
            openTasks: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
            activeTasks: {
              $sum: {
                $cond: [{ $in: ['$status', ['assigned', 'started', 'in_progress', 'review']] }, 1, 0],
              },
            },
            completedTasks: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
            },
          },
        },
      ]),
      Task.find({
        requesterId: profileObjectId,
        createdAt: { $gte: rangeStart },
      })
        .select('_id')
        .lean(),
      TaskApplication.aggregate([
        {
          $match: {
            applicantId: profileObjectId,
            createdAt: { $gte: rangeStart },
          },
        },
        {
          $group: {
            _id: null,
            applicationsPlaced: { $sum: 1 },
            acceptedApplications: {
              $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] },
            },
            pendingApplications: {
              $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] },
            },
          },
        },
      ]),
      Task.aggregate([
        {
          $match: {
            assigneeId: profileObjectId,
            updatedAt: { $gte: rangeStart },
          },
        },
        {
          $group: {
            _id: null,
            activeAssignedTasks: {
              $sum: {
                $cond: [{ $in: ['$status', ['assigned', 'started', 'in_progress', 'review']] }, 1, 0],
              },
            },
            completedAssignedTasks: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
            },
          },
        },
      ]),
      TaskQuestion.aggregate([
        {
          $match: {
            createdAt: { $gte: rangeStart },
          },
        },
        {
          $group: {
            _id: null,
            questionsAsked: {
              $sum: { $cond: [{ $eq: ['$askedById', profileObjectId] }, 1, 0] },
            },
            answersGiven: {
              $sum: { $cond: [{ $eq: ['$answeredById', profileObjectId] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    const postedTaskIds = posterTaskIds.map((task) => task._id);
    const questionsAskedOnMyTasks =
      postedTaskIds.length === 0
        ? 0
        : await TaskQuestion.countDocuments({
            taskId: { $in: postedTaskIds },
            createdAt: { $gte: rangeStart },
          });

    const poster = posterTaskStats?.[0] || {};
    const taskerApps = taskerApplicationStats?.[0] || {};
    const taskerAssigned = taskerAssignedStats?.[0] || {};
    const questionAgg = questionStats?.[0] || {};

    return {
      profileId,
      uid,
      range: rangeValue,
      poster: {
        postedTasks: Number(poster.postedTasks || 0),
        totalBidsReceived: Number(poster.totalBidsReceived || 0),
        tasksWithAtLeastOneBid: Number(poster.tasksWithAtLeastOneBid || 0),
        openTasks: Number(poster.openTasks || 0),
        activeTasks: Number(poster.activeTasks || 0),
        completedTasks: Number(poster.completedTasks || 0),
        questionsAskedOnMyTasks: Number(questionsAskedOnMyTasks || 0),
      },
      tasker: {
        applicationsPlaced: Number(taskerApps.applicationsPlaced || 0),
        acceptedApplications: Number(taskerApps.acceptedApplications || 0),
        pendingApplications: Number(taskerApps.pendingApplications || 0),
        activeAssignedTasks: Number(taskerAssigned.activeAssignedTasks || 0),
        completedAssignedTasks: Number(taskerAssigned.completedAssignedTasks || 0),
        questionsAsked: Number(questionAgg.questionsAsked || 0),
        answersGiven: Number(questionAgg.answersGiven || 0),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  static async getTaskCategoryBreakdown(range?: string): Promise<{
    range: string;
    categories: Array<{
      category: string;
      count: number;
      subcategories: Array<{ subcategory: string; count: number }>;
    }>;
    generatedAt: string;
  }> {
    const rangeValue = range || '30d';
    const rangeStart = getRangeStart(rangeValue);

    const [categoriesRaw, subcategoriesRaw] = await Promise.all([
      Task.aggregate([
        { $match: { createdAt: { $gte: rangeStart } } },
        {
          $project: {
            category: {
              $ifNull: [
                '$categorySlug',
                { $ifNull: ['$categoryLabel', '$category'] },
              ],
            },
          },
        },
        {
          $group: {
            _id: { $ifNull: ['$category', 'other'] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]),
      Task.aggregate([
        { $match: { createdAt: { $gte: rangeStart } } },
        {
          $project: {
            category: {
              $ifNull: [
                '$categorySlug',
                { $ifNull: ['$categoryLabel', '$category'] },
              ],
            },
            subcategory: { $ifNull: ['$subcategory', 'unspecified'] },
          },
        },
        {
          $group: {
            _id: {
              category: { $ifNull: ['$category', 'other'] },
              subcategory: { $ifNull: ['$subcategory', 'unspecified'] },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]),
    ]);

    const subcategoryMap = new Map<string, Array<{ subcategory: string; count: number }>>();
    for (const row of subcategoriesRaw) {
      const category = row?._id?.category || 'other';
      const subcategory = row?._id?.subcategory || 'unspecified';
      const list = subcategoryMap.get(category) || [];
      list.push({ subcategory, count: Number(row?.count || 0) });
      subcategoryMap.set(category, list);
    }

    const categories = categoriesRaw.map((row) => {
      const category = row?._id || 'other';
      return {
        category,
        count: Number(row?.count || 0),
        subcategories: (subcategoryMap.get(category) || []).slice(0, 10),
      };
    });

    return {
      range: rangeValue,
      categories,
      generatedAt: new Date().toISOString(),
    };
  }

  static async getUserTaskStats(profileId: string, uid: string): Promise<{
    totalTasks: number;
    completedTasks: number;
    postedTasks: number;
  }> {
    const profileObjectId = new mongoose.Types.ObjectId(profileId);

    const [assigneeStats, posterStats] = await Promise.all([
      Task.aggregate([
        { $match: { assigneeId: profileObjectId } },
        {
          $group: {
            _id: null,
            totalTasks: { $sum: 1 },
            completedTasks: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
            },
          },
        },
      ]),
      Task.aggregate([
        { $match: { posterUid: uid } },
        { $count: 'postedTasks' },
      ]),
    ]);

    return {
      totalTasks: Number(assigneeStats?.[0]?.totalTasks || 0),
      completedTasks: Number(assigneeStats?.[0]?.completedTasks || 0),
      postedTasks: Number(posterStats?.[0]?.postedTasks || 0),
    };
  }

  static async getPosterAnalytics(requesterId: string, range?: string): Promise<{
    requesterId: string;
    range: string;
    metrics: {
      postedTasks: number;
      totalBids: number;
      genuineTaskCount: number;
      categories: Array<{ category: string; count: number }>;
    };
    generatedAt: string;
  }> {
    const rangeValue = range || '30d';
    const rangeStart = getRangeStart(rangeValue);
    const requesterObjectId = new mongoose.Types.ObjectId(requesterId);

    const [aggregate] = await Task.aggregate([
      {
        $match: {
          requesterId: requesterObjectId,
          createdAt: { $gte: rangeStart },
        },
      },
      {
        $lookup: {
          from: 'taskapplications',
          localField: '_id',
          foreignField: 'taskId',
          as: 'applications',
        },
      },
      {
        $project: {
          category: { $ifNull: ['$categorySlug', '$category'] },
          status: 1,
          bidCount: { $size: '$applications' },
        },
      },
      {
        $facet: {
          metrics: [
            {
              $group: {
                _id: null,
                postedTasks: { $sum: 1 },
                totalBids: { $sum: '$bidCount' },
                genuineTaskCount: {
                  $sum: {
                    $cond: [{ $in: ['$status', GENUINE_STATUSES] }, 1, 0],
                  },
                },
              },
            },
          ],
          categories: [
            {
              $group: {
                _id: { $ifNull: ['$category', 'other'] },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $project: { _id: 0, category: '$_id', count: 1 } },
          ],
        },
      },
    ]);

    const metrics = aggregate?.metrics?.[0] || {
      postedTasks: 0,
      totalBids: 0,
      genuineTaskCount: 0,
    };
    const categories = aggregate?.categories || [];

    return {
      requesterId,
      range: rangeValue,
      metrics: {
        postedTasks: metrics.postedTasks || 0,
        totalBids: metrics.totalBids || 0,
        genuineTaskCount: metrics.genuineTaskCount || 0,
        categories,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  static async getPosterSummary(range?: string): Promise<{
    range: string;
    posters: Array<{
      requesterId: string;
      taskCount: number;
      bidCount: number;
      genuineTaskCount: number;
    }>;
    generatedAt: string;
  }> {
    const rangeValue = range || '30d';
    const rangeStart = getRangeStart(rangeValue);

    const posters = await Task.aggregate([
      {
        $match: {
          createdAt: { $gte: rangeStart },
        },
      },
      {
        $lookup: {
          from: 'taskapplications',
          localField: '_id',
          foreignField: 'taskId',
          as: 'applications',
        },
      },
      {
        $project: {
          requesterId: 1,
          status: 1,
          bidCount: { $size: '$applications' },
        },
      },
      {
        $group: {
          _id: '$requesterId',
          taskCount: { $sum: 1 },
          bidCount: { $sum: '$bidCount' },
          genuineTaskCount: {
            $sum: {
              $cond: [{ $in: ['$status', GENUINE_STATUSES] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          requesterId: { $toString: '$_id' },
          taskCount: 1,
          bidCount: 1,
          genuineTaskCount: 1,
        },
      },
    ]);

    return {
      range: rangeValue,
      posters,
      generatedAt: new Date().toISOString(),
    };
  }

  static async getTaskCategoryPerformance(range?: string): Promise<{
    range: string;
    totals: {
      posted: number;
      open: number;
      active: number;
      completed: number;
      cancelled: number;
      completionRate: number;
      cancellationRate: number;
    };
    categories: Array<{
      category: string;
      posted: number;
      open: number;
      active: number;
      completed: number;
      cancelled: number;
      completionRate: number;
      cancellationRate: number;
      fulfillmentRate: number;
    }>;
    generatedAt: string;
  }> {
    const rangeValue = range || '30d';
    const rangeStart = getRangeStart(rangeValue);
    const activeStatuses = ['assigned', 'started', 'in_progress', 'review'];

    const categoryRows = await Task.aggregate([
      { $match: { createdAt: { $gte: rangeStart } } },
      {
        $project: {
          category: {
            $ifNull: ['$categorySlug', { $ifNull: ['$categoryLabel', { $ifNull: ['$category', 'other'] }] }],
          },
          status: 1,
        },
      },
      {
        $group: {
          _id: '$category',
          posted: { $sum: 1 },
          open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
          active: { $sum: { $cond: [{ $in: ['$status', activeStatuses] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        },
      },
      { $sort: { posted: -1 } },
    ]);

    const categories = categoryRows.map((row) => {
      const posted = Number(row?.posted || 0);
      const open = Number(row?.open || 0);
      const active = Number(row?.active || 0);
      const completed = Number(row?.completed || 0);
      const cancelled = Number(row?.cancelled || 0);

      return {
        category: String(row?._id || 'other'),
        posted,
        open,
        active,
        completed,
        cancelled,
        completionRate: posted > 0 ? Number(((completed / posted) * 100).toFixed(2)) : 0,
        cancellationRate: posted > 0 ? Number(((cancelled / posted) * 100).toFixed(2)) : 0,
        fulfillmentRate: posted > 0 ? Number((((active + completed) / posted) * 100).toFixed(2)) : 0,
      };
    });

    const totals = categories.reduce(
      (acc, item) => {
        acc.posted += item.posted;
        acc.open += item.open;
        acc.active += item.active;
        acc.completed += item.completed;
        acc.cancelled += item.cancelled;
        return acc;
      },
      { posted: 0, open: 0, active: 0, completed: 0, cancelled: 0 }
    );

    return {
      range: rangeValue,
      totals: {
        ...totals,
        completionRate:
          totals.posted > 0 ? Number(((totals.completed / totals.posted) * 100).toFixed(2)) : 0,
        cancellationRate:
          totals.posted > 0 ? Number(((totals.cancelled / totals.posted) * 100).toFixed(2)) : 0,
      },
      categories,
      generatedAt: new Date().toISOString(),
    };
  }

  static async getTaskCancellationAnalytics(range?: string): Promise<{
    range: string;
    totals: {
      totalTasks: number;
      cancelledTasks: number;
      cancellationRate: number;
      cancelledBeforeAssignment: number;
      cancelledAfterAssignment: number;
    };
    trend: Array<{
      date: string;
      totalTasks: number;
      cancelledTasks: number;
      cancellationRate: number;
    }>;
    categories: Array<{
      category: string;
      totalTasks: number;
      cancelledTasks: number;
      cancellationRate: number;
    }>;
    generatedAt: string;
  }> {
    const rangeValue = range || '30d';
    const rangeStart = getRangeStart(rangeValue);

    const [totalsRow, trendRows, categoryRows] = await Promise.all([
      Task.aggregate([
        { $match: { createdAt: { $gte: rangeStart } } },
        {
          $group: {
            _id: null,
            totalTasks: { $sum: 1 },
            cancelledTasks: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
            cancelledBeforeAssignment: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$status', 'cancelled'] }, { $eq: [{ $ifNull: ['$assigneeId', null] }, null] }] },
                  1,
                  0,
                ],
              },
            },
            cancelledAfterAssignment: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$status', 'cancelled'] }, { $ne: [{ $ifNull: ['$assigneeId', null] }, null] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      Task.aggregate([
        { $match: { createdAt: { $gte: rangeStart } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            totalTasks: { $sum: 1 },
            cancelledTasks: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Task.aggregate([
        { $match: { createdAt: { $gte: rangeStart } } },
        {
          $project: {
            category: {
              $ifNull: ['$categorySlug', { $ifNull: ['$categoryLabel', { $ifNull: ['$category', 'other'] }] }],
            },
            status: 1,
          },
        },
        {
          $group: {
            _id: '$category',
            totalTasks: { $sum: 1 },
            cancelledTasks: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          },
        },
        { $sort: { cancelledTasks: -1 } },
      ]),
    ]);

    const totalsBase = totalsRow?.[0] || {};
    const totalTasks = Number(totalsBase.totalTasks || 0);
    const cancelledTasks = Number(totalsBase.cancelledTasks || 0);

    const trend = trendRows.map((row) => {
      const dayTotal = Number(row?.totalTasks || 0);
      const dayCancelled = Number(row?.cancelledTasks || 0);
      return {
        date: String(row?._id),
        totalTasks: dayTotal,
        cancelledTasks: dayCancelled,
        cancellationRate: dayTotal > 0 ? Number(((dayCancelled / dayTotal) * 100).toFixed(2)) : 0,
      };
    });

    const categories = categoryRows.map((row) => {
      const categoryTotal = Number(row?.totalTasks || 0);
      const categoryCancelled = Number(row?.cancelledTasks || 0);
      return {
        category: String(row?._id || 'other'),
        totalTasks: categoryTotal,
        cancelledTasks: categoryCancelled,
        cancellationRate:
          categoryTotal > 0 ? Number(((categoryCancelled / categoryTotal) * 100).toFixed(2)) : 0,
      };
    });

    return {
      range: rangeValue,
      totals: {
        totalTasks,
        cancelledTasks,
        cancellationRate: totalTasks > 0 ? Number(((cancelledTasks / totalTasks) * 100).toFixed(2)) : 0,
        cancelledBeforeAssignment: Number(totalsBase.cancelledBeforeAssignment || 0),
        cancelledAfterAssignment: Number(totalsBase.cancelledAfterAssignment || 0),
      },
      trend,
      categories,
      generatedAt: new Date().toISOString(),
    };
  }
}

