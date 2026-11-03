import mongoose from 'mongoose';
import { BadRequestError, NotFoundError } from '../errors/AppError';
import BookNowLocationAvailability, {
  type BookNowLocationType,
} from '../models/BookNowLocationAvailability';
import BookNowServiceLocationAvailability from '../models/BookNowServiceLocationAvailability';
import LocationCity from '../models/LocationCity';
import LocationPincode from '../models/LocationPincode';
import LocationPincodeAreaMap from '../models/LocationPincodeAreaMap';
import ServiceCategory from '../models/ServiceCategory';
import { LocationPricingService } from './LocationPricingService';

type LocationAddress = {
  area?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  pincode?: string;
  coordinates?: [number, number];
  rawAddress?: string;
  line1?: string;
  line2?: string;
};

type LocationCandidate = {
  type: BookNowLocationType;
  id: mongoose.Types.ObjectId;
};

const LOCATION_TYPES: BookNowLocationType[] = ['area', 'pincode', 'city', 'state'];

function isLocationType(value: unknown): value is BookNowLocationType {
  return LOCATION_TYPES.includes(value as BookNowLocationType);
}

function validObjectId(value: unknown, label: string): mongoose.Types.ObjectId {
  const raw = String(value || '');
  if (!mongoose.Types.ObjectId.isValid(raw)) {
    throw new BadRequestError(`Invalid ${label}`);
  }
  return new mongoose.Types.ObjectId(raw);
}

function getLocationName(location: Record<string, any>): string {
  return String(
    location.displayName || location.canonicalName || location.pincode || location.normalizedPincode || location._id,
  );
}

export class BookNowAvailabilityService {
  static async getAvailabilityForAddress(
    address: LocationAddress,
    catalogId?: string,
  ) {
    const selectedCatalogId = catalogId?.trim();
    if (catalogId !== undefined && (!selectedCatalogId || selectedCatalogId.length > 120)) {
      throw new BadRequestError('Invalid catalogId');
    }
    const resolved = await LocationPricingService.resolveAddress({
      ...address,
      pincode: address.pinCode || address.pincode,
      rawAddress: address.rawAddress || address.line1,
    });
    const candidates: LocationCandidate[] = [];
    for (const [type, id] of [
      ['area', resolved.areaId],
      ['pincode', resolved.pincodeId],
      ['city', resolved.cityId],
      ['state', resolved.stateId],
    ] as const) {
      if (id) candidates.push({ type, id });
    }

    const rules = candidates.length
      ? await BookNowLocationAvailability.find({
          $or: candidates.map(({ type, id }) => ({ locationType: type, locationId: id })),
        }).lean()
      : [];
    const ruleByLocation = new Map(
      rules.map((rule) => [`${rule.locationType}:${String(rule.locationId)}`, rule]),
    );
    const matched = candidates.find(({ type, id }) => ruleByLocation.has(`${type}:${String(id)}`));
    const globalRule = matched
      ? ruleByLocation.get(`${matched.type}:${String(matched.id)}`)
      : undefined;
    const globalEnabled = globalRule?.isEnabled ?? false;
    if (selectedCatalogId && globalEnabled) {
      const serviceRules = await BookNowServiceLocationAvailability.find({
        catalogId: selectedCatalogId,
        $or: candidates.map(({ type, id }) => ({ locationType: type, locationId: id })),
      }).lean();
      const serviceRuleByLocation = new Map(
        serviceRules.map((serviceRule) => [
          `${serviceRule.locationType}:${String(serviceRule.locationId)}`,
          serviceRule,
        ]),
      );
      const serviceMatch = candidates.find(({ type, id }) =>
        serviceRuleByLocation.has(`${type}:${String(id)}`),
      );
      if (serviceMatch) {
        const serviceRule = serviceRuleByLocation.get(
          `${serviceMatch.type}:${String(serviceMatch.id)}`,
        )!;
        return {
          isEnabled: serviceRule.isEnabled,
          isExplicit: true,
          locationType: serviceMatch.type,
          locationId: String(serviceMatch.id),
          catalogId: selectedCatalogId,
          message: serviceRule.isEnabled
            ? null
            : 'This service is not available in your area. Please choose another service location.',
        };
      }
    }

    if (!matched) {
      const hasResolvedLocation = candidates.length > 0;
      return {
        isEnabled: globalEnabled,
        isExplicit: false,
        locationType: null,
        locationId: null,
        catalogId: selectedCatalogId || null,
        message: hasResolvedLocation
          ? globalEnabled
            ? null
            : 'Book Now services are not available at this location. Please choose another service location.'
          : 'Book Now services are not available at this location. Please choose another service location.',
      };
    }

    const rule = globalRule!;
    return {
      isEnabled: rule.isEnabled,
      isExplicit: true,
      locationType: matched.type,
      locationId: String(matched.id),
      catalogId: selectedCatalogId || null,
      message: rule.isEnabled
        ? null
        : 'Book Now services are not available at this location. Please choose another service location.',
    };
  }

