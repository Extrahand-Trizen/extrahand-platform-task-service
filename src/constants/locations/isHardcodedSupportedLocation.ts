import { TELANGANA_SERVICE_AREAS } from './telanganaServiceAreas';

export type HardcodedLocationInput = {
  city?: string | null;
  district?: string | null;
  area?: string | null;
  state?: string | null;
  address?: string | null;
};

export type LocationServiceabilityResult = {
  isServiceable: boolean;
  canPostTask: boolean;
  canBookService: boolean;
  isHardcodedSupported: boolean;
};

/** Keep in sync with shared/extrahand-locations/isHardcodedSupportedLocation.ts */
export function normalizeLocationName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[-_/]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SUPPORTED_LOCATION_TOKENS = (() => {
  const tokens = new Set<string>();
  TELANGANA_SERVICE_AREAS.forEach((area) => {
    [area.district, area.city, ...(area.aliases ?? [])].forEach((label) => {
      const normalized = normalizeLocationName(label);
      if (normalized) tokens.add(normalized);
    });
  });
  return tokens;
})();

function tokenMatchesSupportedLocation(normalizedValue: string): boolean {
  if (!normalizedValue) return false;
  if (SUPPORTED_LOCATION_TOKENS.has(normalizedValue)) return true;

  for (const token of SUPPORTED_LOCATION_TOKENS) {
    if (token.length >= 4 && normalizedValue.includes(token)) return true;
  }

  return normalizedValue
    .split(' ')
    .some((part) => part.length >= 4 && SUPPORTED_LOCATION_TOKENS.has(part));
}

function collectLocationValues(input: HardcodedLocationInput): string[] {
  return [input.city, input.district, input.area, input.state, input.address]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
}

export function isHardcodedSupportedLocation(input: HardcodedLocationInput): boolean {
  return collectLocationValues(input).some((value) =>
    tokenMatchesSupportedLocation(normalizeLocationName(value)),
  );
}

export function resolveLocationServiceability(params: {
  checkPerformed: boolean;
  hasHelpers: boolean;
  location: HardcodedLocationInput;
}): LocationServiceabilityResult {
  const isHardcodedSupported = isHardcodedSupportedLocation(params.location);
  const existingValidationPassed = params.checkPerformed ? params.hasHelpers : true;
  const isServiceable = existingValidationPassed || isHardcodedSupported;

  return {
    isServiceable,
    canPostTask: isServiceable,
    canBookService: isServiceable,
    isHardcodedSupported,
  };
}
