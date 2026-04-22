import mongoose from 'mongoose';
import Task from '../models/Task';

const GENUINE_STATUSES = ['assigned', 'started', 'in_progress', 'review', 'completed'];

function getRangeStart(range?: string): Date {
  const now = Date.now();
  if (range === '7d') return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (range === '90d') return new Date(now - 90 * 24 * 60 * 60 * 1000);
  return new Date(now - 30 * 24 * 60 * 60 * 1000);
}

export class AnalyticsService {
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
}

