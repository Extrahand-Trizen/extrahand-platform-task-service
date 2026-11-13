type PartnerOfferTask = {
  bookingSource?: string | null;
  category?: string | null;
  categorySlug?: string | null;
  categoryLabel?: string | null;
  budget?: { type?: string | null } | null;
  hourlyHelper?: boolean;
};

const HOURLY_CATEGORY_PATTERN = /^hourly-(helper|based)$/i;
const HOURLY_LABEL_PATTERN = /^hourly (based|helper)$/i;

export function isHourlyPartnerOfferTask(task: PartnerOfferTask): boolean {
  return (
    HOURLY_CATEGORY_PATTERN.test(String(task.categorySlug || '').trim()) ||
    HOURLY_CATEGORY_PATTERN.test(String(task.category || '').trim()) ||
    HOURLY_LABEL_PATTERN.test(String(task.categoryLabel || '').trim()) ||
    String(task.budget?.type || '').trim().toLowerCase() === 'hourly' ||
    task.hourlyHelper === true
  );
}

export function isPartnerOfferTask(task: PartnerOfferTask): boolean {
  return task.bookingSource === 'book_now' || isHourlyPartnerOfferTask(task);
}

export function partnerOfferTaskMongoFilter(): Record<string, unknown> {
  return {
    $or: [
      { bookingSource: 'book_now' },
      {
        $and: [
          { bookingSource: { $ne: 'book_now' } },
          {
            $or: [
              { categorySlug: /^hourly-(helper|based)$/i },
              { category: /^hourly-(helper|based)$/i },
              { categoryLabel: /^hourly (based|helper)$/i },
              { 'budget.type': 'hourly' },
              { hourlyHelper: true },
            ],
          },
        ],
      },
    ],
  };
}
