import mongoose from 'mongoose';
import { BadRequestError, NotFoundError } from '../errors/AppError';
import LocationArea from '../models/LocationArea';
import PostCompareLocationAvailability from '../models/PostCompareLocationAvailability';
import { normalizeLocationName } from './LocationPricingService';
import { resolveTaskAreaForCreate } from '../utils/resolveTaskArea';

const POST_COMPARE_UNAVAILABLE_CODE = 'POST_COMPARE_AREA_UNAVAILABLE';

export type PostCompareAvailabilityItem = {
  areaId: string;
  canonicalName: string;
  displayName: string;
  isEnabled: boolean;
  isExplicit: boolean;
  updatedAt?: Date;
  updatedBy?: string;
};

type TaskLocationInput = {
  address?: unknown;
  area?: unknown;
  taskArea?: unknown;
  city?: unknown;
  line2?: unknown;
  addressDetails?: { area?: unknown };
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isHourlyHelperTask(taskData: Record<string, any>): boolean {
  return (
    taskData.categorySlug === 'hourly-helper' ||
    taskData.categorySlug === 'hourly-based'
  );
}

function areaNameCandidates(taskData: Record<string, any>): string[] {
  const location: TaskLocationInput =
    taskData.location && typeof taskData.location === 'object'
      ? taskData.location
      : { address: taskData.location };
  const explicitNames = [
    location.taskArea,
    taskData.taskArea,
    location.area,
    location.addressDetails?.area,
    location.line2,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const addressArea = resolveTaskAreaForCreate({
    address: String(location.address || ''),
    city: String(location.city || taskData.city || ''),
  });
  const candidates = [...explicitNames, addressArea].filter(Boolean);
  return Array.from(new Set(candidates));
}

async function resolveCanonicalArea(taskData: Record<string, any>) {
  for (const candidate of areaNameCandidates(taskData)) {
    const normalizedKey = normalizeLocationName(candidate);
    if (!normalizedKey) continue;
    const escapedCandidate = escapeRegExp(candidate);
    const area = await LocationArea.findOne({
      isActive: true,
      $or: [
        { normalizedKey },
        { canonicalName: new RegExp(`^${escapedCandidate}$`, 'i') },
        { displayName: new RegExp(`^${escapedCandidate}$`, 'i') },
        { aliases: new RegExp(`^${escapedCandidate}$`, 'i') },
      ],
    }).lean();
    if (area) return area;
  }
  return null;
}

export class PostCompareLocationAvailabilityService {
  static async listAreaAvailabilities(search?: string): Promise<PostCompareAvailabilityItem[]> {
    const normalizedSearch = String(search || '').trim();
    const areaFilter: Record<string, unknown> = { isActive: true };
    if (normalizedSearch) {
      const pattern = new RegExp(escapeRegExp(normalizedSearch), 'i');
      areaFilter.$or = [
        { canonicalName: pattern },
        { displayName: pattern },
        { normalizedKey: pattern },
        { aliases: pattern },
      ];
    }

    const areas = await LocationArea.find(areaFilter).sort({ displayName: 1 }).lean();
    if (areas.length === 0) return [];

    const records = await PostCompareLocationAvailability.find({
      areaId: { $in: areas.map((area) => area._id) },
    }).lean();
    const recordsByAreaId = new Map(records.map((record) => [String(record.areaId), record]));

    return areas.map((area) => {
      const record = recordsByAreaId.get(String(area._id));
      return {
        areaId: String(area._id),
        canonicalName: area.canonicalName,
        displayName: area.displayName,
        isEnabled: record?.isEnabled === true,
        isExplicit: Boolean(record),
        updatedAt: record?.updatedAt,
        updatedBy: record?.updatedBy,
      };
    });
  }

  static async setAreaAvailability(params: {
    areaId: string;
    isEnabled: boolean;
    updatedBy?: string;
  }): Promise<PostCompareAvailabilityItem> {
    const areaId = String(params.areaId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(areaId)) {
      throw new BadRequestError('A valid areaId is required');
    }

    const areaObjectId = new mongoose.Types.ObjectId(areaId);
    const area = await LocationArea.findOne({ _id: areaObjectId, isActive: true }).lean();
    if (!area) throw new NotFoundError('Active canonical area not found');

    const update = {
      $set: {
        isEnabled: params.isEnabled,
        updatedBy: String(params.updatedBy || '').trim() || 'admin',
      },
    };
    let record;
    try {
      record = await PostCompareLocationAvailability.findOneAndUpdate(
        { areaId: areaObjectId },
        update,
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
      ).lean();
    } catch (error) {
      if ((error as { code?: number })?.code !== 11000) throw error;
      record = await PostCompareLocationAvailability.findOneAndUpdate(
        { areaId: areaObjectId },
        update,
        { new: true, runValidators: true },
      ).lean();
    }

    if (!record) throw new Error('Failed to persist Post & Compare area availability');
    return {
      areaId: String(area._id),
      canonicalName: area.canonicalName,
      displayName: area.displayName,
      isEnabled: record.isEnabled,
      isExplicit: true,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy,
    };
  }

  static async assertTaskAreaEnabled(taskData: Record<string, any>): Promise<void> {
    if (isHourlyHelperTask(taskData)) return;

    const area = await resolveCanonicalArea(taskData);
    if (!area) {
      throw new BadRequestError(
        'Post & Compare is unavailable because this work location does not resolve to a supported area.',
        POST_COMPARE_UNAVAILABLE_CODE,
      );
    }

    const record = await PostCompareLocationAvailability.findOne({ areaId: area._id }).lean();
    if (!record?.isEnabled) {
      throw new BadRequestError(
        'Post & Compare is not enabled in this area.',
        POST_COMPARE_UNAVAILABLE_CODE,
      );
    }
  }
}
