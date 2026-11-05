import mongoose from 'mongoose';
import HourlyHelperLocationAvailability, {
  LocationType,
} from '../models/HourlyHelperLocationAvailability';
import HourlyHelperSlotSettings from '../models/HourlyHelperSlotSettings';
import LocationState from '../models/LocationState';
import LocationCity from '../models/LocationCity';
import LocationPincode from '../models/LocationPincode';
import LocationArea from '../models/LocationArea';
import { LocationPricingService, normalizeLocationName } from './LocationPricingService';
import { BadRequestError } from '../errors/AppError';
import {
  canonicalServiceAreaName,
  partnerHasHourlyHelperCategory,
  resolvePartnerWorkAreas,
  buildHourlyServiceAreaCandidates,
} from '../utils/hourlyHelperServiceArea';
import { HourlyHelperAvailabilityService } from './HourlyHelperAvailabilityService';
import {
  DEFAULT_HOURLY_SLOT_SETTINGS,
  validateHourlySlotSettings,
  type HourlySlotSettings,
} from '../utils/hourlySlotPolicy';

export type LocationAvailabilityItem = {
  _id: string;
  locationId: string;
  locationType: LocationType;
  displayName: string;
  canonicalName: string;
  parentDisplayName?: string;
  isEnabled: boolean;
  isExplicit: boolean;
  eligibleHelperCount: number;
  slotSettings: HourlySlotSettings;
  updatedAt?: Date;
  updatedBy?: string;
};

