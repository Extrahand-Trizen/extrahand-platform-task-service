/** Centroid coordinates for Hyderabad partner work areas (Book Now dispatch + visibility). */
export const HYDERABAD_WORK_AREA_COORDS: ReadonlyArray<{
  area: string;
  lat: number;
  lng: number;
}> = [
  { area: 'Yapral', lat: 17.5147, lng: 78.5369 },
  { area: 'Sainikpuri', lat: 17.4988, lng: 78.5446 },
  { area: 'Secunderabad', lat: 17.4399, lng: 78.4983 },
  { area: 'Malkajgiri', lat: 17.4478, lng: 78.5382 },
  { area: 'Alwal', lat: 17.5023, lng: 78.5085 },
  { area: 'Tarnaka', lat: 17.4278, lng: 78.5284 },
  { area: 'Uppal', lat: 17.4056, lng: 78.5594 },
  { area: 'LB Nagar', lat: 17.3457, lng: 78.5522 },
  { area: 'Kukatpally', lat: 17.4849, lng: 78.4074 },
  { area: 'Ameerpet', lat: 17.4375, lng: 78.4482 },
  { area: 'Moti Nagar', lat: 17.4532, lng: 78.4215 },
  { area: 'Madhapur', lat: 17.4483, lng: 78.3915 },
  { area: 'Gachibowli', lat: 17.4401, lng: 78.3489 },
  { area: 'Hitec City', lat: 17.4435, lng: 78.3772 },
  { area: 'Begumpet', lat: 17.4448, lng: 78.4661 },
  { area: 'Koti', lat: 17.385, lng: 78.4867 },
  { area: 'Banjara Hills', lat: 17.4156, lng: 78.4347 },
  { area: 'Jubilee Hills', lat: 17.4319, lng: 78.4071 },
];

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Same 6 km radius used by BookNowAutoAssignService nearby-area expansion. */
export const BOOK_NOW_WORK_AREA_PROXIMITY_KM = 6;

export function findNearestHyderabadWorkArea(
  lat: number,
  lng: number,
  maxKm = BOOK_NOW_WORK_AREA_PROXIMITY_KM,
): string | null {
  let best: { area: string; distKm: number } | null = null;

  for (const wa of HYDERABAD_WORK_AREA_COORDS) {
    const distKm = haversineKm(lat, lng, wa.lat, wa.lng);
    if (distKm > maxKm) continue;
    if (!best || distKm < best.distKm) {
      best = { area: wa.area, distKm };
    }
  }

  return best?.area ?? null;
}
