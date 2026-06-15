/**
 * Helpers for task-discovery alerts that must only reach helpers/taskers,
 * never the customer who posted the work.
 */

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

export function withHelperAlertData(
  data: Record<string, unknown>,
  posterUid?: string,
): Record<string, unknown> {
  return {
    ...data,
    recipientRole: 'helper',
    ...(posterUid ? { posterUid, actorId: posterUid } : {}),
  };
}
