export interface JourneyCoordinates {
  lat: number;
  lng: number;
}

export interface JourneyStartedValue {
  at?: Date | null;
  location?: Partial<JourneyCoordinates> | null;
}

export interface JourneyStartedRecord {
  at: Date;
  location: JourneyCoordinates | null;
}

export function hasValidJourneyCoordinates(
  location: Partial<JourneyCoordinates> | null | undefined,
): location is JourneyCoordinates {
  return (
    typeof location?.lat === 'number' &&
    Number.isFinite(location.lat) &&
    Math.abs(location.lat) <= 90 &&
    typeof location.lng === 'number' &&
    Number.isFinite(location.lng) &&
    Math.abs(location.lng) <= 180
  );
}

function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function buildJourneyStartedRecord(
  existing: JourneyStartedValue | null | undefined,
  incoming: JourneyStartedValue | null | undefined,
  fallbackAt: Date,
): JourneyStartedRecord {
  return {
    at: isValidDate(existing?.at)
      ? existing.at
      : isValidDate(incoming?.at)
        ? incoming.at
        : fallbackAt,
    location: hasValidJourneyCoordinates(existing?.location)
      ? existing.location
      : hasValidJourneyCoordinates(incoming?.location)
        ? incoming.location
        : null,
  };
}

export function needsJourneyStartedUpdate(
  existing: JourneyStartedValue | null | undefined,
  incoming: JourneyStartedValue | null | undefined,
): boolean {
  return (
    !isValidDate(existing?.at) ||
    (hasValidJourneyCoordinates(incoming?.location) &&
      !hasValidJourneyCoordinates(existing?.location))
  );
}
