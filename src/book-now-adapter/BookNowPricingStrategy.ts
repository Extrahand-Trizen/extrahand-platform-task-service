import { BookingService, type BookingLineInput } from '../services/BookingService';
import { PaymentClient } from '../services/PaymentClient';
import { CatalogService } from '../services/CatalogService';
import { BadRequestError } from '../errors/AppError';
import { BookNowRecurringErrors } from '../recurring-core/config';
import type { PricingStrategy, PricingContext } from '../recurring-core/interfaces';
import type { RecurringPriceSnapshot } from '../recurring-core/types';

export class BookNowPricingStrategy implements PricingStrategy {
  async quoteVisit(context: PricingContext): Promise<RecurringPriceSnapshot> {
    const items = (context.items || []) as BookingLineInput[];
    const address = context.address as Parameters<typeof BookingService.quoteBookNowLinePrices>[1];
    if (!items.length || !address) {
      throw new BadRequestError(BookNowRecurringErrors.SERVICE_NOT_ALLOWED);
    }

    const matched = await CatalogService.matchBookNowLineSkus(items);
    if (matched.some((sku) => !sku)) {
      throw new BadRequestError(BookNowRecurringErrors.SERVICE_NOT_ALLOWED);
    }

    const { items: quotes } = await BookingService.quoteBookNowLinePrices(items, address);
    const subtotal = quotes.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0);
    if (!(subtotal > 0)) {
      throw new BadRequestError(BookNowRecurringErrors.SERVICE_NOT_ALLOWED);
    }

    const pricingResult = await PaymentClient.calculateBookNowOrderTotals(
      items.map((line, index) => ({
        categorySlug: String(line.categorySlug || ''),
        lineTotal: quotes[index]?.lineTotal ?? 0,
      })),
    );
    if (!pricingResult.success || !pricingResult.totals) {
      throw new BadRequestError(pricingResult.error || 'Failed to calculate Book Now payment totals');
    }

    const totals = pricingResult.totals;
    return {
      basePrice: totals.subtotal,
      platformFee: totals.platformFee,
      gst: totals.gst,
      totalPrice: totals.total,
      currency: 'INR',
      pricedAt: new Date().toISOString(),
    };
  }
}