export class HourlyHelperLocationAvailabilityService {
  static async setLocationSlotSettings(params: {
    locationType: LocationType;
    locationId: string;
    settings: HourlySlotSettings;
    updatedBy?: string;
  }): Promise<HourlySlotSettings> {
    const locIdStr = String(params.locationId || '').trim();
    if (!locIdStr) throw new BadRequestError('locationId is required');
    let settings: HourlySlotSettings;
    try {
      settings = validateHourlySlotSettings(params.settings);
    } catch (error) {
      throw new BadRequestError(error instanceof Error ? error.message : 'Invalid slot settings');
    }

    const ids: Array<string | mongoose.Types.ObjectId> = [];
    const targetId = mongoose.Types.ObjectId.isValid(locIdStr)
      ? new mongoose.Types.ObjectId(locIdStr)
      : locIdStr;
    ids.push(targetId);
    if (targetId instanceof mongoose.Types.ObjectId) ids.push(locIdStr);
    if (params.locationType === 'area') {
      let displayName = locIdStr;
      if (targetId instanceof mongoose.Types.ObjectId) {
        const area = await LocationArea.findById(targetId).select('displayName canonicalName').lean();
        displayName = area?.displayName || area?.canonicalName || displayName;
        if (area?._id) ids.push(area._id);
      }
      const canonicalName = canonicalServiceAreaName(displayName) || displayName.toLowerCase();
      for (const alias of [displayName, displayName.toLowerCase(), canonicalName]) {
        if (alias) ids.push(alias);
      }
    }

    const uniqueIds = Array.from(new Map(ids.map((id) => [String(id), id])).values());
    const update = {
      mode: settings.mode,
      startTime: settings.startTime,
      endTime: settings.endTime,
      blockedHours: settings.blockedHours,
      updatedBy: params.updatedBy ? String(params.updatedBy).trim() : 'admin',
    };
    for (const locationId of uniqueIds) {
      await HourlyHelperSlotSettings.findOneAndUpdate(
        { locationType: params.locationType, locationId },
        { $set: update },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    return settings;
  }

  static async getSlotSettingsForAddress(input: {
    areaName?: string;
    cityName?: string;
    stateName?: string;
    address?: string;
  }): Promise<HourlySlotSettings> {
    const areaNames = buildHourlyServiceAreaCandidates({
      area: input.areaName,
      city: input.cityName,
      address: input.address,
    });
    const pincode = String(input.address || '').match(/\b\d{6}\b/)?.[0];
    const locationCandidates: Array<{ type: LocationType; name: string }> = [
      ...areaNames.map((name) => ({ type: 'area' as const, name })),
      ...(pincode ? [{ type: 'pincode' as const, name: pincode }] : []),
      ...(input.cityName ? [{ type: 'city' as const, name: input.cityName }] : []),
      ...(input.stateName ? [{ type: 'state' as const, name: input.stateName }] : []),
    ];

    for (const candidate of locationCandidates) {
      const ids: Array<string | mongoose.Types.ObjectId> = [];
      const name = candidate.name.trim();
      const canonical = canonicalServiceAreaName(name);
      ids.push(name, name.toLowerCase());
      if (canonical) ids.push(canonical);
      if (mongoose.Types.ObjectId.isValid(name)) ids.push(new mongoose.Types.ObjectId(name));

      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const masterLocation =
        candidate.type === 'area'
          ? await LocationArea.findOne({
              $or: [
                { displayName: new RegExp(`^${escaped}$`, 'i') },
                { canonicalName: new RegExp(`^${escaped}$`, 'i') },
              ],
            }).select('_id').lean()
          : candidate.type === 'pincode'
            ? await LocationPincode.findOne({ pincode: name }).select('_id').lean()
            : candidate.type === 'city'
              ? await LocationCity.findOne({
                  $or: [
                    { displayName: new RegExp(`^${escaped}$`, 'i') },
                    { canonicalName: new RegExp(`^${escaped}$`, 'i') },
                  ],
                }).select('_id').lean()
              : await LocationState.findOne({
                  $or: [
                    { displayName: new RegExp(`^${escaped}$`, 'i') },
                    { canonicalName: new RegExp(`^${escaped}$`, 'i') },
                  ],
                }).select('_id').lean();
      if (masterLocation?._id) ids.push(masterLocation._id);

      const record = await HourlyHelperSlotSettings.findOne({
        locationType: candidate.type,
        locationId: { $in: Array.from(new Map(ids.map((id) => [String(id), id])).values()) },
      }).lean();
      if (record) {
        return validateHourlySlotSettings({
          mode: record.mode,
          startTime: record.startTime,
          endTime: record.endTime,
          blockedHours: record.blockedHours,
        });
      }
    }
    return DEFAULT_HOURLY_SLOT_SETTINGS;
  }

  /**
   * Toggle or set Hourly Helper availability for a location.
   */
  static async setLocationAvailability(params: {
    locationType: LocationType;
    locationId: string;
    isEnabled: boolean;
    updatedBy?: string;
    notes?: string;
  }): Promise<LocationAvailabilityItem> {
    const locIdStr = String(params.locationId || '').trim();
    if (!locIdStr) throw new BadRequestError('locationId is required');
    const type = params.locationType;

    let locationDoc: any = null;
    let parentName = '';
    let displayName = locIdStr;

    // Check master location collections if locId is a valid ObjectId
    if (mongoose.Types.ObjectId.isValid(locIdStr)) {
      const objId = new mongoose.Types.ObjectId(locIdStr);
      if (type === 'state') {
        locationDoc = await LocationState.findById(objId).lean();
      } else if (type === 'city') {
        locationDoc = await LocationCity.findById(objId).populate('stateId', 'displayName').lean();
        parentName = locationDoc?.stateId?.displayName || '';
      } else if (type === 'pincode') {
        locationDoc = await LocationPincode.findById(objId).populate('cityId', 'displayName').populate('stateId', 'displayName').lean();
        parentName = locationDoc?.cityId?.displayName || locationDoc?.stateId?.displayName || '';
      } else if (type === 'area') {
        locationDoc = await LocationArea.findById(objId).lean();
      }
    }

    if (locationDoc) {
      displayName = locationDoc.displayName || locationDoc.canonicalName || locationDoc.pincode || locIdStr;
    } else {
      displayName = locIdStr.charAt(0).toUpperCase() + locIdStr.slice(1);
    }

    const canonicalName = canonicalServiceAreaName(displayName) || displayName.toLowerCase();

    // If it's an area, also find corresponding LocationArea if not already loaded
    let areaObjId: mongoose.Types.ObjectId | null = null;
    if (type === 'area') {
      if (mongoose.Types.ObjectId.isValid(locIdStr)) {
        areaObjId = new mongoose.Types.ObjectId(locIdStr);
      } else {
        const areaDoc = await LocationArea.findOne({
          $or: [
            { displayName: new RegExp(`^${displayName.trim()}$`, 'i') },
            { canonicalName: new RegExp(`^${canonicalName.trim()}$`, 'i') },
          ],
        }).lean();
        if (areaDoc) {
          areaObjId = areaDoc._id;
          displayName = areaDoc.displayName || displayName;
        }
      }
    }

    const targetLocId = mongoose.Types.ObjectId.isValid(locIdStr)
      ? new mongoose.Types.ObjectId(locIdStr)
      : locIdStr;

    // 1. Update/upsert the primary record
    const updated = await HourlyHelperLocationAvailability.findOneAndUpdate(
      { locationType: type, locationId: targetLocId },
      {
        $set: {
          isEnabled: Boolean(params.isEnabled),
          updatedBy: params.updatedBy ? String(params.updatedBy).trim() : 'system',
          ...(params.notes ? { notes: String(params.notes).trim() } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    // 2. Synchronize all alias records for this area (ObjectId, displayName, canonicalName, lowercases)
    if (type === 'area') {
      const aliasIds: any[] = [];
      if (areaObjId) aliasIds.push(areaObjId);
      if (displayName) aliasIds.push(displayName);
      if (canonicalName && canonicalName !== displayName) aliasIds.push(canonicalName);
      if (displayName.toLowerCase() !== canonicalName && displayName.toLowerCase() !== displayName) {
        aliasIds.push(displayName.toLowerCase());
      }
      if (locIdStr.toLowerCase() !== locIdStr && !aliasIds.includes(locIdStr.toLowerCase())) {
        aliasIds.push(locIdStr.toLowerCase());
      }

      for (const aliasId of aliasIds) {
        await HourlyHelperLocationAvailability.updateOne(
          { locationType: 'area', locationId: aliasId },
          {
            $set: {
              isEnabled: Boolean(params.isEnabled),
              updatedBy: params.updatedBy ? String(params.updatedBy).trim() : 'system',
            },
          },
          { upsert: true },
        );
      }
    }

    const helpers = await HourlyHelperAvailabilityService.findEligibleHelpers([canonicalName]);
    const storedSlotSettings = await HourlyHelperSlotSettings.findOne({
      locationType: type,
      locationId: { $in: [targetLocId, locIdStr, displayName, canonicalName] },
    }).lean();

    return {
      _id: String(updated._id),
      locationId: locIdStr,
      locationType: type,
      displayName,
      canonicalName,
      parentDisplayName: parentName || undefined,
      isEnabled: updated.isEnabled,
      isExplicit: true,
      eligibleHelperCount: helpers.length,
      slotSettings: storedSlotSettings
        ? {
            mode: storedSlotSettings.mode,
            startTime: storedSlotSettings.startTime,
            endTime: storedSlotSettings.endTime,
            blockedHours: storedSlotSettings.blockedHours,
          }
        : DEFAULT_HOURLY_SLOT_SETTINGS,
      updatedAt: updated.updatedAt,
      updatedBy: updated.updatedBy,
    };
  }

  /**
   * Remove Hourly Helper availability configuration for a location.
   * Safety guarantee: only removes the availability configuration in
   * HourlyHelperLocationAvailability. Existing pricing rules, SKUs, helper configs,
   * confirmed bookings and ongoing tasks remain strictly untouched.
   * After removal, the location reverts to unconfigured and displays "Coming Soon".
   */
  static async removeLocationAvailability(params: {
    locationType: LocationType;
    locationId: string;
  }): Promise<{ removedCount: number }> {
    const locIdStr = String(params.locationId || '').trim();
    if (!locIdStr) throw new BadRequestError('locationId is required');
    const type = params.locationType;

    const idsToDelete: any[] = [locIdStr];
    if (mongoose.Types.ObjectId.isValid(locIdStr)) {
      idsToDelete.push(new mongoose.Types.ObjectId(locIdStr));
    }

    if (type === 'area') {
      let displayName = locIdStr;
      if (mongoose.Types.ObjectId.isValid(locIdStr)) {
        const areaDoc = await LocationArea.findById(new mongoose.Types.ObjectId(locIdStr)).lean();
        if (areaDoc) {
          displayName = areaDoc.displayName || areaDoc.canonicalName || locIdStr;
        }
      }
      const canonicalName = canonicalServiceAreaName(displayName) || displayName.toLowerCase();

      // Find any LocationArea records matching this area
      const areas = await LocationArea.find({
        $or: [
          { displayName: new RegExp(`^${displayName.trim()}$`, 'i') },
          { canonicalName: new RegExp(`^${canonicalName.trim()}$`, 'i') },
        ],
      }).lean();

      for (const a of areas) {
        idsToDelete.push(a._id);
        if (a.displayName) idsToDelete.push(a.displayName);
        if (a.canonicalName) idsToDelete.push(a.canonicalName);
      }

      idsToDelete.push(displayName);
      idsToDelete.push(canonicalName);
      if (displayName.toLowerCase() !== canonicalName) {
        idsToDelete.push(displayName.toLowerCase());
      }
      if (locIdStr.toLowerCase() !== locIdStr) {
        idsToDelete.push(locIdStr.toLowerCase());
      }
    }

    const uniqueIds = Array.from(new Set(idsToDelete));
    const result = await HourlyHelperLocationAvailability.deleteMany({
      locationType: type,
      locationId: { $in: uniqueIds },
    });

    return { removedCount: result.deletedCount || 0 };
  }

  /**
   * Extract all unique partner work areas from approved active partner profiles.
   */
  static async getAllPartnerHourlyWorkAreas(): Promise<Array<{ name: string; canonical: string }>> {
    try {
      const profiles = await mongoose.connection
        .collection('profiles')
        .find(
          {
            isActive: true,
            'partnerProfile.status': 'approved',
          },
          {
            projection: {
              partnerProfile: 1,
              helperWorkAreas: 1,
            },
          },
        )
        .toArray();

      const areaMap = new Map<string, string>(); // canonical -> displayName
      for (const p of profiles) {
        const record = p as Record<string, unknown>;
        const partnerProfile = (record.partnerProfile as Record<string, unknown> | undefined) || {};
        if (!partnerHasHourlyHelperCategory(partnerProfile.categories)) continue;

        const areas = resolvePartnerWorkAreas(record);
        if (Array.isArray(areas)) {
          for (const a of areas) {
            const rawName = String(
              typeof a === 'object' && a ? (a as any).name || (a as any).canonicalName || (a as any).displayName : a || '',
            ).trim();
            const canonical = canonicalServiceAreaName(rawName);
            if (rawName && canonical && canonical.length >= 3 && !areaMap.has(canonical)) {
              const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
              areaMap.set(canonical, formattedName);
            }
          }
        }
      }

      return Array.from(areaMap.entries()).map(([canonical, name]) => ({ canonical, name }));
    } catch (err) {
      return [];
    }
  }

  /**
   * List location availability items merged with canonical master locations AND partner work areas.
   */
  static async listLocationAvailabilities(params: {
    search?: string;
    type?: LocationType;
    isEnabled?: boolean;
  }): Promise<LocationAvailabilityItem[]> {
    // 1. Gather all active partner hourly work areas
    const partnerWorkAreas = await HourlyHelperLocationAvailabilityService.getAllPartnerHourlyWorkAreas();

    // 2. Gather all explicit overrides in HourlyHelperLocationAvailability
    const allExplicitRecords = await HourlyHelperLocationAvailability.find({}).lean();
    const allSlotSettings = await HourlyHelperSlotSettings.find({}).lean();
    const slotSettingsMap = new Map<string, HourlySlotSettings>();
    for (const setting of allSlotSettings) {
      const id = String(setting.locationId);
      const canonical = canonicalServiceAreaName(id);
      const normalized = {
        mode: setting.mode,
        startTime: setting.startTime,
        endTime: setting.endTime,
        blockedHours: setting.blockedHours,
      };
      slotSettingsMap.set(`${setting.locationType}:${id}`, normalized);
      slotSettingsMap.set(`${setting.locationType}:${id.toLowerCase()}`, normalized);
      if (canonical) slotSettingsMap.set(`${setting.locationType}:${canonical}`, normalized);
    }
    const explicitMap = new Map<string, typeof allExplicitRecords[0]>();

    for (const rec of allExplicitRecords) {
      const locIdStr = String(rec.locationId);
      const canon = canonicalServiceAreaName(locIdStr);
      explicitMap.set(`${rec.locationType}:${locIdStr}`, rec);
      explicitMap.set(`${rec.locationType}:${locIdStr.toLowerCase()}`, rec);
      if (canon) explicitMap.set(`${rec.locationType}:${canon}`, rec);
    }

    const seenCanonicals = new Set<string>();
    const unifiedLocations: Array<{
      idStr: string;
      type: LocationType;
      displayName: string;
      canonicalName: string;
      parentName?: string;
      explicitRecord?: typeof allExplicitRecords[0];
    }> = [];

    // Push partner work areas first (unique by canonical name)
    if (!params.type || params.type === 'area') {
      for (const pArea of partnerWorkAreas) {
        if (seenCanonicals.has(pArea.canonical)) continue;
        seenCanonicals.add(pArea.canonical);

        if (params.search) {
          const searchNorm = normalizeLocationName(params.search);
          if (!pArea.canonical.includes(searchNorm) && !pArea.name.toLowerCase().includes(searchNorm)) {
            continue;
          }
        }

        // Check if there is an explicit record for this area by canonical name
        const explicitRec = explicitMap.get(`area:${pArea.canonical}`) || explicitMap.get(`area:${pArea.name}`);

        unifiedLocations.push({
          idStr: explicitRec ? String(explicitRec.locationId) : pArea.name,
          type: 'area',
          displayName: pArea.name,
          canonicalName: pArea.canonical,
          parentName: 'Hyderabad',
          explicitRecord: explicitRec,
        });
      }
    }

    // Push explicit records from DB that are not yet included
    for (const rec of allExplicitRecords) {
      const locIdStr = String(rec.locationId);
      let displayName = locIdStr;
      let parentName = 'Hyderabad';

      if (mongoose.Types.ObjectId.isValid(locIdStr)) {
        const objId = new mongoose.Types.ObjectId(locIdStr);
        if (rec.locationType === 'area') {
          const aDoc = await LocationArea.findById(objId).lean();
          if (aDoc) displayName = aDoc.displayName || aDoc.canonicalName || locIdStr;
        } else if (rec.locationType === 'city') {
          const cDoc = await LocationCity.findById(objId).populate('stateId', 'displayName').lean();
          if (cDoc) {
            displayName = cDoc.displayName || cDoc.canonicalName || locIdStr;
            parentName = (cDoc as any).stateId?.displayName || parentName;
          }
        } else if (rec.locationType === 'pincode') {
          const pDoc = await LocationPincode.findById(objId).populate('cityId', 'displayName').lean();
          if (pDoc) {
            displayName = pDoc.pincode || locIdStr;
            parentName = (pDoc as any).cityId?.displayName || parentName;
          }
        }
      }

      const canonicalName = canonicalServiceAreaName(displayName) || displayName.toLowerCase();
      const canonKey = `${rec.locationType}:${canonicalName}`;

      if (seenCanonicals.has(canonKey) || seenCanonicals.has(canonicalName)) {
        continue;
      }

      if (params.type && params.type !== rec.locationType) continue;

      if (params.search) {
        const searchNorm = normalizeLocationName(params.search);
        if (!canonicalName.includes(searchNorm) && !displayName.toLowerCase().includes(searchNorm)) {
          continue;
        }
      }

      seenCanonicals.add(canonKey);
      seenCanonicals.add(canonicalName);

      unifiedLocations.push({
        idStr: locIdStr,
        type: rec.locationType,
        displayName: displayName.charAt(0).toUpperCase() + displayName.slice(1),
        canonicalName,
        parentName,
        explicitRecord: rec,
      });
    }

    // Only if a specific search is typed in the search box, allow searching canonical master locations
    if (params.search && params.search.trim().length > 0) {
      const canonicalLocations = await LocationPricingService.listLocations({
        search: params.search,
        type: params.type,
      });
      for (const loc of canonicalLocations) {
        const type = loc.type as LocationType;
        const idStr = String(loc._id);
        const displayName = loc.displayName || loc.canonicalName || loc.pincode || idStr;
        const canonicalName = canonicalServiceAreaName(displayName) || displayName.toLowerCase();
        const canonKey = `${type}:${canonicalName}`;

        if (seenCanonicals.has(canonKey) || seenCanonicals.has(canonicalName)) continue;
        seenCanonicals.add(canonKey);
        seenCanonicals.add(canonicalName);

        let parentName = '';
        if (type === 'city' && loc.stateId) {
          parentName = typeof loc.stateId === 'object' ? loc.stateId.displayName || '' : '';
        } else if (type === 'pincode') {
          parentName = typeof loc.cityId === 'object' ? loc.cityId.displayName || '' : '';
        }

        unifiedLocations.push({
          idStr,
          type,
          displayName,
          canonicalName,
          parentName: parentName || 'Hyderabad',
        });
      }
    }

    if (unifiedLocations.length === 0) return [];

    const locationsToCount = unifiedLocations.filter((loc) => {
      const key = `${loc.type}:${loc.idStr}`;
      const keyLower = `${loc.type}:${loc.idStr.toLowerCase()}`;
      const keyCanon = `${loc.type}:${loc.canonicalName}`;
      const rec = loc.explicitRecord || explicitMap.get(key) || explicitMap.get(keyLower) || explicitMap.get(keyCanon);
      return params.isEnabled === undefined || (rec ? rec.isEnabled : false) === params.isEnabled;
    });
    const helperCounts = await HourlyHelperAvailabilityService.countEligibleHelpersByArea(
      locationsToCount.map((loc) => loc.canonicalName),
    );

    const items: LocationAvailabilityItem[] = [];

    for (const loc of locationsToCount) {
      const key = `${loc.type}:${loc.idStr}`;
      const keyLower = `${loc.type}:${loc.idStr.toLowerCase()}`;
      const keyCanon = `${loc.type}:${loc.canonicalName}`;
      const rec = loc.explicitRecord || explicitMap.get(key) || explicitMap.get(keyLower) || explicitMap.get(keyCanon);
      const isEnabled = rec ? rec.isEnabled : false; // Enable-only: default is false

      items.push({
        _id: rec ? String(rec._id) : `default-${key}`,
        locationId: loc.idStr,
        locationType: loc.type,
        displayName: loc.displayName,
        canonicalName: loc.canonicalName,
        parentDisplayName: loc.parentName || undefined,
        isEnabled,
        isExplicit: Boolean(rec),
        eligibleHelperCount: helperCounts.get(canonicalServiceAreaName(loc.canonicalName)) || 0,
        slotSettings:
          slotSettingsMap.get(`${loc.type}:${loc.idStr}`) ||
          slotSettingsMap.get(`${loc.type}:${loc.idStr.toLowerCase()}`) ||
          slotSettingsMap.get(`${loc.type}:${loc.canonicalName}`) ||
          DEFAULT_HOURLY_SLOT_SETTINGS,
        updatedAt: rec?.updatedAt,
        updatedBy: rec?.updatedBy,
      });
    }

    // Sort by explicit overrides first, then eligible helper count descending, then by name
    return items.sort((a, b) => {
      if (a.isExplicit !== b.isExplicit) {
        return a.isExplicit ? -1 : 1;
      }
      if (b.eligibleHelperCount !== a.eligibleHelperCount) {
        return b.eligibleHelperCount - a.eligibleHelperCount;
      }
      return a.displayName.localeCompare(b.displayName);
    });
  }

  /**
   * Hierarchy Precedence Evaluation:
   * Area -> Pincode -> City -> State -> Default (false / Enable-Only)
   * Only locations explicitly enabled in the Operations Portal return true.
   * Disabled, removed, and unconfigured locations return false ("Coming Soon").
   */
  static async isHourlyHelperEnabledForAddress(input: {
    areaId?: unknown;
    pincodeId?: unknown;
    cityId?: unknown;
    stateId?: unknown;
    areaName?: string;
    cityName?: string;
    stateName?: string;
    address?: string;
  }): Promise<boolean> {
    const candidates: Array<{ locationType: LocationType; locationId: string | mongoose.Types.ObjectId }> = [];

    const push = (locationType: LocationType, rawId?: unknown) => {
      const val = String(rawId ?? '').trim();
      if (!val) return;
      candidates.push({ locationType, locationId: val });
      const canon = canonicalServiceAreaName(val);
      if (canon && canon !== val) candidates.push({ locationType, locationId: canon });
      const lower = val.toLowerCase();
      if (lower !== val && lower !== canon) candidates.push({ locationType, locationId: lower });
      if (mongoose.Types.ObjectId.isValid(val)) candidates.push({ locationType, locationId: new mongoose.Types.ObjectId(val) });
    };

    push('area', input.areaId);

    // Collect all candidate area names (explicit areaName, plus any named areas from formatted address)
    const areaNameCandidates = new Set<string>();
    if (input.areaName) areaNameCandidates.add(input.areaName);

    if (input.address) {
      const extracted = buildHourlyServiceAreaCandidates({
        area: input.areaName,
        city: input.cityName,
        address: input.address,
      });
      for (const item of extracted) {
        areaNameCandidates.add(item);
      }
    }

    const areaLookups = Array.from(areaNameCandidates, async (aName) => {
      push('area', aName);
      const canon = canonicalServiceAreaName(aName);
      if (canon && canon !== aName) push('area', canon);

      try {
        return await LocationArea.find({
          $or: [
            { displayName: new RegExp(`^${aName.trim()}$`, 'i') },
            { canonicalName: new RegExp(`^${(canon || aName).trim()}$`, 'i') },
          ],
        }).select('_id').lean();
      } catch {
        return [];
      }
    });

    push('pincode', input.pincodeId);
    push('city', input.cityId);
    let cityLookup: Promise<Array<{ _id: mongoose.Types.ObjectId }>> = Promise.resolve([]);
    if (input.cityName) {
      push('city', input.cityName);
      cityLookup = LocationCity.find({
          $or: [
            { displayName: new RegExp(`^${input.cityName.trim()}$`, 'i') },
            { canonicalName: new RegExp(`^${input.cityName.toLowerCase().trim()}$`, 'i') },
          ],
        }).select('_id').lean().catch(() => []);
    }
    push('state', input.stateId);
    let stateLookup: Promise<Array<{ _id: mongoose.Types.ObjectId }>> = Promise.resolve([]);
    if (input.stateName) {
      push('state', input.stateName);
      stateLookup = LocationState.find({
          $or: [
            { displayName: new RegExp(`^${input.stateName.trim()}$`, 'i') },
            { canonicalName: new RegExp(`^${input.stateName.toLowerCase().trim()}$`, 'i') },
          ],
        }).select('_id').lean().catch(() => []);
    }

    const [areaDocs, cityDocs, stateDocs] = await Promise.all([
      Promise.all(areaLookups),
      cityLookup,
      stateLookup,
    ]);
    for (const doc of areaDocs.flat()) push('area', doc._id);
    for (const doc of cityDocs) push('city', doc._id);
    for (const doc of stateDocs) push('state', doc._id);

    if (candidates.length === 0) return false; // Enable-only: no location candidates = Coming Soon

    const queryPairs = candidates.map((c) => ({
      locationType: c.locationType,
      locationId: c.locationId,
    }));

    const dbRecords = await HourlyHelperLocationAvailability.find({
      $or: queryPairs,
    }).lean();

    const recordMap = new Map<string, boolean>();
    for (const rec of dbRecords) {
      const locIdStr = String(rec.locationId);
      const canon = canonicalServiceAreaName(locIdStr);
      recordMap.set(`${rec.locationType}:${locIdStr}`, rec.isEnabled);
      recordMap.set(`${rec.locationType}:${locIdStr.toLowerCase()}`, rec.isEnabled);
      if (canon) recordMap.set(`${rec.locationType}:${canon}`, rec.isEnabled);
    }

    // Evaluate in order of hierarchy (Area -> Pincode -> City -> State)
    // For Area: if ANY candidate record is explicitly false, it is disabled!
    const areaCandidates = candidates.filter((c) => c.locationType === 'area');
    for (const cand of areaCandidates) {
      const key = `${cand.locationType}:${String(cand.locationId)}`;
      if (recordMap.has(key) && recordMap.get(key) === false) {
        return false;
      }
    }
    for (const cand of areaCandidates) {
      const key = `${cand.locationType}:${String(cand.locationId)}`;
      if (recordMap.has(key) && recordMap.get(key) === true) {
        return true;
      }
    }

    // For other types (Pincode -> City -> State)
    for (const cand of candidates.filter((c) => c.locationType !== 'area')) {
      const key = `${cand.locationType}:${String(cand.locationId)}`;
      if (recordMap.has(key)) {
        return recordMap.get(key)!;
      }
    }

    return false; // Enable-Only Selected Locations: unconfigured locations return false ("Coming Soon")
  }
}