  static async listLocationAvailabilities(params: {
    search?: string;
    type?: string;
    isEnabled?: boolean;
    catalogId?: string;
  }) {
    if (params.type && !isLocationType(params.type)) {
      throw new BadRequestError('Invalid location type');
    }
    const catalogId = params.catalogId?.trim();
    if (
      params.catalogId !== undefined &&
      (!catalogId || catalogId.length > 120)
    ) {
      throw new BadRequestError('Invalid catalogId');
    }
    const locations = await LocationPricingService.listLocations({
      search: params.search,
      type: params.type,
      isActive: true,
    });
    const rules = await BookNowLocationAvailability.find({}).lean();
    const serviceRules = catalogId
      ? await BookNowServiceLocationAvailability.find({
          catalogId,
        }).lean()
      : [];
    const ruleByLocation = new Map(
      rules.map((rule) => [`${rule.locationType}:${String(rule.locationId)}`, rule]),
    );
    const serviceRuleByLocation = new Map(
      serviceRules.map((rule) => [`${rule.locationType}:${String(rule.locationId)}`, rule]),
    );
    const hiddenLocations = new Set(
      rules
        .filter((rule) => rule.isHidden)
        .map((rule) => `${rule.locationType}:${String(rule.locationId)}`),
    );
    const areaIds = locations
      .filter((location) => location.type === 'area')
      .map((location) => location._id);
    const areaMappings = await LocationPincodeAreaMap.find({ areaId: { $in: areaIds } })
      .select({ areaId: 1, pincodeId: 1 })
      .lean();
    const pincodeIds = [
      ...locations
        .filter((location) => location.type === 'pincode')
        .map((location) => location._id),
      ...areaMappings.map((mapping) => mapping.pincodeId),
    ];
    const pincodes = await LocationPincode.find({
      _id: { $in: pincodeIds },
      isActive: true,
    }).select({ cityId: 1, stateId: 1 }).lean();
    const referencedCityIds = [
      ...locations
        .filter((location) => location.type === 'city')
        .map((location) => location._id),
      ...pincodes.map((pin) => pin.cityId),
    ];
    const cities = await LocationCity.find({ _id: { $in: referencedCityIds } })
      .select({ stateId: 1 })
      .lean();
    const cityById = new Map(cities.map((city) => [String(city._id), city]));
    const pincodeById = new Map(pincodes.map((pin) => [String(pin._id), pin]));
    const areaMappingsById = new Map<string, typeof areaMappings>();
    for (const mapping of areaMappings) {
      const key = String(mapping.areaId);
      const grouped = areaMappingsById.get(key) || [];
      grouped.push(mapping);
      areaMappingsById.set(key, grouped);
    }
    const getRule = (type: BookNowLocationType, id: unknown) =>
      ruleByLocation.get(`${type}:${String(id)}`);
    const getServiceRule = (type: BookNowLocationType, id: unknown) =>
      serviceRuleByLocation.get(`${type}:${String(id)}`);
    const resolvePincode = (pin: (typeof pincodes)[number]) => {
      const candidates: Array<{ type: BookNowLocationType; id: unknown }> = [
        { type: 'pincode', id: pin._id },
        { type: 'city', id: pin.cityId },
        { type: 'state', id: pin.stateId },
      ];
      const matched = candidates.find(({ type, id }) => id && getRule(type, id));
      return {
        isEnabled: matched ? getRule(matched.type, matched.id)!.isEnabled : false,
        source: matched?.type,
        rule: matched ? getRule(matched.type, matched.id) : undefined,
      };
    };
    const resolveServicePincode = (pin: (typeof pincodes)[number]) => {
      const globalAvailability = resolvePincode(pin);
      const candidates: Array<{ type: BookNowLocationType; id: unknown }> = [
        { type: 'pincode', id: pin._id },
        { type: 'city', id: pin.cityId },
        { type: 'state', id: pin.stateId },
      ];
      const matched = candidates.find(({ type, id }) => id && getServiceRule(type, id));
      const categoryRule = matched
        ? getServiceRule(matched.type, matched.id)
        : undefined;
      return {
        isEnabled:
          globalAvailability.isEnabled && (categoryRule ? categoryRule.isEnabled : true),
        categoryEnabled: categoryRule ? categoryRule.isEnabled : true,
        source: categoryRule ? matched?.type : globalAvailability.source,
        rule: categoryRule || globalAvailability.rule,
        categoryRule,
      };
    };

    const items = locations.map((location) => {
      const locationType = location.type as BookNowLocationType;
      const locationId = String(location._id);
      const ownRule = ruleByLocation.get(`${locationType}:${locationId}`);
      const ownServiceRule = getServiceRule(locationType, locationId);
      let inheritedFrom: BookNowLocationType | undefined;
      let inheritedRule: (typeof rules)[number] | undefined;
      let inheritedServiceRule:
        | (typeof serviceRules)[number]
        | undefined;
      let inheritedServiceFrom: BookNowLocationType | undefined;
      let availabilityMode: 'enabled' | 'disabled' | 'mixed' = 'enabled';
      let serviceAvailabilityMode:
        | 'enabled'
        | 'disabled'
        | 'mixed'
        | undefined;
      let serviceAvailabilityEnabled: boolean | undefined;
      let isEnabled = false;
      if (locationType === 'city') {
        const city = cityById.get(locationId);
        const stateRule = city?.stateId ? getRule('state', city.stateId) : undefined;
        inheritedRule = stateRule;
        inheritedFrom = stateRule ? 'state' : undefined;
        const stateServiceRule = city?.stateId
          ? getServiceRule('state', city.stateId)
          : undefined;
        inheritedServiceRule = stateServiceRule;
        inheritedServiceFrom = stateServiceRule ? 'state' : undefined;
      } else if (locationType === 'pincode') {
        const pin = pincodeById.get(locationId);
        const resolved = pin ? resolvePincode(pin) : undefined;
        inheritedRule = resolved?.rule;
        inheritedFrom = resolved?.source;
        const serviceResolved = pin ? resolveServicePincode(pin) : undefined;
        inheritedServiceRule = serviceResolved?.categoryRule;
        inheritedServiceFrom = serviceResolved?.categoryRule
          ? serviceResolved.source
          : undefined;
      } else if (locationType === 'area') {
        const mappings = areaMappingsById.get(locationId) || [];
        const inheritedLocations = mappings
          .map((mapping) => pincodeById.get(String(mapping.pincodeId)))
          .filter((pin): pin is (typeof pincodes)[number] => Boolean(pin))
          .map(resolvePincode);
        if (inheritedLocations.length > 0) {
          const enabledValues = new Set(inheritedLocations.map((item) => item.isEnabled));
          isEnabled = inheritedLocations.some((item) => item.isEnabled);
          availabilityMode = enabledValues.size > 1
            ? 'mixed'
            : isEnabled
              ? 'enabled'
              : 'disabled';
          const sources = new Set(inheritedLocations.map((item) => item.source).filter(Boolean));
          inheritedFrom = sources.size === 1 ? inheritedLocations[0].source : undefined;
          inheritedRule = inheritedLocations.find((item) => item.rule)?.rule;
        }
        const inheritedServiceLocations = mappings
          .map((mapping) => pincodeById.get(String(mapping.pincodeId)))
          .filter((pin): pin is (typeof pincodes)[number] => Boolean(pin))
          .map(resolveServicePincode);
        const serviceEnabledValues = new Set(
          inheritedServiceLocations.map((item) => item.categoryEnabled),
        );
        if (inheritedServiceLocations.length > 0) {
          serviceAvailabilityEnabled = inheritedServiceLocations.some(
            (item) => item.categoryEnabled,
          );
          serviceAvailabilityMode = serviceEnabledValues.size > 1
            ? 'mixed'
            : serviceAvailabilityEnabled
              ? 'enabled'
              : 'disabled';
          inheritedServiceRule = inheritedServiceLocations.find(
            (item) => item.categoryRule,
          )?.categoryRule;
          const sources = new Set(
            inheritedServiceLocations
              .filter((item) => item.categoryRule)
              .map((item) => item.source)
              .filter(Boolean),
          );
          inheritedServiceFrom =
            sources.size === 1
              ? (inheritedServiceLocations.find((item) => item.categoryRule)
                  ?.source as BookNowLocationType | undefined)
              : undefined;
        }
      }
      const rule = ownRule || inheritedRule;
      if (ownRule) {
        isEnabled = ownRule.isEnabled;
        availabilityMode = ownRule.isEnabled ? 'enabled' : 'disabled';
      } else if (locationType === 'city' || locationType === 'pincode') {
        isEnabled = inheritedRule ? inheritedRule.isEnabled : false;
        availabilityMode = isEnabled ? 'enabled' : 'disabled';
      }
      if (catalogId) {
        const serviceRule = ownServiceRule || inheritedServiceRule;
        if (ownServiceRule) {
          isEnabled = isEnabled && ownServiceRule.isEnabled;
          availabilityMode = isEnabled ? 'enabled' : 'disabled';
        } else if (locationType === 'area' && serviceAvailabilityEnabled != null) {
          isEnabled = isEnabled && serviceAvailabilityEnabled;
          availabilityMode = isEnabled
            ? serviceAvailabilityMode || 'enabled'
            : 'disabled';
        } else if (serviceRule) {
          isEnabled = isEnabled && serviceRule.isEnabled;
          availabilityMode = isEnabled ? 'enabled' : 'disabled';
        }
      }

      return {
        _id:
          ownServiceRule || rule
            ? String((ownServiceRule || rule)!._id)
            : `default-${locationType}-${locationId}`,
        locationId,
        locationType,
        displayName: getLocationName(location),
        canonicalName: String(location.canonicalName || location.normalizedKey || getLocationName(location)),
        parentDisplayName:
          locationType === 'city'
            ? String((location.stateId as any)?.displayName || '')
            : locationType === 'pincode'
              ? String((location.cityId as any)?.displayName || '')
              : undefined,
        isEnabled,
        availabilityMode,
        isExplicit: Boolean(ownServiceRule || ownRule),
        inheritedFrom: !ownServiceRule && !ownRule
          ? inheritedServiceFrom || inheritedFrom
          : undefined,
        updatedAt:
          (ownServiceRule || ownRule || inheritedServiceRule || inheritedRule)
            ?.updatedAt,
        updatedBy:
          (ownServiceRule || ownRule || inheritedServiceRule || inheritedRule)
            ?.updatedBy,
        catalogId: catalogId || null,
      };
    });

    return items.filter(
      (item) =>
        !hiddenLocations.has(`${item.locationType}:${item.locationId}`) &&
        (params.isEnabled === undefined || item.isEnabled === params.isEnabled),
    );
  }

