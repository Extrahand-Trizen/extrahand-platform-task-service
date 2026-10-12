import type { HelperAssignmentPolicy, HelperAssignmentContext } from '../recurring-core/interfaces';

/** Preference only — auto-assign still falls back to normal matching. */
export class BookNowHelperAssignmentPolicy implements HelperAssignmentPolicy {
  async resolvePreferredPartnerId(context: HelperAssignmentContext): Promise<string | undefined> {
    const preferred = String(context.preferredPartnerId || '').trim();
    return preferred || undefined;
  }
}
