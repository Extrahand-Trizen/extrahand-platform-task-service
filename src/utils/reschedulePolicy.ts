import { HOURLY_CANCELLATION_POLICY } from '../services/cancellation/hourlyCancellationPolicy';
import { isHelperAssignedOnTask } from '../services/cancellation/cancellationTypes';

export type ReschedulePartnerState =
  | 'unassigned'
  | 'assigned'
  | 'on_the_way'
  | 'arrived'
  | 'started';

export type ReschedulePolicyKind = 'standard' | 'hourly' | 'consultation';

export type ReschedulePolicyDecision = {
  allowed: boolean;
  chargeRequired: boolean;
  chargeAmount?: number;
  reasonCode: string;
  partnerState: ReschedulePartnerState;
  policyWindowLabel?: string;
  message: string;
};

type ScheduleParams = {
  scheduledDate?: Date | string | null;
  scheduledTimeStart?: string | null;
};

type PartnerStateParams = {
  assigneeUid?: string | null;
  assigneeId?: unknown;
  executionPhase?: string | null;
  startedAt?: Date | string | null;
  arrivedAt?: Date | string | null;
  status?: string | null;
};

type FixedPriceChargeContext = {
  categorySlug?: string | null;
  serviceType?: string | null;
  bookingKind?: string | null;
  consultationFee?: number | null;
  lineTotal?: number | null;
};

const IST_OFFSET = '+05:30';
const STANDARD_FREE_WINDOW_MINUTES = 24 * 60;
const HOURLY_FREE_WINDOW_MINUTES = 2 * 60;
const FIXED_PRICE_FEE_TABLE = {
  home_cleaning: { within24h: 99, within4h: 199 },
  ac_services: { within24h: 99, within4h: 149 },
  appliance_repair: { within24h: 49, within4h: 99 },
} as const;

