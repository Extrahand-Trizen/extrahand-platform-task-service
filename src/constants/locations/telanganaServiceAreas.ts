/**
 * Telangana districts where Post a Task and Book Now are always serviceable,
 * regardless of live helper count.
 *
 * Keep in sync with shared/extrahand-locations/telanganaServiceAreas.ts
 */

export type TelanganaServiceArea = {
  district: string;
  city: string;
  aliases?: string[];
};

export const TELANGANA_SERVICE_AREAS: readonly TelanganaServiceArea[] = [
  { district: 'Adilabad', city: 'Adilabad' },
  { district: 'Bhadradri Kothagudem', city: 'Kothagudem', aliases: ['bhadradri kothagudem'] },
  { district: 'Hanumakonda', city: 'Hanumakonda', aliases: ['hanamkonda', 'hanumakonda'] },
  { district: 'Hyderabad', city: 'Hyderabad' },
  { district: 'Jagtial', city: 'Jagtial' },
  { district: 'Jangaon', city: 'Jangaon' },
  { district: 'Jayashankar Bhupalpally', city: 'Bhupalpally', aliases: ['jayashankar bhupalapally', 'bhupalapally'] },
  { district: 'Jogulamba Gadwal', city: 'Gadwal', aliases: ['jogulamba gadwal'] },
  { district: 'Kamareddy', city: 'Kamareddy', aliases: ['kamareddy', 'kamareddi'] },
  { district: 'Karimnagar', city: 'Karimnagar' },
  { district: 'Khammam', city: 'Khammam' },
  { district: 'Kumuram Bheem Asifabad', city: 'Asifabad', aliases: ['kumuram bheem asifabad', 'komaram bheem asifabad'] },
  { district: 'Mahabubabad', city: 'Mahabubabad', aliases: ['mahbubabad'] },
  { district: 'Mahabubnagar', city: 'Mahabubnagar', aliases: ['mahbubnagar'] },
  { district: 'Mancherial', city: 'Mancherial' },
  { district: 'Medak', city: 'Medak' },
  { district: 'Medchal-Malkajgiri', city: 'Shamirpet', aliases: ['medchal malkajgiri', 'medchal', 'malkajgiri'] },
  { district: 'Mulugu', city: 'Mulugu' },
  { district: 'Nagarkurnool', city: 'Nagarkurnool' },
  { district: 'Nalgonda', city: 'Nalgonda' },
  { district: 'Narayanpet', city: 'Narayanpet' },
  { district: 'Nirmal', city: 'Nirmal' },
  { district: 'Nizamabad', city: 'Nizamabad' },
  { district: 'Peddapalli', city: 'Peddapalli' },
  { district: 'Rajanna Sircilla', city: 'Sircilla', aliases: ['rajanna sircilla'] },
  { district: 'Rangareddy', city: 'Shamshabad', aliases: ['ranga reddy', 'rangareddy', 'ranga reddy district'] },
  { district: 'Sangareddy', city: 'Sangareddy' },
  { district: 'Siddipet', city: 'Siddipet' },
  { district: 'Suryapet', city: 'Suryapet' },
  { district: 'Vikarabad', city: 'Vikarabad' },
  { district: 'Wanaparthy', city: 'Wanaparthy' },
  { district: 'Warangal', city: 'Warangal' },
  { district: 'Yadadri Bhuvanagiri', city: 'Bhuvanagiri', aliases: ['yadadri bhuvanagiri', 'yadadri'] },
] as const;
