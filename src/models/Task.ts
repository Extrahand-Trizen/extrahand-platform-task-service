import mongoose, { Schema, Model, Document } from "mongoose";

export interface ITask extends Document {
  title: string;
  description: string;

  category:
    | "cleaning"
    | "repair"
    | "delivery"
    | "assembly"
    | "gardening"
    | "petcare"
    | "packers-movers"
    | "other";
  categorySlug?: string;
  categoryLabel?: string;
  subcategory?: string;

  // ── Packers & Movers specific fields (only populated when category = 'packers-movers') ──
  packersMoversDetails?: {
    serviceType?: 'intracity' | 'intercity';
    houseType?: string;
    pickupAddress?: string;
    pickupCoordinates?: [number, number];
    dropAddress?: string;
    dropCoordinates?: [number, number];
    liftAtPickup?: boolean;
    liftAtDrop?: boolean;
    pickupFloor?: string;
    dropFloor?: string;
    moveDate?: string;
    moveTimeSlot?: string;
    selectedItems?: string;
    packing?: boolean;
    unpacking?: boolean;
    loadingOnly?: boolean;
    helpers?: number;
    offeredPrice?: number;
  };

  // ── Delivery / Pickup specific fields ──────────────────────────────────────
  groceryPickupDetails?: {
    groceryItems?: string;
    preferredStore?: string;
    shopLocation?: string;
    quantityNotes?: string;
    urgentDelivery?: boolean;
    deliveryAddress?: string;
    deliveryLabel?: string;
    preferences?: string;
    estimatedAmount?: number;
  };

  medicinePickupDetails?: {
    medicines?: string;
    specialInstructions?: string;
    preferredPharmacy?: string;
    pharmacyLocation?: string;
    deliveryAddress?: string;
    deliveryLabel?: string;
    estimatedAmount?: number;
  };

  pickDropDetails?: {
    itemType?: string;
    itemDescription?: string;
    itemWeight?: string;
    packageType?: string;
    packageContents?: string[];
    packageTypeOther?: string;
    packageContentsOther?: string;
    pickupAddress?: string;
    pickupLabel?: string;
    dropAddress?: string;
    receiverName?: string;
    receiverMobile?: string;
    useMyNumber?: boolean;
    specialInstructions?: string;
    estimatedItemValue?: number;
    deliveryBudget?: number;
    packagePhotoUrl?: string;
  };

  budget: {
    amount: number;
    currency: "INR";
    type: "fixed" | "hourly";
  };
  isNegotiable: boolean;

  location?: {
    type: "Point";
    coordinates?: [number, number];
    address?: string;
    city?: string;
    state?: string;
    pinCode?: string;
    country?: string;
    /** Neighborhood / locality captured at post time for helper browse views. */
    taskArea?: string;
  };

  urgency: "low" | "medium" | "high" | "urgent";
  priority: "low" | "normal" | "high";

  status:
    | "open"
    | "assigned"
    | "started"
    | "in_progress"
    | "review"
    | "completed"
    | "cancelled";

  requesterId: mongoose.Types.ObjectId; // ObjectId reference to Profile
  // ❌ Removed requesterName - API Gateway will enrich with Profile data
  /** Firebase uid of poster when denormalized on the task document. */
  requesterUid?: string;

  assigneeId?: mongoose.Types.ObjectId | null; // ObjectId reference to Profile
  /** Firebase UID of the assigned helper — required for tasker My Work lookup */
  /** Firebase uid of assigned helper when denormalized on the task document. */
  assigneeUid?: string | null;
  /**
   * Canonical denormalized helper display name, stored at assignment time.
   * Prefer this field for customer-facing "Professional assigned" UI.
   */
  assignedHelperName?: string | null;
  /** @deprecated Prefer assignedHelperName — kept for older readers/writers. */
  assignedToName?: string | null;
  /** @deprecated Prefer assignedHelperName — kept for older readers/writers. */
  assigneeName?: string | null;
  assignedAt?: Date;
  /** _id of the synthetic accepted TaskApplication created by ops assignment */
  acceptedApplicationId?: mongoose.Types.ObjectId | null;

  estimatedDuration?: number;
  actualDuration?: number;

