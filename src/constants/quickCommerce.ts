/**
 * Quick Commerce auto-assign configuration.
 */

/** Maximum distance (km) from partner location to seller shop for auto-assignment. */
export const QC_SHOP_PROXIMITY_KM = 2.5;

/** Maximum distance (km) from partner location to seller shop for available orders on partner home screen. */
export const QC_AVAILABLE_ORDERS_MAX_DISTANCE_KM = 3.0;

/** Earth radius in km for haversine distance calculation. */
export const EARTH_RADIUS_KM = 6371;

/**
 * Compute Haversine distance in kilometers between two coordinate pairs (lat/lon).
 */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

