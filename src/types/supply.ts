export type ExecutionProfile =
  | 'field_service'
  | 'delivery'
  | 'driver'
  | 'mover'
  | 'remote_service';

export type PartnerExecutionStatus =
  | 'awaiting_dispatch'
  | 'offered'
  | 'offer_expired'
  | 'assigned'
  | 'arrived'
  | 'start_otp_pending'
  | 'started'
  | 'in_progress'
  | 'proof_submitted'
  | 'completed'
  | 'cancelled'
  | 'pickup_reached'
  | 'picked_up'
  | 'in_transit'
  | 'drop_reached'
  | 'delivered';

export interface PartnerExecution {
  status: PartnerExecutionStatus;
  updatedAt: Date;
  offeredAt?: Date;
  offerExpiresAt?: Date;
  arrivedAt?: Date;
  otpRequestedAt?: Date;
  otpVerifiedAt?: Date;
  proofSubmittedAt?: Date;
  cancellationReason?: 'customer' | 'partner' | 'expired' | 'ops';
}

export interface DispatchMeta {
  broadcastRound: number;
  candidateCount: number;
  lastDispatchAt: Date;
}
