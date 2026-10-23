type BookNowOfferState = {
  stage?: string | null;
};

const ACTIVE_OFFER_STAGES = ['preferred', 'area_rule', 'all'] as const;

export function hasBookNowOfferStarted(
  offer: BookNowOfferState | null | undefined,
): boolean {
  return (
    offer?.stage === 'closed' ||
    ACTIVE_OFFER_STAGES.some((stage) => stage === offer?.stage)
  );
}

export function undispatchedBookNowOfferFilter(): Record<string, unknown> {
  return {
    $or: [
      { assignmentOffer: { $exists: false } },
      { assignmentOffer: null },
      { 'assignmentOffer.stage': { $exists: false } },
      { 'assignmentOffer.stage': null },
    ],
  };
}
