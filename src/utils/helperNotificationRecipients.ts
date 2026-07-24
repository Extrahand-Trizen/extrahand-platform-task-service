/**
 * Helpers for task-discovery alerts that must only reach helpers/taskers,
 * never the customer who posted the work.
 */

/**
 * Resolve the in-app notification recipientRole for the HELPER/PERFORMER side
 * of a task, based on its bookingSource.
 *
 * Rules:
 *   - book_now tasks  → 'partner'  (helper sees these in the Partner tab,
 *                                   because Book Now is a partner-mode workflow)
 *   - marketplace / normal post works → 'tasker' (helper sees these in the
 *                                   Helper/Tasker tab)
 *
 * The NotificationService query maps:
 *   helper mode  → targetRoles: ['helper', 'tasker']
 *   partner mode → targetRoles: ['partner', 'customer']
 */
export function resolveHelperNotifRole(
  bookingSource?: string | null,
): 'partner' | 'tasker' {
  return bookingSource === 'book_now' ? 'partner' : 'tasker';
}

/**
 * Resolve the in-app notification recipientRole for the CUSTOMER/REQUESTER side.
 * Customers always live in the partner-mode view, so this always returns 'customer'.
 * Kept as a named helper for symmetry and future flexibility.
 */
export function resolveCustomerNotifRole(): 'customer' {
  return 'customer';
}

export function resolvePosterUid(
  uid?: string | null,
  requesterProfile?: { uid?: string | null } | null,
): string | undefined {
  const fromAuth = typeof uid === 'string' ? uid.trim() : '';
  if (fromAuth) return fromAuth;

  const fromProfile =
    typeof requesterProfile?.uid === 'string' ? requesterProfile.uid.trim() : '';
  return fromProfile || undefined;
}

export function excludeTaskPoster(
  recipientUids: string[],
  posterUid?: string | null,
): string[] {
  const poster = typeof posterUid === 'string' ? posterUid.trim() : '';
  const unique = Array.from(
    new Set(
      recipientUids.filter(
        (id): id is string => typeof id === 'string' && id.trim().length > 0,
      ),
    ),
  );

  if (!poster) return unique;
  return unique.filter((id) => id !== poster);
}

/**
 * Attach recipientRole and optional poster context to a notification data object.
 * Pass bookingSource so the role is automatically resolved:
 *   - 'book_now'  → recipientRole: 'partner'
 *   - anything else → recipientRole: 'tasker'
 */
export function withHelperAlertData(
  data: Record<string, unknown>,
  posterUid?: string,
  bookingSource?: string | null,
): Record<string, unknown> {
  return {
    ...data,
    recipientRole: resolveHelperNotifRole(bookingSource),
    ...(posterUid ? { posterUid, actorId: posterUid } : {}),
  };
}
