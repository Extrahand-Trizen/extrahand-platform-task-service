import { MAX_SUBCATEGORIES_PER_CATEGORY } from "./constants";
import { calcRatePercent, toNumber } from "./rates";

type CategoryCountRow = { _id?: string; count?: number };
type SubcategoryCountRow = {
  _id?: { category?: string; subcategory?: string };
  count?: number;
};

export function mapCategoryBreakdown(
  categoriesRaw: CategoryCountRow[],
  subcategoriesRaw: SubcategoryCountRow[]
): Array<{
  category: string;
  count: number;
  subcategories: Array<{ subcategory: string; count: number }>;
}> {
  const subcategoryMap = new Map<
    string,
    Array<{ subcategory: string; count: number }>
  >();

  for (const row of subcategoriesRaw) {
    const category = row?._id?.category || "other";
    const subcategory = row?._id?.subcategory || "unspecified";
    const list = subcategoryMap.get(category) || [];
    list.push({ subcategory, count: toNumber(row?.count) });
    subcategoryMap.set(category, list);
  }

  return categoriesRaw.map((row) => {
    const category = row?._id || "other";
    return {
      category,
      count: toNumber(row?.count),
      subcategories: (subcategoryMap.get(category) || []).slice(
        0,
        MAX_SUBCATEGORIES_PER_CATEGORY
      ),
    };
  });
}

type CategoryPerformanceRow = {
  _id?: string;
  posted?: number;
  open?: number;
  active?: number;
  completed?: number;
  cancelled?: number;
};

export function mapCategoryPerformanceRows(rows: CategoryPerformanceRow[]): {
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
  totals: {
    posted: number;
    open: number;
    active: number;
    completed: number;
    cancelled: number;
    completionRate: number;
    cancellationRate: number;
  };
} {
  const categories = rows.map((row) => {
    const posted = toNumber(row?.posted);
    const active = toNumber(row?.active);
    const completed = toNumber(row?.completed);
    const cancelled = toNumber(row?.cancelled);

    return {
      category: String(row?._id || "other"),
      posted,
      open: toNumber(row?.open),
      active,
      completed,
      cancelled,
      completionRate: calcRatePercent(completed, posted),
      cancellationRate: calcRatePercent(cancelled, posted),
      fulfillmentRate: calcRatePercent(active + completed, posted),
    };
  });

  const totals = categories.reduce(
    (acc, category) => {
      acc.posted += category.posted;
      acc.open += category.open;
      acc.active += category.active;
      acc.completed += category.completed;
      acc.cancelled += category.cancelled;
      return acc;
    },
    {
      posted: 0,
      open: 0,
      active: 0,
      completed: 0,
      cancelled: 0,
      completionRate: 0,
      cancellationRate: 0,
    }
  );

  totals.completionRate = calcRatePercent(totals.completed, totals.posted);
  totals.cancellationRate = calcRatePercent(totals.cancelled, totals.posted);

  return { categories, totals };
}

type CancellationSummaryRow = {
  totalTasks?: number;
  cancelledTasks?: number;
  cancelledBeforeAssignment?: number;
  cancelledAfterAssignment?: number;
};

type CancellationCategoryRow = {
  _id?: string;
  totalTasks?: number;
  cancelledTasks?: number;
};

type CancellationTrendRow = {
  _id?: string;
  totalTasks?: number;
  cancelledTasks?: number;
};

export function mapCancellationAnalytics(input: {
  summaryRow: CancellationSummaryRow[];
  categoryRows: CancellationCategoryRow[];
  trendRows: CancellationTrendRow[];
}): {
  totals: {
    totalTasks: number;
    cancelledTasks: number;
    cancellationRate: number;
    cancelledBeforeAssignment: number;
    cancelledAfterAssignment: number;
  };
  categories: Array<{
    category: string;
    totalTasks: number;
    cancelledTasks: number;
    cancellationRate: number;
  }>;
  trend: Array<{
    date: string;
    totalTasks: number;
    cancelledTasks: number;
    cancellationRate: number;
  }>;
} {
  const summary = input.summaryRow?.[0] || {};
  const totalTasks = toNumber(summary.totalTasks);
  const cancelledTasks = toNumber(summary.cancelledTasks);

  const categories = input.categoryRows.map((row) => {
    const total = toNumber(row?.totalTasks);
    const cancelled = toNumber(row?.cancelledTasks);
    return {
      category: String(row?._id || "other"),
      totalTasks: total,
      cancelledTasks: cancelled,
      cancellationRate: calcRatePercent(cancelled, total),
    };
  });

  const trend = input.trendRows.map((row) => {
    const total = toNumber(row?.totalTasks);
    const cancelled = toNumber(row?.cancelledTasks);
    return {
      date: String(row?._id),
      totalTasks: total,
      cancelledTasks: cancelled,
      cancellationRate: calcRatePercent(cancelled, total),
    };
  });

  return {
    totals: {
      totalTasks,
      cancelledTasks,
      cancellationRate: calcRatePercent(cancelledTasks, totalTasks),
      cancelledBeforeAssignment: toNumber(summary.cancelledBeforeAssignment),
      cancelledAfterAssignment: toNumber(summary.cancelledAfterAssignment),
    },
    categories,
    trend,
  };
}

export function mapUserTaskStats(
  assigneeStats: Array<{ totalTasks?: number; completedTasks?: number }>,
  posterStats: Array<{ postedTasks?: number }>
): {
  totalTasks: number;
  completedTasks: number;
  postedTasks: number;
} {
  return {
    totalTasks: toNumber(assigneeStats?.[0]?.totalTasks),
    completedTasks: toNumber(assigneeStats?.[0]?.completedTasks),
    postedTasks: toNumber(posterStats?.[0]?.postedTasks),
  };
}

export function mapPosterAnalyticsMetrics(
  aggregate: {
    metrics?: Array<{
      postedTasks?: number;
      totalBids?: number;
      genuineTaskCount?: number;
    }>;
    categories?: Array<{ category: string; count: number }>;
  } | undefined
): {
  postedTasks: number;
  totalBids: number;
  genuineTaskCount: number;
  categories: Array<{ category: string; count: number }>;
} {
  const metrics = aggregate?.metrics?.[0] || {};
  return {
    postedTasks: toNumber(metrics.postedTasks),
    totalBids: toNumber(metrics.totalBids),
    genuineTaskCount: toNumber(metrics.genuineTaskCount),
    categories: aggregate?.categories || [],
  };
}