  scheduledDate?: Date;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  dateOption?: "flexible" | "on-date" | "before-date";
  timeSlot?: "morning" | "midday" | "afternoon" | "evening";
  flexibility: "strict" | "flexible" | "anytime";
  timeFlexibilityValue?: "exact" | "1h" | "3h";

  recurring?: {
    enabled: boolean;
    frequency: "daily" | "weekly" | "custom";
    startDate?: Date;
    endDate?: Date;
    requireApproval?: boolean;
    minCommitment?: number;
  };

  /** v2 recurring visit plan (Post & Choose recurring with __recur_meta tag). */
  recurringPlan?: {
    planVersion?: number;
    status?: "draft" | "active" | "paused" | "ended";
    taskerProfileId?: mongoose.Types.ObjectId;
    taskerUid?: string;
    acceptedApplicationId?: mongoose.Types.ObjectId;
    pattern?: string;
    selectedWeekdays?: number[];
    endType?: "until_cancelled" | "end_on_date";
    endDate?: Date;
    visitTime?: string;
    expectedDurationMinutes?: number;
    budgetPerVisit?: number;
    lastMaterializedDate?: Date;
    materializedBufferSize?: number;
    nextVisitIndex?: number;
    completedVisitCount?: number;
    consecutiveUnpaidCount?: number;
    nextVisitDate?: Date;
    pendingPaymentVisitId?: string;
    /** embedded = legacy schedule[]; collection = RecurringVisit documents */
    visitStorage?: 'embedded' | 'collection';
    pausedAt?: Date;
    pausedReason?: string;
    endedAt?: Date;
    lastPaymentSyncAt?: Date;
  };

  activeVisitId?: string;
  parentTaskId?: mongoose.Types.ObjectId;
  recurringVisitId?: string;
  recurringParentPlan?: boolean;

  schedule?: Array<{
    visitId?: string;
    visitIndex?: number;
    date: Date;
    scheduledTimeStart?: string;
    scheduledTimeEnd?: string;
    expectedDurationMinutes?: number;
    status: string;
    paymentStatus?: string;
    escrowId?: string;
    paymentDeadline?: Date;
    paidAt?: Date;
    amount?: number;
    assigneeId?: mongoose.Types.ObjectId | null;
    assigneeUid?: string | null;
    childTaskId?: mongoose.Types.ObjectId | null;
    skippedAt?: Date;
    skippedBy?: string;
    skipReason?: string;
    paymentReminderSentAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
  }>;

  requirements?: string[];
  images?: string[];
  tags?: string[];

  views: number;
  isFeatured: boolean;
  expiresAt?: Date;

  completionProof?: Array<{
    url: string;
    filename?: string;
    uploadedAt?: Date;
    uploadedBy?: string;
  }>;
  completionStatus?:
    | "pending_approval"
    | "approved"
    | "rejected"
    | "revision_requested";
  completionNotes?: string;
  completionRejectedReason?: string;
  completionApprovedAt?: Date;
  completionRejectedAt?: Date;

  feedback?: Array<{
    message: string;
    createdById: mongoose.Types.ObjectId;
    createdAt: Date;
  }>;

  /**
   * Journey sub-phase while task.status is still `assigned`.
   * Helper updates this (no live GPS). OTP is issued when journey starts (`on_the_way`).
   */
  executionPhase?: 'assigned' | 'on_the_way' | 'arrived';
  executionPhaseUpdatedAt?: Date;
  onTheWayAt?: Date;
  arrivedAt?: Date;

  startOtp?: {
    codeHash: string;
    /** Short-lived plaintext for poster Work Progress display only; never returned on public getTask. */
    codePlain?: string;
    requestedAt: Date;
    expiresAt: Date;
    verifiedAt?: Date;
    attempts: number;
    resendCount: number;
    requestedById: mongoose.Types.ObjectId;
  };

  additionalQuoteRequests?: Array<{
    requestId: string;
    amount: number;
    reason: string;
    proofImages?: string[];
    // TEMP DISABLED: selfie/work-photo specific fields retained only for backward compatibility.
    selfieImage?: string;
    workImage?: string;
    status: "pending" | "accepted" | "rejected" | "withdrawn";
    createdAt: Date;
    decidedAt?: Date;
    decidedById?: mongoose.Types.ObjectId;
    decisionReason?: string;
  }>;
  activeAdditionalQuoteRequestId?: string | null;

