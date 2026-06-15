/**
 * Wave 6 — future execution profile milestone maps.
 * Delivery, driver, mover, remote_service flows extend partnerExecution.status per profile.
 */
export const DELIVERY_MILESTONES = [
  'awaiting_dispatch',
  'offered',
  'assigned',
  'pickup_reached',
  'picked_up',
  'in_transit',
  'drop_reached',
  'delivered',
  'completed',
  'cancelled',
] as const;

export const REMOTE_SERVICE_MILESTONES = [
  'assigned',
  'started',
  'in_progress',
  'delivered',
  'completed',
  'cancelled',
] as const;
