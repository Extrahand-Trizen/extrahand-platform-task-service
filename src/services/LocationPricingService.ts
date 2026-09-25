import mongoose from 'mongoose';
import LocationState from '../models/LocationState';
import LocationCity from '../models/LocationCity';
import LocationPincode from '../models/LocationPincode';
import LocationArea from '../models/LocationArea';
import LocationCityPincodeMap from '../models/LocationCityPincodeMap';
import LocationPincodeAreaMap from '../models/LocationPincodeAreaMap';
import HourlySkuLocationPrice, { HourlyLocationType } from '../models/HourlySkuLocationPrice';
import ServiceSku from '../models/ServiceSku';
import { BadRequestError, ConflictError, NotFoundError } from '../errors/AppError';

export function normalizeLocationName(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-IN')
    .replace(/[.,/\\_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type LocationPriceCandidate = {
  locationType: HourlyLocationType;
  locationId: string;
};

export function buildLocationPriceCandidateOrder(input: {
  areaId?: unknown;
  pincodeId?: unknown;
  cityId?: unknown;
  areaName?: string;
  cityName?: string;
}): LocationPriceCandidate[] {
  const seen = new Set<string>();
  const push = (locationType: HourlyLocationType, rawId?: unknown) => {
    const value = String(rawId ?? '').trim();
    if (!value) return;
    const key = `${locationType}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    return { locationType, locationId: value };
  };

  const candidates: LocationPriceCandidate[] = [];
  const areaCandidate = push('area', input.areaId);
  if (areaCandidate) candidates.push(areaCandidate);

  const pincodeCandidate = push('pincode', input.pincodeId);
  if (pincodeCandidate) candidates.push(pincodeCandidate);

  const cityCandidate = push('city', input.cityId);
  if (cityCandidate) candidates.push(cityCandidate);

  const areaName = normalizeLocationName(input.areaName || '');
  const cityName = normalizeLocationName(input.cityName || '');
  if (areaName && cityName && areaName === cityName && !input.areaId && input.cityId) {
    const sameNameCity = push('city', input.cityId);
    if (sameNameCity) {
      const sameNameIndex = candidates.findIndex((candidate) => candidate.locationType === 'city' && candidate.locationId === sameNameCity.locationId);
      if (sameNameIndex >= 0) {
        candidates.splice(sameNameIndex, 1);
      }
      candidates.splice(1, 0, sameNameCity);
    }
  }

  return candidates;
}

function objectId(value: unknown, label: string): mongoose.Types.ObjectId {
  if (!mongoose.Types.ObjectId.isValid(String(value || ''))) throw new BadRequestError(`Invalid ${label}`);
  return new mongoose.Types.ObjectId(String(value));
}

function pincode(value: unknown): string {
  const normalized = String(value || '').replace(/\D/g, '');
  if (!/^[1-9][0-9]{5}$/.test(normalized)) throw new BadRequestError('Pincode must be a valid 6-digit Indian pincode');
  return normalized;
}

function activeWindowFilter(now = new Date()) {
  return {
    isActive: true,
    $and: [
      { $or: [{ effectiveFrom: null }, { effectiveFrom: { $exists: false } }, { effectiveFrom: { $lte: now } }] },
      { $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gt: now } }] },
    ],
  };
}

export class LocationPricingService {
  static async ensureCanonicalLocation(body: any) {
    const stateName = String(body.state || '').trim();
    const cityName = String(body.city || '').trim();
    const areaName = String(body.area || '').trim();
    const pincodeValue = body.pincode ? pincode(body.pincode) : '';

    if (!stateName) throw new BadRequestError('State is required for a canonical location');
    if (!cityName) throw new BadRequestError('City is required for a canonical location');

    const stateKey = normalizeLocationName(stateName);
    const state = await LocationState.findOneAndUpdate(
      { normalizedKey: stateKey },
      {
        $setOnInsert: {
          canonicalName: stateName,
          displayName: stateName,
          normalizedKey: stateKey,
          countryCode: String(body.countryCode || 'IN').toUpperCase(),
          isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    const cityKey = normalizeLocationName(cityName);
    const city = await LocationCity.findOneAndUpdate(
      { stateId: state._id, normalizedKey: cityKey },
      {
        $setOnInsert: {
          stateId: state._id,
          canonicalName: cityName,
          displayName: cityName,
          normalizedKey: cityKey,
          aliases: [cityName],
          isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    let pin: any = null;
    if (pincodeValue) {
      pin = await LocationPincode.findOneAndUpdate(
        { normalizedPincode: pincodeValue },
        {
          $setOnInsert: {
            pincode: pincodeValue,
            normalizedPincode: pincodeValue,
            stateId: state._id,
            cityId: city._id,
            isActive: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      await LocationCityPincodeMap.findOneAndUpdate(
        { cityId: city._id, pincodeId: pin._id },
        { $setOnInsert: { cityId: city._id, pincodeId: pin._id, isPrimary: true } },
        { upsert: true, setDefaultsOnInsert: true },
      );
    }

    let area: any = null;
    if (areaName) {
      const areaKey = normalizeLocationName(areaName);
      area = await LocationArea.findOneAndUpdate(
        { normalizedKey: areaKey },
        {
          $setOnInsert: {
            canonicalName: areaName,
            displayName: areaName,
            normalizedKey: areaKey,
            aliases: [areaName],
            isActive: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      if (pin) {
        await LocationPincodeAreaMap.findOneAndUpdate(
          { pincodeId: pin._id, areaId: area._id },
          { $setOnInsert: { pincodeId: pin._id, areaId: area._id, isPrimary: true } },
          { upsert: true, setDefaultsOnInsert: true },
        );
      }
    }

    const canonical = area || pin || city;
    const locationType = area ? 'area' : pin ? 'pincode' : 'city';
    return {
      ...canonical,
      type: locationType,
      stateId: state._id,
      cityId: city._id,
      pincodeId: pin?._id || null,
      areaId: area?._id || null,
      provider: body.provider || 'google',
      providerPlaceId: body.providerPlaceId || null,
      formattedAddress: body.formattedAddress || body.rawAddress || null,
      area: areaName || null,
      city: cityName,
      state: stateName,
      country: body.country || 'India',
      pincode: pincodeValue || null,
      latitude: Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : null,
      longitude: Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : null,
    };
  }

  static async listLocations(params: { search?: string; type?: string; stateId?: string; cityId?: string; isActive?: boolean }) {
    const search = normalizeLocationName(params.search);
    const active = params.isActive === undefined ? undefined : params.isActive;
    const results: any[] = [];
    const common = active === undefined ? {} : { isActive: active };
    const regex = search ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : undefined;
    const types = params.type ? [params.type] : ['state', 'city', 'pincode', 'area'];

    if (types.includes('state')) results.push(...await LocationState.find({ ...common, ...(regex ? { $or: [{ canonicalName: regex }, { displayName: regex }, { normalizedKey: regex }] } : {}) }).sort({ displayName: 1 }).lean());
    if (types.includes('city')) results.push(...await LocationCity.find({ ...common, ...(params.stateId ? { stateId: objectId(params.stateId, 'stateId') } : {}), ...(regex ? { $or: [{ canonicalName: regex }, { displayName: regex }, { aliases: regex }] } : {}) }).populate('stateId', 'displayName canonicalName').sort({ displayName: 1 }).lean());
    if (types.includes('pincode')) results.push(...await LocationPincode.find({ ...common, ...(params.stateId ? { stateId: objectId(params.stateId, 'stateId') } : {}), ...(params.cityId ? { cityId: objectId(params.cityId, 'cityId') } : {}), ...(search ? { normalizedPincode: search.replace(/\D/g, '') } : {}) }).populate('stateId', 'displayName').populate('cityId', 'displayName').sort({ normalizedPincode: 1 }).lean());
    if (types.includes('area')) results.push(...await LocationArea.find({ ...common, ...(regex ? { $or: [{ canonicalName: regex }, { displayName: regex }, { aliases: regex }] } : {}) }).sort({ displayName: 1 }).lean());
    return results.map((item) => ({ ...item, type: item.countryCode ? 'state' : item.normalizedPincode ? 'pincode' : item.stateId ? 'city' : 'area' }));
  }

  static async createLocation(type: string, body: any) {
    if (type === 'state') {
      const normalizedKey = normalizeLocationName(body.canonicalName);
      if (!normalizedKey) throw new BadRequestError('canonicalName is required');
      return LocationState.create({ ...body, normalizedKey, displayName: String(body.displayName || body.canonicalName).trim() });
    }
    if (type === 'city') {
      const stateId = objectId(body.stateId, 'stateId');
      const normalizedKey = normalizeLocationName(body.canonicalName);
      if (!await LocationState.exists({ _id: stateId })) throw new NotFoundError('State not found');
      if (await LocationCity.exists({ stateId, normalizedKey })) throw new ConflictError('City already exists under this state');
      return LocationCity.create({ ...body, stateId, normalizedKey, displayName: String(body.displayName || body.canonicalName).trim(), aliases: body.aliases || [] });
    }
    if (type === 'pincode') {
      const value = pincode(body.pincode);
      const stateId = objectId(body.stateId, 'stateId');
      const cityId = objectId(body.cityId, 'cityId');
      if (!await LocationState.exists({ _id: stateId, isActive: true })) throw new NotFoundError('Active state not found');
      if (!await LocationCity.exists({ _id: cityId, stateId, isActive: true })) throw new NotFoundError('Active city/state relationship not found');
      if (await LocationPincode.exists({ normalizedPincode: value })) throw new ConflictError('Pincode already exists');
      const created = await LocationPincode.create({ pincode: value, normalizedPincode: value, stateId, cityId, isActive: body.isActive !== false });
      await LocationCityPincodeMap.create({ cityId, pincodeId: created._id, isPrimary: true });
      return created;
    }
    if (type === 'area') {
      const normalizedKey = normalizeLocationName(body.canonicalName);
      if (!normalizedKey) throw new BadRequestError('canonicalName is required');
      if (await LocationArea.exists({ normalizedKey })) throw new ConflictError('Area already exists');
      const pincodeIds = Array.isArray(body.pincodeIds) ? body.pincodeIds.map((id: string) => objectId(id, 'pincodeId')) : [];
      const existing = await LocationPincode.countDocuments({ _id: { $in: pincodeIds }, isActive: true });
      if (existing !== pincodeIds.length) throw new BadRequestError('One or more pincodes are invalid or inactive');
      const created = await LocationArea.create({ ...body, normalizedKey, displayName: String(body.displayName || body.canonicalName).trim(), aliases: body.aliases || [] });
      if (pincodeIds.length) await LocationPincodeAreaMap.insertMany(pincodeIds.map((pincodeId: mongoose.Types.ObjectId, index: number) => ({ pincodeId, areaId: created._id, isPrimary: index === 0 })), { ordered: true });
      return created;
    }
    throw new BadRequestError('Unsupported location type');
  }

  static async updateLocation(type: string, id: string, body: any) {
    const locationId = objectId(id, 'locationId');
    const model: any = type === 'state' ? LocationState : type === 'city' ? LocationCity : type === 'pincode' ? LocationPincode : type === 'area' ? LocationArea : null;
    if (!model) throw new BadRequestError('Unsupported location type');
    const update: any = {};
    if (body.displayName !== undefined) update.displayName = String(body.displayName).trim();
    if (body.isActive !== undefined) update.isActive = Boolean(body.isActive);
    if (body.aliases !== undefined && (type === 'city' || type === 'area')) update.aliases = body.aliases.map(String);
    if (body.canonicalName !== undefined && type !== 'pincode') update.canonicalName = String(body.canonicalName).trim(), update.normalizedKey = normalizeLocationName(body.canonicalName);
    const result = await model.findByIdAndUpdate(locationId, { $set: update }, { new: true }).lean();
    if (!result) throw new NotFoundError('Location not found');
    return result;
  }

  static async setLocationActive(type: string, id: string, isActive: boolean) {
    return this.updateLocation(type, id, { isActive });
  }

  static async listHourlySkus() {
    return ServiceSku.find({ pricingUnit: 'hourly' }).sort({ durationMinutes: 1, name: 1 }).lean();
  }

  static async listHourlyPrices(skuId?: string) {
    const query: any = {};
    if (skuId) query.skuId = objectId(skuId, 'skuId');
    return HourlySkuLocationPrice.find(query).sort({ skuId: 1, locationType: 1 }).lean();
  }

  static async createHourlyPrice(body: any) {
    const skuObjectId = objectId(body.skuId, 'skuId');
    const locationObjectId = objectId(body.locationId, 'locationId');
    const locationType = String(body.locationType) as HourlyLocationType;
    if (!['area', 'pincode', 'city'].includes(locationType)) throw new BadRequestError('Invalid locationType');
    const offerPrice = Number(body.offerPrice);
    if (!Number.isFinite(offerPrice) || offerPrice < 0) throw new BadRequestError('offerPrice must be a non-negative number');
    const sku = await ServiceSku.findOne({ _id: skuObjectId, pricingUnit: 'hourly', isActive: true }).lean();
    if (!sku) throw new NotFoundError('Active hourly SKU not found');
    const locationExists = locationType === 'area'
      ? await LocationArea.exists({ _id: locationObjectId, isActive: true })
      : locationType === 'city'
        ? await LocationCity.exists({ _id: locationObjectId, isActive: true })
        : await LocationPincode.exists({ _id: locationObjectId, isActive: true });
    if (!locationExists) throw new NotFoundError('Active location not found');
    if (await HourlySkuLocationPrice.exists({ skuId: skuObjectId, locationType, locationId: locationObjectId })) throw new ConflictError('Pricing rule already exists for this SKU and location');
    return HourlySkuLocationPrice.create({ skuId: skuObjectId, locationType, locationId: locationObjectId, offerPrice, isActive: body.isActive !== false, effectiveFrom: body.effectiveFrom || undefined, effectiveTo: body.effectiveTo || undefined, version: 1 });
  }

  static async updateHourlyPrice(id: string, body: any) {
    const priceId = objectId(id, 'pricingId');
    const update: any = {};
    if (body.offerPrice !== undefined) {
      const offerPrice = Number(body.offerPrice);
      if (!Number.isFinite(offerPrice) || offerPrice < 0) throw new BadRequestError('offerPrice must be a non-negative number');
      update.offerPrice = offerPrice;
    }
    if (body.isActive !== undefined) update.isActive = Boolean(body.isActive);
    if (body.effectiveFrom !== undefined) update.effectiveFrom = body.effectiveFrom || null;
    if (body.effectiveTo !== undefined) update.effectiveTo = body.effectiveTo || null;
    update.$inc = { version: 1 };
    const result = await HourlySkuLocationPrice.findByIdAndUpdate(priceId, update, { new: true }).lean();
    if (!result) throw new NotFoundError('Pricing rule not found');
    return result;
  }

  static async resolveHourlyPrice(body: any) {
    const skuId = objectId(body.skuId, 'skuId');
    const sku = await ServiceSku.findOne({ _id: skuId, pricingUnit: 'hourly', isActive: true }).lean();
    if (!sku) throw new NotFoundError('Active hourly SKU not found');

    const locationIds = buildLocationPriceCandidateOrder({
      areaId: body.areaId,
      pincodeId: body.pincodeId,
      cityId: body.cityId,
      areaName: body.areaName || body.area || body.addressDetails?.area,
      cityName: body.cityName || body.city || body.addressDetails?.city,
    }).filter((item) => mongoose.Types.ObjectId.isValid(item.locationId));

    const directCandidates = locationIds.map((item) => ({
      locationType: item.locationType,
      locationId: new mongoose.Types.ObjectId(item.locationId),
    }));

    const sameNameFallback: Array<{ locationType: HourlyLocationType; locationId: mongoose.Types.ObjectId }> = [];
    const cityId = body.cityId && mongoose.Types.ObjectId.isValid(String(body.cityId)) ? new mongoose.Types.ObjectId(String(body.cityId)) : null;
    const areaId = body.areaId && mongoose.Types.ObjectId.isValid(String(body.areaId)) ? new mongoose.Types.ObjectId(String(body.areaId)) : null;
    if (cityId) {
      const city = await LocationCity.findById(cityId).lean();
      if (city) {
        const cityKey = normalizeLocationName(city.canonicalName || city.displayName || city.normalizedKey || '');
        if (cityKey) {
          const areaMatch = await LocationArea.findOne({ isActive: true, normalizedKey: cityKey }).lean();
          if (areaMatch && (!areaId || String(areaMatch._id) !== String(areaId))) {
            sameNameFallback.push({ locationType: 'area', locationId: areaMatch._id as mongoose.Types.ObjectId });
          }
        }
      }
    }
    if (areaId) {
      const area = await LocationArea.findById(areaId).lean();
      if (area) {
        const areaKey = normalizeLocationName(area.canonicalName || area.displayName || area.normalizedKey || '');
        if (areaKey) {
          const cityMatch = await LocationCity.findOne({ isActive: true, normalizedKey: areaKey }).lean();
          if (cityMatch && (!cityId || String(cityMatch._id) !== String(cityId))) {
            sameNameFallback.push({ locationType: 'city', locationId: cityMatch._id as mongoose.Types.ObjectId });
          }
        }
      }
    }

    const orderedCandidates = [...directCandidates, ...sameNameFallback.filter((candidate) => !directCandidates.some((item) => String(item.locationId) === String(candidate.locationId) && item.locationType === candidate.locationType))];

    for (const item of orderedCandidates) {
      const rule = await HourlySkuLocationPrice.findOne({ skuId, locationType: item.locationType, locationId: item.locationId, ...activeWindowFilter() }).sort({ version: -1 }).lean();
      if (rule) return { skuId: sku._id, basePrice: sku.basePrice, effectiveOfferPrice: rule.offerPrice, pricingSource: item.locationType, locationType: item.locationType, locationId: rule.locationId, pricingRuleId: rule._id, version: rule.version };
    }
    const basePrice = Number(sku.basePrice || 0);
    const globalOffer = Number(sku.offerPrice || 0);
    const effectiveOfferPrice = globalOffer > 0 && globalOffer !== basePrice ? Math.round(globalOffer) : basePrice;
    return { skuId: sku._id, basePrice, effectiveOfferPrice, pricingSource: 'global', locationType: null, locationId: null, pricingRuleId: null, version: null };
  }

  static async resolveHourlyPriceForAddress(params: { skuId: unknown; address?: any }) {
    const address = params.address || {};
    const resolved = await this.resolveAddress({
      area: address.area || address.addressDetails?.area || address.line2,
      pincode: address.pinCode || address.pincode || address.addressDetails?.pinCode,
      city: address.city || address.addressDetails?.city,
      state: address.state || address.addressDetails?.state,
      coordinates: address.coordinates,
      rawAddress: address.rawAddress || address.displayAddress || address.fullAddress || address.line1 || address.address || address.formattedAddress,
    });
    const pricing = await this.resolveHourlyPrice({
      skuId: params.skuId,
      areaId: resolved.areaId,
      pincodeId: resolved.pincodeId,
      cityId: resolved.cityId,
    });
    return { ...pricing, resolvedLocation: resolved };
  }

  static async resolveAddress(body: any) {
    let value = '';
    try {
      if (body.pincode || body.pinCode || body.addressDetails?.pinCode) {
        value = pincode(body.pincode || body.pinCode || body.addressDetails?.pinCode);
      }
    } catch {
      value = '';
    }

    const stateName = body.state || body.addressDetails?.state;
    const cityName = body.city || body.addressDetails?.city;
    const areaName = body.area || body.addressDetails?.area || body.line2 || body.addressDetails?.line1;

    let stateId: mongoose.Types.ObjectId | null = body.stateId && mongoose.Types.ObjectId.isValid(String(body.stateId)) ? new mongoose.Types.ObjectId(String(body.stateId)) : null;
    if (!stateId && stateName) {
      const state = await LocationState.findOne({ normalizedKey: normalizeLocationName(stateName), isActive: true }).lean();
      stateId = state?._id || null;
    }

    let pin = value ? await LocationPincode.findOne({ normalizedPincode: value, isActive: true }).lean() : null;
    if (!pin && body.cityId && mongoose.Types.ObjectId.isValid(String(body.cityId))) {
      const city = await LocationCity.findOne({ _id: body.cityId, isActive: true }).lean();
      if (!city) throw new NotFoundError('City not found');
      pin = null;
    }

    let cityId: mongoose.Types.ObjectId | null = body.cityId && mongoose.Types.ObjectId.isValid(String(body.cityId)) ? new mongoose.Types.ObjectId(String(body.cityId)) : null;
    if (!cityId && cityName) {
      const cityKey = normalizeLocationName(cityName);
      const city = await LocationCity.findOne({
        isActive: true,
        ...(stateId ? { stateId } : {}),
        $or: [
          { normalizedKey: cityKey },
          { aliases: new RegExp(`^${cityKey}$`, 'i') },
        ],
      }).lean();
      cityId = city?._id || null;
      if (city?.stateId && !stateId) {
        stateId = city.stateId as any;
      }
    }

    // Fallback 1: If city was not matched by cityName, try matching areaName against LocationCity
    if (!cityId && areaName) {
      const areaKey = normalizeLocationName(areaName);
      const cityFromArea = await LocationCity.findOne({
        isActive: true,
        ...(stateId ? { stateId } : {}),
        $or: [
          { normalizedKey: areaKey },
          { aliases: new RegExp(`^${areaKey}$`, 'i') },
        ],
      }).lean();
      if (cityFromArea) {
        cityId = cityFromArea._id;
        if (cityFromArea.stateId && !stateId) {
          stateId = cityFromArea.stateId as any;
        }
      }
    }

    // Fallback 2: Check rawAddress / displayAddress for known active cities
    if (!cityId) {
      const rawText = normalizeLocationName(body.rawAddress || body.displayAddress || body.address || body.formattedAddress || '');
      if (rawText) {
        const allActiveCities = await LocationCity.find({ isActive: true, ...(stateId ? { stateId } : {}) }).lean();
        for (const c of allActiveCities) {
          const cKey = c.normalizedKey || normalizeLocationName(c.canonicalName);
          if (cKey && rawText.includes(cKey)) {
            cityId = c._id;
            if (c.stateId && !stateId) {
              stateId = c.stateId as any;
            }
            break;
          }
        }
      }
    }

    const resolvedCityId = cityId || pin?.cityId || null;
    const resolvedStateId = stateId || pin?.stateId || null;

    let areaId: mongoose.Types.ObjectId | null = body.areaId && mongoose.Types.ObjectId.isValid(String(body.areaId)) ? new mongoose.Types.ObjectId(String(body.areaId)) : null;
    if (!areaId && areaName) {
      const key = normalizeLocationName(areaName);
      const area = await LocationArea.findOne({ isActive: true, $or: [{ normalizedKey: key }, { aliases: new RegExp(`^${key}$`, 'i') }] }).lean();
      if (area) {
        areaId = area._id;
      } else if (pin) {
        const mapping = await LocationPincodeAreaMap.findOne({ pincodeId: pin._id, areaId: { $in: await LocationArea.find({ isActive: true, $or: [{ normalizedKey: key }, { aliases: new RegExp(`^${key}$`, 'i') }] }, { _id: 1 }).lean().then((items) => items.map((item) => item._id)) } }).lean();
        areaId = mapping?.areaId || null;
      }
    }

    // Fallback: Check if cityName matches an Area (e.g. Madhapur or Uppal passed as city)
    if (!areaId && cityName) {
      const cityKey = normalizeLocationName(cityName);
      const areaFromCity = await LocationArea.findOne({ isActive: true, $or: [{ normalizedKey: cityKey }, { aliases: new RegExp(`^${cityKey}$`, 'i') }] }).lean();
      if (areaFromCity) {
        areaId = areaFromCity._id;
      }
    }

    return {
      stateId: resolvedStateId,
      cityId: resolvedCityId,
      pincodeId: pin?._id || null,
      areaId,
      coordinates: body.coordinates || null,
      displayAddress: body.rawAddress || body.address || null,
      confidence: pin ? (areaId ? 'high' : 'medium') : resolvedCityId ? (areaId ? 'high' : 'medium') : 'low',
      source: pin ? 'pincode' : resolvedCityId ? 'city' : 'unresolved',
      resolverVersion: '1',
      resolvedAt: new Date().toISOString(),
    };
  }
}
