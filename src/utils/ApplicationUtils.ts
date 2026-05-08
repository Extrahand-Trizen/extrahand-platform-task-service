/**
 * ApplicationUtils
 *
 * Pure, stateless utility functions for TaskApplication data transformation.
 * No DB calls. No external service calls. No side effects.
 */
export const ApplicationUtils = {
  /**
   * Build an applicant profile snapshot from gateway-enriched request body fields.
   * Returns undefined if the minimum required field (applicantName) is absent —
   * callers should fall back to ProfileUtils.buildSnapshot(rawProfile) in that case.
   */
  buildSnapshotFromGatewayPayload(data: {
    applicantName?: string;
    applicantPhotoURL?: string;
    applicantRating?: number;
    applicantTotalReviews?: number;
  }): object | undefined {
    if (!data.applicantName) return undefined;
    return {
      name: data.applicantName,
      photoURL: data.applicantPhotoURL,
      rating: data.applicantRating,
      totalReviews: data.applicantTotalReviews,
    };
  },

  /**
   * Strip proposedBudget from applications that don't belong to the viewer
   * and the viewer is not the task owner.
   *
   * Business rule: non-owners can see their own budget but not other bidders' budgets.
   * Moved here from ApplicationController to keep the controller thin.
   */
  filterBudgetForNonOwner(
    applications: any[],
    viewerProfileId: string | undefined,
    isOwner: boolean
  ): any[] {
    if (isOwner) return applications;
    return applications.map((app) => {
      const isOwnApp =
        viewerProfileId && String(app.applicantId) === viewerProfileId;
      if (isOwnApp) return app;
      const { proposedBudget: _stripped, ...rest } = app;
      return rest;
    });
  },

  /**
   * Returns the effective (current active) quote amount for an application.
   * In the global revision model, proposedBudget.amount is always the current quote.
   * The old negotiation.currentAmount fallback is preserved for backward compatibility
   * during the transition period.
   */
  getEffectiveAmount(application: {
    proposedBudget?: { amount?: number };
    negotiation?: { currentAmount?: number };
  }): number {
    return (
      application.proposedBudget?.amount ??
      application.negotiation?.currentAmount ??
      0
    );
  },
} as const;