function parseSlotToMinutes(slot: string): number | null {
  const match = String(slot || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function formatScheduleDateKeyIST(scheduledDate: Date): string {
  const shifted = new Date(scheduledDate.getTime() + 5.5 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function resolveScheduledAt(params: ScheduleParams): Date | null {
  if (!params.scheduledDate) {
    return null;
  }
  const baseDate = params.scheduledDate instanceof Date
    ? params.scheduledDate
    : new Date(params.scheduledDate);
  if (Number.isNaN(baseDate.getTime())) {
    return null;
  }
  const dateKey = formatScheduleDateKeyIST(baseDate);
  const totalMinutes = parseSlotToMinutes(String(params.scheduledTimeStart || '').trim()) ?? 0;
  const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return new Date(`${dateKey}T${hh}:${mm}:00.000${IST_OFFSET}`);
}

export function minutesUntilScheduledStart(
  scheduledAt: Date | null,
  now: Date = new Date(),
): number | null {
  if (!scheduledAt) {
    return null;
  }
  return Math.floor((scheduledAt.getTime() - now.getTime()) / 60_000);
}

export function resolveReschedulePartnerState(
  params: PartnerStateParams,
): ReschedulePartnerState {
  const normalizedStatus = String(params.status || '').trim().toLowerCase();
  const normalizedPhase = String(params.executionPhase || '').trim().toLowerCase();
  if (params.startedAt || ['started', 'in_progress', 'review', 'completed'].includes(normalizedStatus)) {
    return 'started';
  }
  if (params.arrivedAt || normalizedPhase === 'arrived') {
    return 'arrived';
  }
  if (normalizedPhase === 'on_the_way') {
    return 'on_the_way';
  }
  if (isHelperAssignedOnTask(params)) {
    return 'assigned';
  }
  return 'unassigned';
}

function resolveFixedPriceFeeGroup(
  categorySlug?: string | null,
  serviceType?: string | null,
): keyof typeof FIXED_PRICE_FEE_TABLE {
  const category = String(categorySlug || '').trim().toLowerCase();
  const service = String(serviceType || '').trim().toLowerCase();
  if (category === 'ac-services') return 'ac_services';
  if (category === 'appliance-repair') return 'appliance_repair';
  if (category === 'painting' || service === 'painting') return 'home_cleaning';
  return 'home_cleaning';
}

function resolveFixedPriceChargeAmount(
  minutesUntilStartValue: number | null,
  context: FixedPriceChargeContext,
): number {
  const bookingKind = String(context.bookingKind || '').trim().toLowerCase();
  const consultationFee = Number(context.consultationFee || 0);
  if (bookingKind === 'consultation' && consultationFee > 0) {
    return consultationFee;
  }
  if (bookingKind === 'consultation') {
    const lineTotal = Number(context.lineTotal || 0);
    return lineTotal > 0 ? lineTotal : 99;
  }
  const feeGroup = resolveFixedPriceFeeGroup(context.categorySlug, context.serviceType);
  const table = FIXED_PRICE_FEE_TABLE[feeGroup];
  if (minutesUntilStartValue != null && minutesUntilStartValue <= 4 * 60) {
    return table.within4h;
  }
  return table.within24h;
}

function buildFreeDecision(
  reasonCode: string,
  partnerState: ReschedulePartnerState,
  policyWindowLabel: string,
  message: string,
): ReschedulePolicyDecision {
  return {
    allowed: true,
    chargeRequired: false,
    reasonCode,
    partnerState,
    policyWindowLabel,
    message,
  };
}

function buildChargedDecision(
  reasonCode: string,
  partnerState: ReschedulePartnerState,
  policyWindowLabel: string,
  chargeAmount: number,
  message: string,
): ReschedulePolicyDecision {
  return {
    allowed: true,
    chargeRequired: chargeAmount > 0,
    chargeAmount,
    reasonCode,
    partnerState,
    policyWindowLabel,
    message,
  };
}

export function evaluateTaskReschedulePolicy(params: {
  partnerState: ReschedulePartnerState;
  scheduledAt?: Date | null;
  now?: Date;
}): ReschedulePolicyDecision {
  const scheduledAt = params.scheduledAt ?? null;
  const now = params.now ?? new Date();
  const minutesRemaining = minutesUntilScheduledStart(scheduledAt, now);
  const policyWindowLabel = '24h window';

  if (params.partnerState === 'started') {
    return {
      allowed: false,
      chargeRequired: false,
      reasonCode: 'WORK_STARTED_BLOCKED',
      partnerState: params.partnerState,
      policyWindowLabel,
      message: 'The helper has already started the work. Please contact support.',
    };
  }
  if (params.partnerState === 'arrived') {
    return {
      allowed: false,
      chargeRequired: false,
      reasonCode: 'PARTNER_ARRIVED_BLOCKED',
      partnerState: params.partnerState,
      policyWindowLabel,
      message: 'The helper has already arrived. Please contact support.',
    };
  }
  if (params.partnerState === 'on_the_way') {
    return buildChargedDecision(
      'PARTNER_TRAVELLING_LATE_RULE',
      params.partnerState,
      policyWindowLabel,
      0,
      'The helper is already on the way. Existing late-change rules apply.',
    );
  }
  if (params.partnerState === 'unassigned') {
    return buildFreeDecision(
      'FREE_UNASSIGNED',
      params.partnerState,
      policyWindowLabel,
      'Free reschedule available.',
    );
  }
  if (minutesRemaining != null && minutesRemaining > STANDARD_FREE_WINDOW_MINUTES) {
    return buildFreeDecision(
      'FREE_EARLY',
      params.partnerState,
      policyWindowLabel,
      'Free reschedule available.',
    );
  }
  return buildChargedDecision(
    'LATE_ASSIGNED_RULE',
    params.partnerState,
    policyWindowLabel,
    0,
    'Helper is already assigned. Existing late-change rules may apply.',
  );
}

export function evaluateBookingLineReschedulePolicy(params: {
  kind: ReschedulePolicyKind;
  partnerState: ReschedulePartnerState;
  scheduledAt?: Date | null;
  now?: Date;
  categorySlug?: string | null;
  serviceType?: string | null;
  bookingKind?: string | null;
  consultationFee?: number | null;
  lineTotal?: number | null;
}): ReschedulePolicyDecision {
  const scheduledAt = params.scheduledAt ?? null;
  const now = params.now ?? new Date();
  const minutesRemaining = minutesUntilScheduledStart(scheduledAt, now);
  const policyWindowLabel = params.kind === 'hourly' ? '2h window' : '24h window';

  if (params.partnerState === 'started') {
    return {
      allowed: false,
      chargeRequired: false,
      reasonCode: 'WORK_STARTED_BLOCKED',
      partnerState: params.partnerState,
      policyWindowLabel,
      message: 'The helper has already started the work. Please contact support.',
    };
  }
  if (params.partnerState === 'arrived') {
    return {
      allowed: false,
      chargeRequired: false,
      reasonCode: 'PARTNER_ARRIVED_BLOCKED',
      partnerState: params.partnerState,
      policyWindowLabel,
      message: 'The helper has already arrived. Please contact support.',
    };
  }
  if (params.partnerState === 'unassigned') {
    return buildFreeDecision(
      'FREE_UNASSIGNED',
      params.partnerState,
      policyWindowLabel,
      'Free reschedule available.',
    );
  }

  if (params.kind === 'hourly') {
    if (
      params.partnerState === 'on_the_way' ||
      (minutesRemaining != null && minutesRemaining <= HOURLY_FREE_WINDOW_MINUTES)
    ) {
      return buildChargedDecision(
        params.partnerState === 'on_the_way'
          ? 'PARTNER_TRAVELLING_LATE_RULE'
          : 'LATE_ASSIGNED_RULE',
        params.partnerState,
        policyWindowLabel,
        Math.round(HOURLY_CANCELLATION_POLICY.LATE_CANCEL_FEE_PAISE / 100),
        params.partnerState === 'on_the_way'
          ? 'The helper is already on the way. Existing late-change rules apply.'
          : 'Helper is already assigned. Existing late-change rules apply.',
      );
    }
    return buildFreeDecision(
      'FREE_EARLY',
      params.partnerState,
      policyWindowLabel,
      'Free reschedule available.',
    );
  }

  if (params.partnerState === 'on_the_way') {
    return buildChargedDecision(
      'PARTNER_TRAVELLING_LATE_RULE',
      params.partnerState,
      policyWindowLabel,
      resolveFixedPriceChargeAmount(minutesRemaining, params),
      'The helper is already on the way. Existing late-change rules apply.',
    );
  }
  if (minutesRemaining != null && minutesRemaining > STANDARD_FREE_WINDOW_MINUTES) {
    return buildFreeDecision(
      'FREE_EARLY',
      params.partnerState,
      policyWindowLabel,
      'Free reschedule available.',
    );
  }
  return buildChargedDecision(
    'LATE_ASSIGNED_RULE',
    params.partnerState,
    policyWindowLabel,
    resolveFixedPriceChargeAmount(minutesRemaining, params),
    'Helper is already assigned. Existing late-change rules apply.',
  );
}
