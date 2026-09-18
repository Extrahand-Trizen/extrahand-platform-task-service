import mongoose, { Schema } from 'mongoose';

interface PreferredAssignmentPartner {
  profileId: string;
  uid: string;
  name: string;
  phone?: string;
  categories: string[];
  areas: string[];
  priority: number;
  active: boolean;
}

interface AreaAssignmentRule {
  area: string;
  zone: string;
  workTypes: string[];
  preferredPartners: PreferredAssignmentPartner[];
  active: boolean;
}

interface AssignmentManagementRulesDocument extends mongoose.Document {
  key: string;
  preferredPartners: PreferredAssignmentPartner[];
  preferredPartnerCursor: number;
  areaRules: AreaAssignmentRule[];
  excludedPhones: string[];
}

const PreferredPartnerSchema = new Schema<PreferredAssignmentPartner>(
  {
    profileId: { type: String, required: true },
    uid: { type: String, required: true },
    name: { type: String, required: true },
    phone: String,
    categories: { type: [String], default: [] },
    areas: { type: [String], default: [] },
    priority: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { _id: false },
);

const AreaAssignmentRuleSchema = new Schema<AreaAssignmentRule>(
  {
    area: { type: String, required: true },
    zone: { type: String, default: 'Custom Zone' },
    workTypes: { type: [String], default: ['hourly'] },
    preferredPartners: { type: [PreferredPartnerSchema], default: [] },
    active: { type: Boolean, default: true },
  },
  { _id: false },
);

const AssignmentManagementRulesSchema = new Schema<AssignmentManagementRulesDocument>(
  {
    key: { type: String, unique: true },
    preferredPartners: { type: [PreferredPartnerSchema], default: [] },
    preferredPartnerCursor: { type: Number, default: 0 },
    areaRules: { type: [AreaAssignmentRuleSchema], default: [] },
    excludedPhones: { type: [String], default: [] },
  },
  { timestamps: true },
);

export default mongoose.model<AssignmentManagementRulesDocument>(
  'AssignmentManagementRules',
  AssignmentManagementRulesSchema,
);
