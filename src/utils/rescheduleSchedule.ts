function parseSlotMinutes(slot: string): number | null {
  const match = String(slot || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes > 59) return null;
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function formatSlotMinutes(totalMinutes: number): string {
  const hours24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, '0')} ${period}`;
}

export function resolveRescheduleEndTime(
  scheduledTimeStart: string,
  durationMinutes: number,
): string | null {
  const startMinutes = parseSlotMinutes(scheduledTimeStart);
  const duration = Number(durationMinutes);
  if (startMinutes == null || !Number.isInteger(duration) || duration <= 0) return null;
  return formatSlotMinutes(startMinutes + duration);
}
