import { isHourlyCatalogLineInput } from '../utils/hourlyBookingGuards';
import { BookNowRecurringErrors } from '../recurring-core/config';
import { generateBookNowVisitSlots } from '../recurring-core/engine';
import type { EligibilityChecker, EligibilityInput } from '../recurring-core/interfaces';

const VARIANT_FIELDS = ['bathroomCount', 'fridgeDoorType', 'sofaTierId', 'acVariantId', 'applianceVariantId'];

function isVariantLine(line: Record<string, unknown>): boolean {
  return VARIANT_FIELDS.some((field) => line[field] != null && line[field] !== '');
}

function isConsultationLine(line: Record<string, unknown>): boolean {
  return (
    Boolean(line.consultationMeta) ||
    line.serviceFlowType === 'consultation_project' ||
    line.bookingKind === 'consultation' ||
    line.bookingKind === 'project'
  );
}

export class BookNowEligibilityChecker implements EligibilityChecker {
  assertEligible(input: EligibilityInput): void {
    const fulfillment = String(input.fulfillmentType || 'scheduled').toLowerCase();
    if (fulfillment === 'instant') {
      throw new Error(BookNowRecurringErrors.INSTANT_NOT_ALLOWED);
    }
    if (fulfillment && fulfillment !== 'scheduled') {
      throw new Error(BookNowRecurringErrors.SCHEDULED_ONLY);
    }

    const items = Array.isArray(input.items) ? input.items : [];
    if (items.length === 0) {
      throw new Error(BookNowRecurringErrors.SERVICE_NOT_ALLOWED);
    }

    for (const raw of items) {
      const line = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      if (isHourlyCatalogLineInput(line)) {
        throw new Error(BookNowRecurringErrors.HOURLY_NOT_ALLOWED);
      }
      if (isConsultationLine(line)) {
        throw new Error(BookNowRecurringErrors.CONSULTATION_NOT_ALLOWED);
      }
      if (isVariantLine(line)) {
        throw new Error(BookNowRecurringErrors.SERVICE_NOT_ALLOWED);
      }
      const sku = String(line.skuSlug || line.packageId || '').trim();
      if (!sku) {
        throw new Error(BookNowRecurringErrors.SERVICE_NOT_ALLOWED);
      }
    }

    generateBookNowVisitSlots(input.rule, input.now || new Date());
  }
}
