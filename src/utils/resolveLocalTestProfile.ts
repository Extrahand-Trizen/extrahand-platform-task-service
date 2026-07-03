import logger from '../config/logger';
import { AuthenticatedRequest } from '../types';
import { ProfileUtils } from './ProfileUtils';
import { isTaskServiceLocalTestMode } from './localTestGuard';

/**
 * When LOCAL_TEST is enabled and the gateway did not send X-Profile-Id (dummy / simulator JWT flows),
 * resolve Mongo profile _id from `profiles.uid` so completion routes behave like production.
 *
 * Never runs unless LOCAL_TEST is "true" or "1" — production remains unchanged.
 */
export async function attachProfileIdForLocalTestIfNeeded(
  req: AuthenticatedRequest
): Promise<void> {
  if (!isTaskServiceLocalTestMode()) return;
  if (req.user?.profileId) return;
  const uid = req.user?.uid;
  if (!uid || !String(uid).trim()) return;

  const resolved = await ProfileUtils.getProfileIdByUid(String(uid).trim());
  if (resolved) {
    req.user!.profileId = resolved;
    logger.info('[LOCAL_TEST] Resolved req.user.profileId from profiles.uid', {
      uid: String(uid).trim(),
      profileId: resolved.toString(),
    });
  }
}
