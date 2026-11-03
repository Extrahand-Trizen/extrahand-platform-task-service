import { Config } from '../config/env';
import { PERSONAL_ASSISTANT_CATEGORY_SLUG } from '../constants/personalAssistantBooking';

function parseTruthyEnv(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function isPersonalAssistantCatalogPublished(): boolean {
  return parseTruthyEnv(Config.BOOK_NOW_PERSONAL_ASSISTANT_PUBLISHED);
}

export function getPersonalAssistantPreviewUids(): ReadonlySet<string> {
  const raw = Config.BOOK_NOW_PERSONAL_ASSISTANT_PREVIEW_UIDS || '';
  return new Set(
    raw
      .split(',')
      .map((uid) => uid.trim())
      .filter(Boolean),
  );
}

export function isPersonalAssistantCategorySlug(slug: string): boolean {
  return (
    String(slug || '')
      .toLowerCase()
      .replace(/[-_\s]+/g, '-')
      .trim() === PERSONAL_ASSISTANT_CATEGORY_SLUG
  );
}

/** Catalog visibility is controlled by the active category, service, and content records. */
export function canAccessPersonalAssistantCatalog(_customerUid?: string | null): boolean {
  return true;
}

export function personalAssistantCatalogIsActive(): boolean {
  return isPersonalAssistantCatalogPublished();
}