  /** Poster changed fixed (non-negotiable) budget from Edit Work — at most one such change server-side. */
  posterBudgetEditedViaFormOnce?: boolean;

  // ── Global Budget Revision (Phase 1) ────────────────────────────────────────
  /** How many times the poster has revised the listed budget. Capped by MAX_REVISION_ROUNDS. Default = 0. */
  currentRevisionRound: number;
  /** High-level negotiation state for the task. Separate from task lifecycle status. */
  negotiationStatus: "open" | "revised" | "closed";
  /** Append-only audit trail of poster listed-budget revisions (negotiable flow). */
  budgetRevisions?: Array<{
    round: number;
    previousAmount: number;
    newAmount: number;
    revisedAt: Date;
    revisedById: mongoose.Types.ObjectId;
    notifiedBidderCount: number;
  }>;

  startedAt?: Date;
  inProgressAt?: Date;
  reviewAt?: Date;
  completionSubmittedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  cancelledById?: mongoose.Types.ObjectId; // ObjectId reference to Profile
  cancellationReason?: string;

  /**
   * WhatsApp / notification governance (digest caps, schedule versioning, etc.).
   */
  /** marketplace = bid flow; book_now = paid upfront, ops assigns helper */
  bookingSource?: 'marketplace' | 'book_now';
  bookingOrderId?: string;
  bookingItemId?: string;
  assignmentStatus?: 'pending' | 'assigned' | 'failed';

  /** Partner who accepted this Book Now lead */
  partnerId?: mongoose.Types.ObjectId | null;
  partnerUid?: string | null;
  partnerAcceptedAt?: Date;

