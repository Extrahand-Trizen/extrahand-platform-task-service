type PartnerOfferTask = {
  bookingSource?: string | null;
  category?: string | null;
  categorySlug?: string | null;
  categoryLabel?: string | null;
  subcategory?: string | null;
  title?: string | null;
  budget?: { type?: string | null } | null;
  hourlyHelper?: boolean;
};

const HOURLY_CATEGORY_PATTERN = /^hourly-(helper|based)$/i;
const HOURLY_LABEL_PATTERN = /^hourly (based|helper)$/i;
const HOURLY_SUBCATEGORY_PATTERN = /(?:^|[\s_-])hourly(?:[\s_-]*(?:help|helper|based))?(?:[\s_-]|$)/i;
const HOURLY_ASSIST_TITLE_PATTERN = /^ExtraHand Assist(?:\s*[·-])?\s*(?:\d+(?:\.\d+)?|[Xx])?\s*(?:hour|hr|minute|min)s?(?:\b|$)/i;

export function isHourlyPartnerOfferTask(task: PartnerOfferTask): boolean {
  const subcategory = String(task.subcategory || '').trim();
  const title = String(task.title || '').trim();
  const category = String(task.category || '').trim().toLowerCase();
  const categorySlug = String(task.categorySlug || '').trim().toLowerCase();
  const isCleaningHourly =
    (category === 'cleaning' || categorySlug.includes('clean') || categorySlug === 'hourly-helper') &&
    (HOURLY_SUBCATEGORY_PATTERN.test(subcategory) || HOURLY_ASSIST_TITLE_PATTERN.test(title));

  return (
    HOURLY_CATEGORY_PATTERN.test(String(task.categorySlug || '').trim()) ||
    HOURLY_CATEGORY_PATTERN.test(String(task.category || '').trim()) ||
    HOURLY_LABEL_PATTERN.test(String(task.categoryLabel || '').trim()) ||
    String(task.budget?.type || '').trim().toLowerCase() === 'hourly' ||
    task.hourlyHelper === true ||
    isCleaningHourly ||
    HOURLY_ASSIST_TITLE_PATTERN.test(title)
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
              { subcategory: /hourly/i },
              { title: /^ExtraHand Assist/i },
            ],
          },
        ],
      },
    ],
  };
}