  static async setLocationAvailability(params: {
    locationType: BookNowLocationType;
    locationId: string;
    isEnabled: boolean;
    updatedBy: string;
    catalogId?: string;
  }) {
    if (!isLocationType(params.locationType)) throw new BadRequestError('Invalid location type');
    const catalogId = params.catalogId?.trim();
    if (params.catalogId !== undefined && (!catalogId || catalogId.length > 120)) {
      throw new BadRequestError('Invalid catalogId');
    }
    const locationId = validObjectId(params.locationId, 'locationId');
    const locations = await LocationPricingService.listLocations({ type: params.locationType });
    if (!locations.some((location) => String(location._id) === String(locationId) && location.isActive)) {
      throw new NotFoundError('Active location not found');
    }
    if (
      catalogId &&
      !(await ServiceCategory.exists({ slug: catalogId, isActive: true }))
    ) {
      throw new NotFoundError('Active service category not found');
    }
    const rule = catalogId
      ? await BookNowServiceLocationAvailability.findOneAndUpdate(
          {
            locationType: params.locationType,
            locationId,
            catalogId,
          },
          { $set: { isEnabled: params.isEnabled, updatedBy: params.updatedBy } },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        ).lean()
      : await BookNowLocationAvailability.findOneAndUpdate(
          { locationType: params.locationType, locationId },
          { $set: { isEnabled: params.isEnabled, updatedBy: params.updatedBy } },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        ).lean();
    return {
      _id: String(rule?._id),
      locationId: String(locationId),
      locationType: params.locationType,
      isEnabled: params.isEnabled,
      catalogId: catalogId || null,
      availabilityMode: params.isEnabled ? 'enabled' : 'disabled',
      isExplicit: true,
      updatedAt: rule?.updatedAt,
      updatedBy: rule?.updatedBy,
    };
  }

  static async removeLocationFromBookNow(params: {
    locationType: BookNowLocationType;
    locationId: string;
    updatedBy: string;
  }) {
    if (!isLocationType(params.locationType)) throw new BadRequestError('Invalid location type');
    const locationId = validObjectId(params.locationId, 'locationId');
    const locations = await LocationPricingService.listLocations({
      type: params.locationType,
      isActive: true,
    });
    if (!locations.some((location) => String(location._id) === String(locationId))) {
      throw new NotFoundError('Active location not found');
    }

    await BookNowLocationAvailability.findOneAndUpdate(
      { locationType: params.locationType, locationId },
      {
        $set: { isEnabled: false, isHidden: true, updatedBy: params.updatedBy },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    await BookNowServiceLocationAvailability.deleteMany({
      locationType: params.locationType,
      locationId,
    });

    return {
      locationType: params.locationType,
      locationId: String(locationId),
      isEnabled: false,
      isHidden: true,
    };
  }
}