  notificationGovernance?: {
    /** Bumped when scheduled date/time changes — invalidates old start-soon idempotency keys. */
    scheduleVersion?: string;
    /** Last time poster opened the applicants list for this work. */
    applicantsViewedAt?: Date;
    offerDigest?: {
      pendingSinceLastDigest?: number;
      lastDigestAt?: Date;
      digestsToday?: number;
      digestDayKey?: string;
      firstOfferWaSent?: boolean;
    };
  };

  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },

    category: {
      type: String,
      enum: [
        "cleaning",
        "repair",
        "delivery",
        "assembly",
        "gardening",
        "petcare",
        "packers-movers",
        "other",
      ],
      required: true,
      index: true,
    },
    categorySlug: { type: String, index: true },
    categoryLabel: String,
    subcategory: String,

    // ── Packers & Movers specific fields ──────────────────────────────────────
    packersMoversDetails: {
      type: {
        serviceType: { type: String, enum: ['intracity', 'intercity'] },
        houseType: String,
        pickupAddress: String,
        pickupCoordinates: [Number],
        dropAddress: String,
        dropCoordinates: [Number],
        liftAtPickup: { type: Boolean, default: true },
        liftAtDrop: { type: Boolean, default: true },
        pickupFloor: String,
        dropFloor: String,
        moveDate: String,
        moveTimeSlot: String,
        selectedItems: String,
        packing: { type: Boolean, default: false },
        unpacking: { type: Boolean, default: false },
        loadingOnly: { type: Boolean, default: false },
        helpers: { type: Number, default: 2 },
        offeredPrice: Number,
      },
      default: undefined,
    },

    // ── Delivery / Pickup specific fields ──────────────────────────────────────
    groceryPickupDetails: {
      type: {
        groceryItems: String,
        preferredStore: String,
        shopLocation: String,
        quantityNotes: String,
        urgentDelivery: { type: Boolean, default: false },
        deliveryAddress: String,
        deliveryLabel: String,
        preferences: String,
        estimatedAmount: Number,
      },
      default: undefined,
    },

    medicinePickupDetails: {
      type: {
        medicines: String,
        specialInstructions: String,
        preferredPharmacy: String,
        pharmacyLocation: String,
        deliveryAddress: String,
        deliveryLabel: String,
        estimatedAmount: Number,
      },
      default: undefined,
    },

    pickDropDetails: {
      type: {
        itemType: String,
        itemDescription: String,
        itemWeight: String,
        packageType: String,
        packageContents: [String],
        packageTypeOther: String,
        packageContentsOther: String,
        pickupAddress: String,
        pickupLabel: String,
        dropAddress: String,
        receiverName: String,
        receiverMobile: String,
        useMyNumber: { type: Boolean, default: false },
        specialInstructions: String,
        estimatedItemValue: Number,
        deliveryBudget: Number,
        packagePhotoUrl: String,
      },
      default: undefined,
    },

    budget: {
      amount: { type: Number, required: true, min: 0 },
      currency: { type: String, default: "INR" },
      type: { type: String, enum: ["fixed", "hourly"], default: "fixed" },
    },
    isNegotiable: { type: Boolean, default: false },
    posterBudgetEditedViaFormOnce: { type: Boolean, default: false },

    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: [Number],
      address: String,
      city: { type: String, index: true },
      state: String,
      pinCode: String,
      country: { type: String, default: "India" },
      taskArea: { type: String, trim: true },
    },

    urgency: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
      index: true,
    },

    priority: {
      type: String,
      enum: ["low", "normal", "high"],
      default: "normal",
    },

    status: {
      type: String,
      enum: [
        "open",
        "assigned",
        "started",
        "in_progress",
        "review",
        "completed",
        "cancelled",
      ],
      default: "open",
      index: true,
    },

    requesterId: {
      type: Schema.Types.ObjectId,
      ref: "Profile", // Reference for documentation only - populate won't work across services
      required: true,
      index: true,
    },
    // ❌ Removed requesterName - API Gateway will enrich with Profile data

    assigneeId: {
      type: Schema.Types.ObjectId,
      ref: "Profile",
      index: true,
      default: null,
    },
    assigneeUid: { type: String, default: null, index: true },
    /** Stored at assignment time — exact helper name for work progress / history. */
    assignedHelperName: { type: String, default: null },
    assignedToName: { type: String, default: null },
    assigneeName: { type: String, default: null },
    assignedAt: Date,
    acceptedApplicationId: {
      type: Schema.Types.ObjectId,
      ref: "TaskApplication",
      default: null,
    },

    estimatedDuration: Number,
    actualDuration: Number,

    scheduledDate: Date,
    scheduledTimeStart: String,
    scheduledTimeEnd: String,
    dateOption: {
      type: String,
      enum: ["flexible", "on-date", "before-date"],
    },
    timeSlot: {
      type: String,
      enum: ["morning", "midday", "afternoon", "evening"],
    },
    flexibility: {
      type: String,
      enum: ["strict", "flexible", "anytime"],
      default: "flexible",
    },
    timeFlexibilityValue: {
      type: String,
      enum: ["exact", "1h", "3h"],
    },

    recurring: {
      enabled: { type: Boolean, default: false },
      frequency: {
        type: String,
        enum: ["daily", "weekly", "custom"],
        default: "daily",
      },
      startDate: Date,
      endDate: Date,
      requireApproval: { type: Boolean, default: true },
      minCommitment: Number,
    },

    recurringPlan: {
      planVersion: Number,
      status: {
        type: String,
        enum: ["draft", "active", "paused", "ended"],
      },
      taskerProfileId: { type: Schema.Types.ObjectId, ref: "Profile", default: null },
      taskerUid: String,
      acceptedApplicationId: { type: Schema.Types.ObjectId, ref: "TaskApplication", default: null },
      pattern: String,
      selectedWeekdays: [Number],
      endType: { type: String, enum: ["until_cancelled", "end_on_date"] },
      endDate: Date,
      visitTime: String,
      expectedDurationMinutes: Number,
      budgetPerVisit: Number,
      lastMaterializedDate: Date,
      materializedBufferSize: { type: Number, default: 2 },
      nextVisitIndex: Number,
      completedVisitCount: { type: Number, default: 0 },
      consecutiveUnpaidCount: { type: Number, default: 0 },
      nextVisitDate: Date,
      pendingPaymentVisitId: String,
      visitStorage: { type: String, enum: ['embedded', 'collection'] },
      pausedAt: Date,
      pausedReason: String,
      endedAt: Date,
      lastPaymentSyncAt: Date,
    },

    activeVisitId: String,
    parentTaskId: { type: Schema.Types.ObjectId, ref: "Task", default: null, index: true },
    recurringVisitId: String,
    recurringParentPlan: { type: Boolean, default: false },

    /**
     * @deprecated Visit instance data migrates to RecurringVisit collection.
     * Retained for rollback until: backfill complete, validation clean, collection reads/writes
     * enabled in production, schedulers/payments no longer depend on schedule[], mobile hydrated.
     */
    schedule: {
      type: [
        {
          visitId: String,
          visitIndex: Number,
          date: { type: Date, required: true },
          scheduledTimeStart: String,
          scheduledTimeEnd: String,
          expectedDurationMinutes: Number,
          status: {
            type: String,
            enum: [
              "open",
              "reserved",
              "assigned",
              "completed",
              "cancelled",
              "scheduled",
              "payment_pending",
              "confirmed",
              "in_progress",
              "skipped",
              "skipped_unpaid",
              "cancelled_late",
            ],
            default: "open",
          },
          paymentStatus: {
            type: String,
            enum: ["not_required", "pending", "held", "released", "refunded", "failed"],
            default: "not_required",
          },
          escrowId: String,
          paymentDeadline: Date,
          paidAt: Date,
          amount: Number,
          assigneeId: {
            type: Schema.Types.ObjectId,
            ref: "Profile",
            default: null,
          },
          assigneeUid: { type: String, default: null },
          childTaskId: {
            type: Schema.Types.ObjectId,
            ref: "Task",
            default: null,
          },
          skippedAt: Date,
          skippedBy: String,
          skipReason: String,
          paymentReminderSentAt: Date,
          cancellationChargeAmount: Number,
          rescheduleRequest: {
            requestedBy: { type: String, enum: ['customer', 'tasker'] },
            status: { type: String, enum: ['pending', 'approved', 'rejected'] },
            newDate: Date,
            scheduledTimeStart: String,
            scheduledTimeEnd: String,
            reason: String,
            requestedAt: Date,
            respondedAt: Date,
          },
          cancelRequest: {
            requestedBy: { type: String, enum: ['tasker'] },
            status: { type: String, enum: ['pending', 'approved', 'rejected'] },
            reason: String,
            requestedAt: Date,
            respondedAt: Date,
          },
          createdAt: Date,
          updatedAt: Date,
        },
      ],
      default: [],
    },

    requirements: [String],
    images: [String],
    tags: [String],

    views: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },

    expiresAt: { type: Date, index: true },

    completionProof: [{
      url: { type: String, required: true },
      filename: String,
      uploadedAt: Date,
      uploadedBy: String,
    }],
    completionStatus: {
      type: String,
      enum: ["pending_approval", "approved", "rejected", "revision_requested"],
      index: true,
    },
    completionNotes: String,
    completionRejectedReason: String,
    completionApprovedAt: Date,
    completionRejectedAt: Date,
    feedback: [{
      message: { type: String, required: true },
      createdById: {
        type: Schema.Types.ObjectId,
        ref: "Profile",
        required: true,
      },
      createdAt: { type: Date, default: Date.now },
    }],
    executionPhase: {
      type: String,
      enum: ['assigned', 'on_the_way', 'arrived'],
      index: true,
    },
    executionPhaseUpdatedAt: Date,
    onTheWayAt: Date,
    arrivedAt: Date,
    startOtp: {
      codeHash: String,
      codePlain: String,
      requestedAt: Date,
      expiresAt: Date,
      verifiedAt: Date,
      attempts: { type: Number, default: 0 },
      resendCount: { type: Number, default: 0 },
      requestedById: {
        type: Schema.Types.ObjectId,
        ref: "Profile",
      },
    },
    additionalQuoteRequests: [{
      requestId: { type: String, required: true },
      amount: { type: Number, required: true, min: 1 },
      reason: { type: String, required: true, trim: true, maxlength: 1000 },
      proofImages: [{ type: String }],
      // TEMP DISABLED: selfie/work-photo specific required fields.
      // selfieImage: { type: String, required: true },
      // workImage: { type: String, required: true },
      selfieImage: { type: String, required: false },
      workImage: { type: String, required: false },
      status: {
        type: String,
        enum: ["pending", "accepted", "rejected", "withdrawn"],
        default: "pending",
      },
      createdAt: { type: Date, default: Date.now },
      decidedAt: Date,
      decidedById: {
        type: Schema.Types.ObjectId,
        ref: "Profile",
      },
      decisionReason: String,
    }],
    activeAdditionalQuoteRequestId: { type: String, default: null },

    // ── Global Budget Revision (Phase 1) ────────────────────────────────────
    currentRevisionRound: { type: Number, default: 0, min: 0, max: 1 },
    negotiationStatus: {
      type: String,
      enum: ["open", "revised", "closed"],
      default: "open",
      index: true,
    },
    budgetRevisions: {
      type: [
        {
          round: { type: Number, required: true, min: 1 },
          previousAmount: { type: Number, required: true, min: 0 },
          newAmount: { type: Number, required: true, min: 0 },
          revisedAt: { type: Date, default: Date.now },
          revisedById: {
            type: Schema.Types.ObjectId,
            ref: "Profile",
            required: true,
          },
          notifiedBidderCount: { type: Number, default: 0, min: 0 },
        },
      ],
      default: [],
    },

    startedAt: Date,
    inProgressAt: Date,
    reviewAt: Date,
    completionSubmittedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
    cancelledById: {
      type: Schema.Types.ObjectId,
      ref: "Profile",
      index: true,
    },
    cancellationReason: String,

    bookingSource: {
      type: String,
      enum: ['marketplace', 'book_now'],
      default: 'marketplace',
      index: true,
    },
    bookingOrderId: { type: String, index: true },
    bookingItemId: String,
    assignmentStatus: {
      type: String,
      enum: ['pending', 'assigned', 'failed'],
    },

    partnerId: {
      type: Schema.Types.ObjectId,
      ref: 'Profile',
      default: null,
      index: true,
    },
    partnerUid: { type: String, default: null, index: true },
    partnerAcceptedAt: Date,

    notificationGovernance: {
      scheduleVersion: String,
      applicantsViewedAt: Date,
      offerDigest: {
        pendingSinceLastDigest: { type: Number, default: 0 },
        lastDigestAt: Date,
        digestsToday: { type: Number, default: 0 },
        digestDayKey: String,
        firstOfferWaSent: { type: Boolean, default: false },
      },
    },
  },
  { timestamps: true }
);

