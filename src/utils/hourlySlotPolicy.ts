export type HourlySlotMode = 'helper_capacity' | 'managed_schedule';

export type HourlySlotSettings = {
  mode: HourlySlotMode;
  startTime: string;
  endTime: string;
  blockedHours: number;
};

export const DEFAULT_HOURLY_SLOT_SETTINGS: HourlySlotSettings = {
  mode: 'helper_capacity',
  startTime: '07:00',
  endTime: '20:00',
  blockedHours: 2,
};

const MIN_SLOT_TIME = 7 * 60;
const MAX_SLOT_TIME = 20 * 60;
const SLOT_STEP_MINUTES = 30;
const INDIA_TIMEZONE_OFFSET = '+05:30';

export function parseHourlySlotTime(value: string): number | null {
  const text = String(value || '').trim();
  const time24 = text.match(/^(\d{2}):(\d{2})$/);
  if (time24) {
    const hours = Number(time24[1]);
    const minutes = Number(time24[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }
  const time12 = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!time12) return null;
  let hours = Number(time12[1]);
  const minutes = Number(time12[2]);
  if (hours < 1 || hours > 12 || minutes > 59) return null;
  if (time12[3].toUpperCase() === 'PM' && hours !== 12) hours += 12;
  if (time12[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export function validateHourlySlotSettings(
  settings: HourlySlotSettings,
): HourlySlotSettings {
  const start = parseHourlySlotTime(settings.startTime);
  const end = parseHourlySlotTime(settings.endTime);
  const blockedHours = Number(settings.blockedHours);
  if (settings.mode !== 'helper_capacity' && settings.mode !== 'managed_schedule') {
    throw new Error('mode must be helper_capacity or managed_schedule');
  }
  if (
    start === null ||
    end === null ||
    start < MIN_SLOT_TIME ||
    end > MAX_SLOT_TIME ||
    start >= end ||
    start % SLOT_STEP_MINUTES !== 0 ||
    end % SLOT_STEP_MINUTES !== 0
  ) {
    throw new Error('slot range must use 30-minute increments within 07:00-20:00');
  }
  if (
    !Number.isFinite(blockedHours) ||
    blockedHours < 0 ||
    blockedHours > 24 ||
    blockedHours * 2 !== Math.round(blockedHours * 2)
  ) {
    throw new Error('blockedHours must be between 0 and 24 in 30-minute increments');
  }
  return { ...settings, blockedHours };
}

export function isHourlySlotAllowedBySettings(params: {
  date: string;
  slot: string;
  durationMinutes: number;
  settings: HourlySlotSettings;
  now?: Date;
}): boolean {
  const settings = validateHourlySlotSettings(params.settings);
  const start = parseHourlySlotTime(params.slot);
  const rangeStart = parseHourlySlotTime(settings.startTime)!;
  const rangeEnd = parseHourlySlotTime(settings.endTime)!;
  const durationMinutes = Math.round(Number(params.durationMinutes));
  if (
    start === null ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0 ||
    start < rangeStart ||
    start >= rangeEnd ||
    start % SLOT_STEP_MINUTES !== 0 ||
    start + durationMinutes > rangeEnd
  ) {
    return false;
  }

  const slotTime =
    `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
  const slotStart = new Date(`${params.date}T${slotTime}:00${INDIA_TIMEZONE_OFFSET}`);
  if (Number.isNaN(slotStart.getTime())) return false;
  const releaseTime =
    (params.now || new Date()).getTime() + settings.blockedHours * 60 * 60 * 1000;
  return slotStart.getTime() >= releaseTime;
}

export function buildHourlyScheduleCapacity(params: {
  date: string;
  durationMinutes: number;
  settings: HourlySlotSettings;
  now?: Date;
}): Record<string, number> {
  const capacity: Record<string, number> = {};
  const start = parseHourlySlotTime(params.settings.startTime);
  const end = parseHourlySlotTime(params.settings.endTime);
  if (start === null || end === null) return capacity;
  for (let minutes = start; minutes < end; minutes += SLOT_STEP_MINUTES) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const period = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    const label = `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
    capacity[label] = isHourlySlotAllowedBySettings({
      date: params.date,
      slot: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      durationMinutes: params.durationMinutes,
      settings: params.settings,
      now: params.now,
    })
      ? 1
      : 0;
  }
  return capacity;
}
