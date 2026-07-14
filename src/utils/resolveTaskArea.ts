const PLUS_CODE_RE = /^[A-Z0-9]{2,8}\+[A-Z0-9]{2,}$/i;

function isSkippableAddressToken(token: string): boolean {
  const value = String(token || "").trim();
  if (!value) return true;
  if (value.includes("+") || PLUS_CODE_RE.test(value.replace(/\s/g, ""))) return true;
  if (/^[A-Za-z0-9]{1,2}$/.test(value)) return true;
  if (/^(flat|house|h\.?no|door|apt|apartment)\b/i.test(value)) return true;
  return false;
}

export function extractAreaFromAddress(address: string, city?: string): string {
  const parts = String(address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";

  const tokens = parts.filter((part) => !isSkippableAddressToken(part));
  const cityNorm = String(city || "").trim().toLowerCase();

  if (cityNorm) {
    const cityIdx = tokens.findIndex((token) => {
      const norm = token.toLowerCase();
      return norm === cityNorm || norm.startsWith(`${cityNorm} `);
    });
    if (cityIdx > 0) {
      for (let i = cityIdx - 1; i >= 0; i -= 1) {
        const candidate = tokens[i]?.trim();
        if (!candidate || isSkippableAddressToken(candidate)) continue;
        return candidate;
      }
    }
  }

  if (tokens.length >= 4) {
    const maybeCity = tokens[tokens.length - 3];
    const maybeArea = tokens[tokens.length - 4];
    if (cityNorm && maybeCity?.toLowerCase() === cityNorm && maybeArea) {
      return maybeArea;
    }
    if (!cityNorm && maybeArea && !isSkippableAddressToken(maybeArea)) {
      return maybeArea;
    }
  }

  return "";
}

export function resolveTaskAreaForCreate(input: {
  taskArea?: string | null;
  address?: string | null;
  city?: string | null;
}): string {
  const explicit = String(input.taskArea || "").trim();
  if (explicit) return explicit;
  return extractAreaFromAddress(String(input.address || ""), input.city ?? undefined);
}

export function applyTaskAreaToLocation<T extends Record<string, unknown>>(
  location: T | null | undefined,
  taskAreaInput?: {
    taskArea?: string | null;
    legacyTaskArea?: string | null;
  },
): T | undefined {
  if (!location) return undefined;

  const resolvedTaskArea = resolveTaskAreaForCreate({
    taskArea: taskAreaInput?.taskArea || taskAreaInput?.legacyTaskArea,
    address: String(location.address || ""),
    city: String(location.city || ""),
  });

  if (!resolvedTaskArea) return location;
  return { ...location, taskArea: resolvedTaskArea };
}

