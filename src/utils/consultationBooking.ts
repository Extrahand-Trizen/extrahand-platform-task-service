import type { IBookingOrder } from '../models/BookingOrder';

export type ServiceFlowType = 'standard' | 'consultation_project';
export type BookingKind = 'standard' | 'consultation' | 'project';

export type ConsultationEstimateSnapshot = {
  amount?: number;
  currency?: string;
  durationLabel?: string;
  notes?: string;
  selections?: Record<string, unknown>;
};

export type ConsultationBookingMeta = {
  samePartnerPreferred?: boolean;
  consultationFee?: number;
  customerRequirements?: string;
  sourceTaskId?: string;
  sourceQuotationId?: string;
  projectTitle?: string;
  estimateSnapshot?: ConsultationEstimateSnapshot;
};

type ConsultationMetadataCarrier = {
  serviceFlowType?: ServiceFlowType;
  bookingKind?: BookingKind;
  serviceType?: string;
  consultationMeta?: ConsultationBookingMeta;
};

export function resolveBookingFlowDefaults(input: ConsultationMetadataCarrier & { gstExempt?: boolean }) {
  const serviceFlowType = input.serviceFlowType || 'standard';
  const bookingKind = input.bookingKind || 'standard';
  const serviceType = String(input.serviceType || '').trim() || undefined;
  const gstExempt = input.gstExempt === true || bookingKind === 'consultation';

  return {
    serviceFlowType,
    bookingKind,
    serviceType,
    consultationMeta: input.consultationMeta,
    gstExempt,
  };
}

export function applyBookingFlowDefaults<T extends ConsultationMetadataCarrier>(
  line: T,
  defaults: {
    serviceFlowType: ServiceFlowType;
    bookingKind: BookingKind;
    serviceType?: string;
    consultationMeta?: ConsultationBookingMeta;
  },
): T {
  return {
    ...line,
    serviceFlowType: line.serviceFlowType || defaults.serviceFlowType,
    bookingKind: line.bookingKind || defaults.bookingKind,
    serviceType: line.serviceType || defaults.serviceType,
    consultationMeta: line.consultationMeta || defaults.consultationMeta,
  };
}

export function isConsultationBookingKind(bookingKind?: string): boolean {
  return bookingKind === 'consultation';
}

export function buildConsultationTaskState(params: {
  lineTotal: number;
  lineConsultationMeta?: ConsultationBookingMeta;
  orderConsultationMeta?: IBookingOrder['consultationMeta'];
}) {
  return {
    currentStage: 'consultation_booked' as const,
    samePartnerPreferred:
      params.lineConsultationMeta?.samePartnerPreferred ??
      params.orderConsultationMeta?.samePartnerPreferred,
    consultationFee:
      params.lineConsultationMeta?.consultationFee ??
      params.orderConsultationMeta?.consultationFee ??
      params.lineTotal,
    estimateSnapshot:
      params.lineConsultationMeta?.estimateSnapshot ??
      params.orderConsultationMeta?.estimateSnapshot,
    customerRequirements:
      params.lineConsultationMeta?.customerRequirements ??
      params.orderConsultationMeta?.customerRequirements,
    lastUpdatedAt: new Date(),
  };
}
