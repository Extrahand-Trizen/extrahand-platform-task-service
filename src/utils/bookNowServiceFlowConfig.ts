export type BookNowFlowConfig = {
  serviceFlowType: 'standard' | 'consultation_project';
  bookingKind: 'standard' | 'consultation';
  serviceType?: string;
  consultationEnabled: boolean;
  gstExempt: boolean;
};

type ResolveBookNowFlowConfigInput = {
  categorySlug?: string;
  skuSlug?: string;
  catalogId?: string;
  packageId?: string;
};

const PAINTING_CATEGORY_SLUGS = new Set([
  'painting',
  'interior-painting',
  'exterior-painting',
  'rental-painting',
  'waterproofing',
]);

function normalizeSlug(value?: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

function isPaintingConsultationPackage(packageSlug: string): boolean {
  return packageSlug.startsWith('painting-consultation-');
}

export function resolveBookNowServiceFlowConfig(
  input: ResolveBookNowFlowConfigInput,
): BookNowFlowConfig {
  const normalizedCategorySlug = normalizeSlug(input.categorySlug || input.catalogId);
  const normalizedPackageSlug = normalizeSlug(input.skuSlug || input.packageId);

  const isPaintingFlow =
    PAINTING_CATEGORY_SLUGS.has(normalizedCategorySlug) ||
    isPaintingConsultationPackage(normalizedPackageSlug);

  if (isPaintingFlow) {
    return {
      serviceFlowType: 'consultation_project',
      bookingKind: isPaintingConsultationPackage(normalizedPackageSlug)
        ? 'consultation'
        : 'standard',
      serviceType: 'painting',
      consultationEnabled: true,
      gstExempt: isPaintingConsultationPackage(normalizedPackageSlug),
    };
  }

  return {
    serviceFlowType: 'standard',
    bookingKind: 'standard',
    consultationEnabled: false,
    gstExempt: false,
  };
}
