import mongoose from "mongoose";
import Task from "../models/Task";
import TaskApplication from "../models/TaskApplication";
import { resolveAnalyticsRange } from "../analytics/dateRange";
import {
  mapCancellationAnalytics,
  mapCategoryBreakdown,
  mapCategoryPerformanceRows,
  mapPosterAnalyticsMetrics,
  mapUserTaskStats,
} from "../analytics/mappers";
import { buildTaskCategoryPerformancePipeline } from "../analytics/pipelines/categoryPerformancePipeline";
import {
  buildCategoryCountPipeline,
  buildSubcategoryCountPipeline,
} from "../analytics/pipelines/categoryBreakdownPipelines";
import {
  buildCancellationByCategoryPipeline,
  buildCancellationSummaryPipeline,
  buildCancellationTrendPipeline,
} from "../analytics/pipelines/cancellationPipelines";
import {
  buildPosterAnalyticsPipeline,
  buildPosterSummaryPipeline,
} from "../analytics/pipelines/posterPipelines";
import {
  buildUserApplicationStatsPipeline,
  buildUserPosterStatsPipeline,
  buildUserTaskerStatsPipeline,
} from "../analytics/pipelines/userAnalyticsPipelines";
import {
  buildAssigneeStatsPipeline,
  buildPosterPostedCountPipeline,
} from "../analytics/pipelines/userTaskStatsPipelines";

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
    const { rangeValue, rangeStart } = resolveAnalyticsRange(range);

    const [categoriesRaw, subcategoriesRaw] = await Promise.all([
      Task.aggregate(buildCategoryCountPipeline(rangeStart)),
      Task.aggregate(buildSubcategoryCountPipeline(rangeStart)),
    ]);

    return {
      range: rangeValue,
      categories: mapCategoryBreakdown(categoriesRaw, subcategoriesRaw),
      generatedAt: new Date().toISOString(),
    };
  }

  static async getUserTaskStats(
    profileId: string,
    _uid: string
  ): Promise<{
    totalTasks: number;
    completedTasks: number;
    postedTasks: number;
  }> {
    const profileObjectId = new mongoose.Types.ObjectId(profileId);

    const [assigneeStats, posterStats] = await Promise.all([
      Task.aggregate(buildAssigneeStatsPipeline(profileObjectId)),
      Task.aggregate(buildPosterPostedCountPipeline(profileObjectId)),
    ]);

    return mapUserTaskStats(assigneeStats, posterStats);
  }

  static async getPosterAnalytics(
    requesterId: string,
    range?: string
  ): Promise<{
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
    const { rangeValue, rangeStart } = resolveAnalyticsRange(range);
    const requesterObjectId = new mongoose.Types.ObjectId(requesterId);

    const [aggregate] = await Task.aggregate(
      buildPosterAnalyticsPipeline(requesterObjectId, rangeStart)
    );

    const metrics = mapPosterAnalyticsMetrics(aggregate);

    return {
      requesterId,
      range: rangeValue,
      metrics,
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
    const { rangeValue, rangeStart } = resolveAnalyticsRange(range);

    const posters = await Task.aggregate(
      buildPosterSummaryPipeline(rangeStart)
    );

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
    const { rangeValue, rangeStart } = resolveAnalyticsRange(range);

    const rows = await Task.aggregate(
      buildTaskCategoryPerformancePipeline(rangeStart)
    );
    const { categories, totals } = mapCategoryPerformanceRows(rows);

    return {
      range: rangeValue,
      totals,
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
    const { rangeValue, rangeStart } = resolveAnalyticsRange(range);

    const [summaryRow, categoryRows, trendRows] = await Promise.all([
      Task.aggregate(buildCancellationSummaryPipeline(rangeStart)),
      Task.aggregate(buildCancellationByCategoryPipeline(rangeStart)),
      Task.aggregate(buildCancellationTrendPipeline(rangeStart)),
    ]);

    const { totals, categories, trend } = mapCancellationAnalytics({
      summaryRow,
      categoryRows,
      trendRows,
    });

    return {
      range: rangeValue,
      totals,
      trend,
      categories,
      generatedAt: new Date().toISOString(),
    };
  }

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
    const { rangeValue, rangeStart } = resolveAnalyticsRange(range);
    const profileObjectId = new mongoose.Types.ObjectId(profileId);

    const [posterAgg, taskerAgg, applicationAgg] = await Promise.all([
      Task.aggregate(buildUserPosterStatsPipeline(profileObjectId, rangeStart)),
      Task.aggregate(buildUserTaskerStatsPipeline(profileObjectId, rangeStart)),
      TaskApplication.aggregate(
        buildUserApplicationStatsPipeline(profileObjectId, rangeStart)
      ),
    ]);

    const poster = posterAgg?.[0] || {};
    const tasker = taskerAgg?.[0] || {};
    const app = applicationAgg?.[0] || {};

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
        questionsAskedOnMyTasks: 0,
      },
      tasker: {
        applicationsPlaced: Number(app.applicationsPlaced || 0),
        acceptedApplications: Number(app.acceptedApplications || 0),
        pendingApplications: Number(app.pendingApplications || 0),
        activeAssignedTasks: Number(tasker.activeAssignedTasks || 0),
        completedAssignedTasks: Number(tasker.completedAssignedTasks || 0),
        questionsAsked: 0,
        answersGiven: 0,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}