// Indexes
TaskSchema.index({ "location.coordinates": "2dsphere" });
TaskSchema.index({ category: 1, status: 1 });
TaskSchema.index({ requesterId: 1, status: 1 });
TaskSchema.index({ assigneeId: 1, status: 1 }); // ✅ Updated from assigneeUid
TaskSchema.index({ expiresAt: 1, status: 1 });
TaskSchema.index({ "schedule.date": 1, status: 1 });
// List queries: filter by category+status (or status) then sort by date or price
TaskSchema.index({ category: 1, status: 1, createdAt: -1 });
TaskSchema.index({ category: 1, status: 1, "budget.amount": 1 });
TaskSchema.index({ status: 1, createdAt: -1 });
TaskSchema.index({ status: 1, scheduledDate: 1 });
// Global revision: poster's revisable open tasks
TaskSchema.index({ requesterId: 1, status: 1, currentRevisionRound: 1 }, { name: "requester_status_revision" });
TaskSchema.index({ bookingSource: 1, status: 1 });
TaskSchema.index({ partnerId: 1, status: 1 });
TaskSchema.index({ partnerUid: 1, status: 1 });
TaskSchema.index({ partnerId: 1, bookingSource: 1, status: 1 });
TaskSchema.index({ bookingOrderId: 1 });
TaskSchema.index(
  { parentTaskId: 1, status: 1, recurringVisitId: 1 },
  { name: 'recurring_child_visit_lookup' },
);

const Task: Model<ITask> =
  mongoose.models.Task || mongoose.model<ITask>("Task", TaskSchema);

export default Task;
