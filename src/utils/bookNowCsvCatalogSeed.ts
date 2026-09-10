import fs from 'fs';
import path from 'path';

const CDN_IMAGE_BASE = 'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images';

function cdnImage(name: string): string {
  return `${CDN_IMAGE_BASE}/${name}.webp`;
}

function uploadedCategoryImage(fileName: string): string {
  return `${CDN_IMAGE_BASE}/${encodeURIComponent(fileName)}`;
}

function slugify(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function imageIdentity(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function carpentryPackageImageFileName(packageName: string): string {
  return `${String(packageName || '').replace(/\//g, '').trim()}.png`;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value.trim());
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i += 1;
      }
      row.push(value.trim());
      value = '';
      if (row.some((cell) => cell !== '')) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    value += char;
  }

  if (value || row.length > 0) {
    row.push(value.trim());
    if (row.some((cell) => cell !== '')) {
      rows.push(row);
    }
  }

  return rows;
}

function resolveCsvPath(): string {
  const candidates = [
    path.resolve(process.cwd(), '../ADPT4EH/Booknow services and prices(Sheet1).csv'),
    path.resolve(process.cwd(), '../../ADPT4EH/Booknow services and prices(Sheet1).csv'),
    path.resolve(__dirname, '../../../ADPT4EH/Booknow services and prices(Sheet1).csv'),
    path.resolve(__dirname, '../../../../ADPT4EH/Booknow services and prices(Sheet1).csv'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Booknow services and prices(Sheet1).csv not found');
}

function parsePrice(value: string): number {
  const cleaned = String(value || '')
    .replace(/[^\d.]/g, '')
    .trim();
  if (!cleaned) {
    return 0;
  }
  return Math.round(Number(cleaned));
}

function parseDurationMinutes(label: string): number {
  const normalized = String(label || '')
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .trim();

  if (!normalized) {
    return 30;
  }

  const range = normalized.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  const single = normalized.match(/(\d+(?:\.\d+)?)/);
  const base = range
    ? (Number(range[1]) + Number(range[2])) / 2
    : single
      ? Number(single[1])
      : 0;

  if (normalized.includes('day')) {
    return Math.max(15, Math.round(base * 480));
  }

  if (normalized.includes('hr') || normalized.includes('hour')) {
    return Math.max(15, Math.round(base * 60));
  }

  if (normalized.includes('min')) {
    return Math.max(15, Math.round(base));
  }

  if (normalized.includes('pickup')) {
    return 60;
  }

  return Math.max(15, Math.round(base || 30));
}

type CsvItem = {
  name: string;
  offerPrice: number;
  originalPrice: number;
  durationLabel: string;
  durationMinutes: number;
};

type RawSection = {
  title: string;
  items: CsvItem[];
};

type BeautyCsvItem = CsvItem & {
  serviceLabel: string;
};

const PAINTING_PLACEHOLDER_IMAGE = cdnImage('general-home-cleaning');
const CAR_WASH_PLACEHOLDER_IMAGE = cdnImage('sofa-booknow');
const LAUNDRY_PLACEHOLDER_IMAGE = cdnImage('wachingmachinecheckup-booknow');

const PEST_CONTROL_PACKAGE_IMAGE_URLS: Record<string, string[]> = {
  'pest-control-ant-control::ant-control-kitchen-only': [
    uploadedCategoryImage('AntControl–KitchenOnly.png'),
  ],
  'pest-control-ant-control::ant-control-kitchen-1-bedroom': [
    uploadedCategoryImage('AntControl–Kitchen+1Bedroom.png'),
  ],
  'pest-control-ant-control::ant-control-kitchen-2-bedrooms': [
    uploadedCategoryImage('AntControl–Kitchen+2Bedrooms.png'),
  ],
  'pest-control-ant-control::ant-control-kitchen-3-bedrooms': [
    uploadedCategoryImage('AntControl–Kitchen+3Bedrooms.png'),
  ],
  'pest-control-ant-control::ant-control-1-bhk': [
    uploadedCategoryImage('AntControl–1BHK.png'),
  ],
  'pest-control-ant-control::ant-control-2-bhk': [
    uploadedCategoryImage('AntControl–2BHK.png'),
  ],
  'pest-control-ant-control::ant-control-3-bhk-villa': [
    uploadedCategoryImage('AntControl–3+BHKVilla.png'),
  ],
  'pest-control-bed-bug-control::bed-bug-control-1-bhk': [
    uploadedCategoryImage('BedBugControl–1BHK.png'),
  ],
  'pest-control-bed-bug-control::bed-bug-control-2-bhk': [
    uploadedCategoryImage('BedBugControl–2BHK.png'),
  ],
  'pest-control-bed-bug-control::bed-bug-control-3-bhk-villa': [
    uploadedCategoryImage('BedBugControl–3+BHK-Villa.png'),
  ],
  'pest-control-cockroach-control::cockroach-control-kitchen-only': [
    uploadedCategoryImage('CockroachControl–KitchenOnly.png'),
  ],
  'pest-control-cockroach-control::cockroach-control-kitchen-1-bedroom': [
    uploadedCategoryImage('CockroachControl–Kitchen-1Bedroom.png'),
  ],
  'pest-control-cockroach-control::cockroach-control-kitchen-2-bedrooms': [
    uploadedCategoryImage('CockroachControl–Kitchen-2Bedrooms.png'),
  ],
  'pest-control-cockroach-control::cockroach-control-kitchen-3-bedrooms': [
    uploadedCategoryImage('CockroachControl–Kitchen-3Bedrooms.png'),
  ],
  'pest-control-cockroach-control::cockroach-control-1-bhk': [
    uploadedCategoryImage('CockroachControl–1BHK.png'),
  ],
  'pest-control-cockroach-control::cockroach-control-2-bhk': [
    uploadedCategoryImage('CockroachControl–2BHK.png'),
  ],
  'pest-control-cockroach-control::cockroach-control-3-bhk-villa': [
    uploadedCategoryImage('CockroachControl–3+BHK-Villa.png'),
  ],
};

const ELECTRICIAN_PACKAGE_IMAGE_URLS: Record<string, string[]> = {
  'electrician-switch-and-socket::switch-and-socket-switch-replacement': [uploadedCategoryImage('Switch&Socket–SwitchReplacement.png')],
  'electrician-switch-and-socket::switch-and-socket-socket-replacement': [uploadedCategoryImage('Switch&Socket–SocketReplacement.png')],
  'electrician-switch-and-socket::switch-and-socket-2-pin-plug-replacement': [uploadedCategoryImage('Switch&Socket–2-PinPlugReplacement.png')],
  'electrician-switch-and-socket::switch-and-socket-3-pin-plug-replacement': [uploadedCategoryImage('Switch&Socket–3-PinPlugReplacement.png')],
  'electrician-switchboard::switchboard-repair': [uploadedCategoryImage('Switchboard–Repair.png')],
  'electrician-switchboard::switchboard-replacement': [uploadedCategoryImage('Switchboard–Replacement.png')],
  'electrician-switchboard::switchboard-installation': [uploadedCategoryImage('Switchboard–Installation.png')],
  'electrician-switchboard::switchboard-ac-switchboard-installation': [uploadedCategoryImage('Switchboard–AC-SwitchboardInstallation.png')],
  'electrician-fan::fan-repair': [uploadedCategoryImage('Fan–Repair.png')],
  'electrician-fan::fan-regulator-replacement': [uploadedCategoryImage('Fan–RegulatorReplacement.png')],
  'electrician-fan::fan-regular-ceiling-fan-installation': [uploadedCategoryImage('Fan–RegularCeilingFanInstallation.png')],
  'electrician-fan::fan-wall-fan-installation': [uploadedCategoryImage('Fan–WallFanInstallation.png')],
  'electrician-fan::fan-exhaust-fan-installation': [uploadedCategoryImage('Fan–ExhaustFanInstallation.png')],
  'electrician-fan::fan-decorative-ceiling-fan-installation': [uploadedCategoryImage('Fan–DecorativeCeilingFanInstallation.png')],
  'electrician-fan::fan-ceiling-fan-replacement': [uploadedCategoryImage('Fan–CeilingFanReplacement.png')],
  'electrician-light::light-bulb-replacement': [uploadedCategoryImage('Light–BulbReplacement.png')],
  'electrician-light::light-bulb-holder-installation': [uploadedCategoryImage('Light–BulbHolderInstallation.png')],
  'electrician-light::light-tube-light-installation-replacement': [uploadedCategoryImage('Light–TubeLightInstallation-Replacement.png')],
  'electrician-light::light-ceiling-panel-light-installation': [uploadedCategoryImage('Light–CeilingPanellightInstallation.png')],
  'electrician-light::light-wall-light-installation': [uploadedCategoryImage('Light–WallLightInstallation.png')],
  'electrician-light::light-fancy-light-installation': [uploadedCategoryImage('Light–FancyLightInstallation.png')],
  'electrician-light::light-hanging-light-installation': [uploadedCategoryImage('Light–HangingLightInstallation.png')],
  'electrician-wiring::wiring-internal-wiring-up-to-5-m': [uploadedCategoryImage('Wiring–InternalWiring(upto5m).png')],
  'electrician-wiring::wiring-external-wiring-without-casing-up-to-5-m': [uploadedCategoryImage('Wiring–ExternalWiringwithoutCasing(upto5m).png')],
  'electrician-wiring::wiring-external-wiring-with-casing-up-to-5-m': [uploadedCategoryImage('Wiring–ExternalWiringwithCasing(upto5m).png')],
  'electrician-doorbell::doorbell-installation': [uploadedCategoryImage('Doorbell–Installation.png')],
  'electrician-doorbell::doorbell-replacement': [uploadedCategoryImage('Doorbell – Replacement.png')],
  'electrician-mcb-and-fuse::mcb-and-fuse-mcb-replacement-1-pole': [uploadedCategoryImage('MCB&Fuse–MCBReplacement(1Pole).png')],
  'electrician-mcb-and-fuse::mcb-and-fuse-mcb-replacement-2-pole': [uploadedCategoryImage('MCB & Fuse – MCB Replacement (2 Pole).png')],
  'electrician-mcb-and-fuse::mcb-and-fuse-mcb-replacement-4-pole': [uploadedCategoryImage('MCB & Fuse – MCB Replacement (4 Pole).png')],
  'electrician-mcb-and-fuse::mcb-and-fuse-mcb-installation-1-pole': [uploadedCategoryImage('MCB & Fuse – MCB Installation (1 Pole).png')],
  'electrician-mcb-and-fuse::mcb-and-fuse-mcb-installation-2-pole': [uploadedCategoryImage('MCB & Fuse – MCB Installation (2 Pole).png')],
  'electrician-mcb-and-fuse::mcb-and-fuse-fuse-replacement': [uploadedCategoryImage('MCB & Fuse – Fuse Replacement.png')],
  'electrician-submeter-installation::submeter-installation': [uploadedCategoryImage('Submeter Installation.png')],
  'electrician-tv-installation::tv-installation-up-to-48-inches': [uploadedCategoryImage('TV Installation – Up to 48 inches.png')],
  'electrician-tv-installation::tv-installation-above-48-inches': [uploadedCategoryImage('TV Installation – Above 48 inches.png')],
  'electrician-tv-uninstallation::tv-uninstallation-up-to-48-inches': [uploadedCategoryImage('TV Uninstallation – Up to 48 inches.png')],
  'electrician-tv-uninstallation::tv-uninstallation-above-48-inches': [uploadedCategoryImage('TV Uninstallation – Above 48 inches.png')],
  'electrician-home-theatre-installation::home-theatre-installation': [uploadedCategoryImage('HomeTheatreInstallation.png')],
  'electrician-soundbar-installation::soundbar-installation': [uploadedCategoryImage('Soundbar Installation.png')],
  'electrician-inverter::inverter-checkup': [uploadedCategoryImage('Inverter – Checkup.png')],
  'electrician-inverter::inverter-service': [uploadedCategoryImage('Inverter – Service.png')],
  'electrician-inverter::inverter-fuse-replacement': [uploadedCategoryImage('Inverter – Fuse Replacement.png')],
  'electrician-inverter::inverter-single-battery-installation': [uploadedCategoryImage('Inverter – Single Battery Installation.png')],
  'electrician-inverter::inverter-double-battery-installation': [uploadedCategoryImage('Inverter – Double Battery Installation.png')],
  'electrician-inverter::inverter-uninstallation': [uploadedCategoryImage('Inverter – Uninstallation.png')],
  'electrician-stabilizer-installation::stabilizer-installation': [uploadedCategoryImage('Stabilizer Installation.png')],
};

const BEAUTY_PACKAGE_IMAGE_URLS: Record<string, string[]> = {
  'womens-beauty::d-tan-face-and-neck': [uploadedCategoryImage('D-Tan – Face & Neck.png')],
  'womens-beauty::gold-facial': [uploadedCategoryImage('Gold Facial.png')],
  'womens-beauty::o3-shine-and-glow-facial': [uploadedCategoryImage('O3 Shine & Glow Facial.png')],
  'womens-beauty::full-face-threading': [uploadedCategoryImage('Full Face Threading.png')],
  'womens-beauty::half-leg-waxing': [uploadedCategoryImage('Half Leg Waxing.png')],
  'womens-beauty::full-arms-waxing': [uploadedCategoryImage('Full Arms Waxing.png')],
  'womens-beauty::basic-manicure': [uploadedCategoryImage('Basic Manicure.png')],
  'womens-beauty::basic-pedicure': [uploadedCategoryImage('Basic Pedicure.png')],
  'womens-hair::haircut': [uploadedCategoryImage('Haircut for women.png')],
  'womens-hair::hair-trim': [uploadedCategoryImage('Hair Trim for women.png')],
  'womens-hair::basic-hair-spa': [uploadedCategoryImage('Basic Hair Spafor women.png')],
  'womens-hair::hair-color-application': [uploadedCategoryImage('Hair Color Application for womne.png')],
  'mens-grooming::haircut': [uploadedCategoryImage('Haircut for men.png')],
  'mens-grooming::beard-trim-and-styling': [uploadedCategoryImage('Beard Trim & Styling for men.png')],
  'mens-grooming::clean-shave': [uploadedCategoryImage('Clean Shave for men.png')],
  'mens-grooming::mens-facial': [uploadedCategoryImage('Men’s Facial.png')],
  'mens-grooming::mens-d-tan-face-and-neck': [uploadedCategoryImage('Men’s D-Tan – Face & Neck.png')],
  'mens-grooming::mens-manicure': [uploadedCategoryImage('Men’s Manicure.png')],
  'mens-grooming::mens-pedicure': [uploadedCategoryImage('Men’s Pedicure.png')],
  'massage::head-massage': [uploadedCategoryImage('Head Massage.png')],
  'massage::foot-massage': [uploadedCategoryImage('Foot Massage.png')],
  'massage::neck-and-shoulder-massage': [uploadedCategoryImage('Neck & Shoulder Massage.png')],
  'massage::full-body-massage': [uploadedCategoryImage('Full Body Massage.png')],
};

const PAINTING_PACKAGE_IMAGE_URLS: Record<string, string[]> = {
  'painting-interior::1-room-painting': [uploadedCategoryImage('1 Room Painting.png')],
  'painting-interior::2-rooms-painting': [uploadedCategoryImage('2 Rooms Painting.png')],
  'painting-interior::full-1-bhk-painting': [uploadedCategoryImage('Full 1 BHK Painting.png')],
  'painting-interior::full-2-bhk-painting': [uploadedCategoryImage('Full 2 BHK Painting.png')],
  'painting-interior::full-3-bhk-painting': [uploadedCategoryImage('Full 3 BHK Painting.png')],
  'painting-interior::full-4-bhk-painting': [uploadedCategoryImage('Full 4 BHK Painting.png')],
  'painting-exterior::balcony-small-exterior-area': [uploadedCategoryImage('Balcony  Small Exterior Area.png')],
  'painting-exterior::exterior-wall-painting': [uploadedCategoryImage('Exterior Wall Painting.png')],
  'painting-rental::1-bhk-rental-painting': [uploadedCategoryImage('1 BHK Rental Painting.png')],
  'painting-rental::2-bhk-rental-painting': [uploadedCategoryImage('2 BHK Rental Painting.png')],
  'painting-rental::3-bhk-rental-painting': [uploadedCategoryImage('3 BHK Rental Painting.png')],
  'painting-waterproofing::wall-waterproofing': [uploadedCategoryImage('Wall Waterproofing.png')],
  'painting-waterproofing::terrace-waterproofing': [uploadedCategoryImage('Terrace Waterproofing.png')],
  'painting-waterproofing::bathroom-kitchen-grouting': [uploadedCategoryImage('Bathroom  Kitchen Grouting.png')],
};

const CAR_WASH_PACKAGE_IMAGE_URLS: Record<string, string[]> = {
  'car-wash-basic::hatchback': [uploadedCategoryImage('car-wash-hatchback.webp')],
  'car-wash-basic::sedan': [uploadedCategoryImage('car-wash-sedan.webp')],
  'car-wash-basic::premium-sedan': [uploadedCategoryImage('car-wash-premium-sedan.webp')],
  'car-wash-basic::compact-suv': [uploadedCategoryImage('car-wash-compact-suv.webp')],
  'car-wash-basic::suv-muv': [uploadedCategoryImage('car-wash-suv-muv.webp')],
  'car-wash-basic::luxury-premium-car': [uploadedCategoryImage('car-wash-luxury-premium-car.webp')],
  'car-wash-premium::hatchback': [uploadedCategoryImage('car-wash-hatchback.webp')],
  'car-wash-premium::sedan': [uploadedCategoryImage('car-wash-sedan.webp')],
  'car-wash-premium::premium-sedan': [uploadedCategoryImage('car-wash-premium-sedan.webp')],
  'car-wash-premium::compact-suv': [uploadedCategoryImage('car-wash-compact-suv.webp')],
  'car-wash-premium::suv-muv': [uploadedCategoryImage('car-wash-suv-muv.webp')],
  'car-wash-premium::luxury-premium-car': [uploadedCategoryImage('car-wash-luxury-premium-car.webp')],
  'car-wash-interior-deep-cleaning::hatchback': [uploadedCategoryImage('car-wash-hatchback.webp')],
  'car-wash-interior-deep-cleaning::sedan': [uploadedCategoryImage('car-wash-sedan.webp')],
  'car-wash-interior-deep-cleaning::premium-sedan': [uploadedCategoryImage('car-wash-premium-sedan.webp')],
  'car-wash-interior-deep-cleaning::compact-suv': [uploadedCategoryImage('car-wash-compact-suv.webp')],
  'car-wash-interior-deep-cleaning::suv-muv': [uploadedCategoryImage('car-wash-suv-muv.webp')],
  'car-wash-interior-deep-cleaning::luxury-premium-car': [uploadedCategoryImage('car-wash-luxury-premium-car.webp')],
  'car-wash-sanitization::hatchback': [uploadedCategoryImage('car-wash-hatchback.webp')],
  'car-wash-sanitization::sedan': [uploadedCategoryImage('car-wash-sedan.webp')],
  'car-wash-sanitization::premium-sedan': [uploadedCategoryImage('car-wash-premium-sedan.webp')],
  'car-wash-sanitization::compact-suv': [uploadedCategoryImage('car-wash-compact-suv.webp')],
  'car-wash-sanitization::suv-muv': [uploadedCategoryImage('car-wash-suv-muv.webp')],
  'car-wash-sanitization::luxury-premium-car': [uploadedCategoryImage('car-wash-luxury-premium-car.webp')],
};

const LAUNDRY_PACKAGE_IMAGE_URLS: Record<string, string[]> = {
  'laundry-wash-by-weight::clothes-washing-per-kg': [uploadedCategoryImage('laundry-clothes-washing.webp')],
  'laundry-wash-by-weight::wash-and-iron-per-kg': [uploadedCategoryImage('laundry-wash-and-iron.webp')],
  'laundry-ironing-services::ironing-steam-ironing-8-pieces': [uploadedCategoryImage('laundry-ironing-steam-ironing.webp')],
  'laundry-traditional-wear::saree-and-traditional-wear-cleaning-per-piece': [uploadedCategoryImage('laundry-traditional-wear-cleaning.webp')],
  'laundry-bedding-and-blankets::bedsheet-cleaning-per-piece': [uploadedCategoryImage('laundry-bedsheet-cleaning.webp')],
  'laundry-bedding-and-blankets::single-blanket-cleaning-per-piece': [uploadedCategoryImage('laundry-single-blanket-cleaning.webp')],
  'laundry-bedding-and-blankets::double-blanket-cleaning-per-piece': [uploadedCategoryImage('laundry-double-blanket-cleaning.webp')],
  'laundry-shoe-cleaning::shoe-cleaning-per-pair': [uploadedCategoryImage('laundry-shoe-cleaning.webp')],
};

const CARPENTRY_PACKAGE_IMAGE_MISSING_NAMES = new Set([
  imageIdentity('Glass Floating Shelf Installation'),
  imageIdentity('Sliding Wardrobe Assembly'),
]);

function resolveCarpentryPackageImageUrls(categorySlug: string, packageName?: string): string[] | null {
  if (!categorySlug.startsWith('carpenter-') || !packageName) return null;
  if (CARPENTRY_PACKAGE_IMAGE_MISSING_NAMES.has(imageIdentity(packageName))) return null;
  return [uploadedCategoryImage(carpentryPackageImageFileName(packageName))];
}

/** Plumbing package cards — uploaded via ADPT4EH scripts/upload-plumbing-package-images.mjs */
const PLUMBING_PACKAGE_IMAGE_URLS: Record<string, string[]> = {
  'plumbing-basin-sink::kitchen-sink-blockage-removal': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Kitchen%20Sink%20Blockage%20Removal.webp',
  ],
  'plumbing-basin-sink::wash-basin-blockage-removal': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Wash%20Basin%20Blockage%20Removal.webp',
  ],
  'plumbing-basin-sink::wash-basin-installation': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Wash%20Basin%20Installation.webp',
  ],
  'plumbing-basin-sink::wash-basin-leakage-repair': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Wash%20Basin%20Leakage%20Repair.webp',
  ],
  'plumbing-bath-shower::ceiling-mounted-shower-installation': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Ceiling-Mounted%20Shower%20Installation.webp',
  ],
  'plumbing-bath-shower::handheld-shower-installation': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Handheld%20Shower%20Installation.webp',
  ],
  'plumbing-bath-shower::shower-filter-installation': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Shower%20Filter%20Installation.webp',
  ],
  'plumbing-bath-shower::shower-repair': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Shower%20Repair.webp',
  ],
  'plumbing-bath-shower::wall-mounted-shower-installation': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Wall-Mounted%20Shower%20Installation.webp',
  ],
  'plumbing-drainage-pipe::bathroom-balcony-drain-blockage-removal': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Bathroom%20Balcony%20Drain%20Blockage%20Removal.webp',
  ],
  'plumbing-drainage-pipe::drain-cover-installation': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Drain%20Cover%20Installation.webp',
  ],
  'plumbing-grouting::bathroom-grouting': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Bathroom%20Grouting.webp',
  ],
  'plumbing-grouting::kitchen-grouting': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Kitchen%20Grouting.webp',
  ],
  'plumbing-tap-mixer::hot-and-cold-mixer-repair-installation': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Hot%20%26%20Cold%20Mixer%20Repair%20Installation.webp',
  ],
  'plumbing-tap-mixer::regular-tap-installation-replacement': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Regular%20Tap%20Installation%20Replacement.webp',
  ],
  'plumbing-tap-mixer::regular-tap-repair': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Regular%20Tap%20Repair.webp',
  ],
  'plumbing-tap-mixer::shower-mixer-installation-replacement': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Shower%20Mixer%20Installation%20Replacement.webp',
  ],
  'plumbing-tap-mixer::swan-tap-repair': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Swan%20Tap%20Repair.webp',
  ],
  'plumbing-tap-mixer::tap-accessories-installation': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Tap%20Accessories%20Installation.webp',
  ],
  'plumbing-toilet::flush-tank-repair-ceramic': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Flush%20Tank%20Repair%20%E2%80%93%20Ceramic.webp',
  ],
  'plumbing-toilet::flush-tank-repair-concealed': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Flush%20Tank%20Repair%20%E2%80%93%20Concealed.webp',
  ],
  'plumbing-toilet::flush-tank-repair-pvc': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Flush%20Tank%20Repair%20%E2%80%93%20PVC.webp',
  ],
  'plumbing-toilet::flush-tank-replacement': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Flush%20Tank%20Replacement.webp',
  ],
  'plumbing-toilet::indian-toilet-installation-replacement': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Indian%20Toilet%20Installation%20Replacement.webp',
  ],
  'plumbing-toilet::indian-toilet-repair': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Indian%20Toilet%20Repair.webp',
  ],
  'plumbing-toilet::jet-spray-repair-replacement': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Jet%20Spray%20Repair%20Replacement.webp',
  ],
  'plumbing-toilet::toilet-pot-blockage-removal': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Toilet%20Pot%20Blockage%20Removal.webp',
  ],
  'plumbing-toilet::toilet-seat-cover-installation-replacement': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Toilet%20Seat%20Cover%20Installation%20Replacement.webp',
  ],
  'plumbing-toilet::western-toilet-installation-replacement-floor-mounted': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Western%20Toilet%20Installation%20Replacement%20%E2%80%93%20Floor%20Mounted.webp',
  ],
  'plumbing-toilet::western-toilet-installation-replacement-wall-mounted': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Western%20Toilet%20Installation%20Replacement%20%E2%80%93%20Wall%20Mounted.webp',
  ],
  'plumbing-toilet::western-toilet-repair-floor-mounted': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Western%20Toilet%20Repair%20%E2%80%93%20Floor%20Mounted.webp',
  ],
  'plumbing-toilet::western-toilet-repair-wall-mounted': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Western%20Toilet%20Repair%20%E2%80%93%20Wall%20Mounted.webp',
  ],
  'plumbing::bottle-trap-installation': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Bottle%20Trap%20Installation.webp',
  ],
  'plumbing::connection-hose-installation': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Connection%20Hose%20Installation.webp',
  ],
  'plumbing::geyser-connection-leakage-repair': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Geyser%20Connection%20Leakage%20Repair.webp',
  ],
  'plumbing::motor-air-cavity-removal': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Motor%20Air%20Cavity%20Removal.webp',
  ],
  'plumbing::motor-installation-replacement': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Motor%20Installation%20Replacement.webp',
  ],
  'plumbing::overhead-tank-installation-5002-000l': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Overhead%20Tank%20Installation%20%E2%80%93%20500%E2%80%932%2C000L.webp',
  ],
  'plumbing::overhead-tank-installation-up-to-500l': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Overhead%20Tank%20Installation%20%E2%80%93%20Up%20to%20500L.webp',
  ],
  'plumbing::ro-water-connection': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-RO%20Water%20Connection.webp',
  ],
  'plumbing::shelf-installation': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Shelf%20Installation.webp',
  ],
  'plumbing::shutoff-valve-leakage-repair': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Shutoff%20Valve%20Leakage%20Repair.webp',
  ],
  'plumbing::soap-holder-installation': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Soap%20Holder%20Installation.webp',
  ],
  'plumbing::tank-connection-leakage-repair': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Tank%20Connection%20Leakage%20Repair.webp',
  ],
  'plumbing::tank-cover-replacement': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Tank%20Cover%20Replacement.webp',
  ],
  'plumbing::tank-leakage-repair': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Tank%20Leakage%20Repair.webp',
  ],
  'plumbing::towel-holder-rack-installation': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Towel%20Holder%20Rack%20Installation.webp',
  ],
  'plumbing::washing-machine-inlet-connection': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Washing%20Machine%20Inlet%20Connection.webp',
  ],
  'plumbing::waste-pipe-installation': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Waste%20Pipe%20Installation.webp',
  ],
  'plumbing::water-meter-installation': [
    'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images/plumbing-pkg-Water%20Meter%20Installation.webp',
  ],
};

const BOOK_NOW_PACKAGE_IMAGE_URLS: Record<string, string[]> = {
  ...PEST_CONTROL_PACKAGE_IMAGE_URLS,
  ...ELECTRICIAN_PACKAGE_IMAGE_URLS,
  ...BEAUTY_PACKAGE_IMAGE_URLS,
  ...PAINTING_PACKAGE_IMAGE_URLS,
  ...CAR_WASH_PACKAGE_IMAGE_URLS,
  ...LAUNDRY_PACKAGE_IMAGE_URLS,
  ...PLUMBING_PACKAGE_IMAGE_URLS,
};

const BOOK_NOW_SERVICE_IMAGE_URLS: Record<string, string> = {
  'electrician-switch-and-socket': uploadedCategoryImage('Switch&Socket–SwitchReplacement.png'),
  'electrician-switchboard': uploadedCategoryImage('Switchboard–Repair.png'),
  'electrician-fan': uploadedCategoryImage('Fan–Repair.png'),
  'electrician-light': uploadedCategoryImage('Light–BulbReplacement.png'),
  'electrician-wiring': uploadedCategoryImage('Wiring–InternalWiring(upto5m).png'),
  'electrician-doorbell': uploadedCategoryImage('Doorbell–Installation.png'),
  'electrician-mcb-and-fuse': uploadedCategoryImage('MCB&Fuse–MCBReplacement(1Pole).png'),
  'electrician-submeter-installation': uploadedCategoryImage('Submeter Installation.png'),
  'electrician-tv-installation': uploadedCategoryImage('TV Installation – Up to 48 inches.png'),
  'electrician-tv-uninstallation': uploadedCategoryImage('TV Uninstallation – Up to 48 inches.png'),
  'electrician-home-theatre-installation': uploadedCategoryImage('HomeTheatreInstallation.png'),
  'electrician-soundbar-installation': uploadedCategoryImage('Soundbar Installation.png'),
  'electrician-inverter': uploadedCategoryImage('Inverter – Checkup.png'),
  'electrician-stabilizer-installation': uploadedCategoryImage('Stabilizer Installation.png'),
  'womens-beauty': uploadedCategoryImage('Gold Facial.png'),
  'womens-hair': uploadedCategoryImage('Haircut for women.png'),
  'mens-grooming': uploadedCategoryImage('Haircut for men.png'),
  massage: uploadedCategoryImage('Full Body Massage.png'),
  'painting-interior': uploadedCategoryImage('1 Room Painting.png'),
  'painting-exterior': uploadedCategoryImage('Exterior Wall Painting.png'),
  'painting-rental': uploadedCategoryImage('1 BHK Rental Painting.png'),
  'painting-waterproofing': uploadedCategoryImage('Wall Waterproofing.png'),
  'car-wash-basic': uploadedCategoryImage('car-wash-basic.webp'),
  'car-wash-premium': uploadedCategoryImage('car-wash-premium.webp'),
  'car-wash-interior-deep-cleaning': uploadedCategoryImage('car-wash-interior-deep-cleaning.webp'),
  'car-wash-sanitization': uploadedCategoryImage('car-wash-sanitization.webp'),
  'laundry-wash-by-weight': uploadedCategoryImage('laundry-clothes-washing.webp'),
  'laundry-ironing-services': uploadedCategoryImage('laundry-ironing-steam-ironing.webp'),
  'laundry-traditional-wear': uploadedCategoryImage('laundry-traditional-wear-cleaning.webp'),
  'laundry-bedding-and-blankets': uploadedCategoryImage('laundry-bedsheet-cleaning.webp'),
  'laundry-shoe-cleaning': uploadedCategoryImage('laundry-shoe-cleaning.webp'),
  'carpenter-cupboard-drawer': uploadedCategoryImage('Cupboard Hinge Repair  Replacement.png'),
  'carpenter-kitchen-fittings': uploadedCategoryImage('Cabinet Hinge Repair  Replacement.png'),
  'carpenter-shelves-wall-decor': uploadedCategoryImage('Wooden Shelf Installation.png'),
  'carpenter-door': uploadedCategoryImage('Wooden Door Minor Repair.png'),
  'carpenter-windows-curtain': uploadedCategoryImage('Window Hinge Repair  Replacement.png'),
  'carpenter-furniture-repair': uploadedCategoryImage('Bed Support Repair.png'),
  'carpenter-furniture-assembly': uploadedCategoryImage('Single Bed Assembly.png'),
  'carpenter-wardrobe': uploadedCategoryImage('Wardrobe Assembly – Single Door.png'),
  'carpenter-clothes-hangers': uploadedCategoryImage('Ceiling-Mounted Clothes Hanger – Fixed.png'),
  // Plumbing service tiles — representative package image per sub-category
  'plumbing-tap-mixer':
    PLUMBING_PACKAGE_IMAGE_URLS['plumbing-tap-mixer::regular-tap-repair'][0],
  'plumbing-toilet':
    PLUMBING_PACKAGE_IMAGE_URLS['plumbing-toilet::western-toilet-repair-floor-mounted'][0],
  'plumbing-basin-sink':
    PLUMBING_PACKAGE_IMAGE_URLS['plumbing-basin-sink::wash-basin-installation'][0],
  'plumbing-bath-shower':
    PLUMBING_PACKAGE_IMAGE_URLS['plumbing-bath-shower::handheld-shower-installation'][0],
  'plumbing-drainage-pipe':
    PLUMBING_PACKAGE_IMAGE_URLS[
      'plumbing-drainage-pipe::bathroom-balcony-drain-blockage-removal'
    ][0],
  'plumbing-water-pipe-connection':
    PLUMBING_PACKAGE_IMAGE_URLS['plumbing::connection-hose-installation'][0],
  'plumbing-water-tank':
    PLUMBING_PACKAGE_IMAGE_URLS['plumbing::overhead-tank-installation-up-to-500l'][0],
  'plumbing-grouting':
    PLUMBING_PACKAGE_IMAGE_URLS['plumbing-grouting::bathroom-grouting'][0],
  plumbing: PLUMBING_PACKAGE_IMAGE_URLS['plumbing::soap-holder-installation'][0],
};

function resolveBookNowServiceImageUrl(categorySlug: string, fallbackImageUrl: string): string {
  return BOOK_NOW_SERVICE_IMAGE_URLS[categorySlug] || fallbackImageUrl;
}

function resolveBookNowPackageImageUrls(
  categorySlug: string,
  skuSlug: string,
  fallbackImageUrl: string,
  packageName?: string,
): string[] {
  const carpentryImageUrls = resolveCarpentryPackageImageUrls(categorySlug, packageName);
  if (carpentryImageUrls) return carpentryImageUrls;

  return (
    BOOK_NOW_PACKAGE_IMAGE_URLS[`${categorySlug}::${skuSlug}`] ||
    (fallbackImageUrl ? [fallbackImageUrl] : [])
  );
}

type DurationOverride = {
  durationLabel: string;
  durationMinutes: number;
};

let durationOverridesCache: Map<string, DurationOverride> | null = null;

function normalizeKey(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildOverrideKey(section: string, service: string): string {
  return `${normalizeKey(section)}::${normalizeKey(service)}`;
}

function resolveDurationOverrideCsvPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '../Booknow services and prices(New Durations).csv'),
    path.resolve(process.cwd(), '../../Booknow services and prices(New Durations).csv'),
    path.resolve(__dirname, '../../../Booknow services and prices(New Durations).csv'),
    path.resolve(__dirname, '../../../../Booknow services and prices(New Durations).csv'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function loadDurationOverrides(): Map<string, DurationOverride> {
  if (durationOverridesCache) return durationOverridesCache;

  const overrides = new Map<string, DurationOverride>();
  const csvPath = resolveDurationOverrideCsvPath();
  if (!csvPath) {
    durationOverridesCache = overrides;
    return overrides;
  }

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  let currentSection = '';

  rows.forEach((row) => {
    const first = String(row[0] || '').replace(/\u00a0/g, ' ').trim();
    const second = String(row[1] || '').replace(/\u00a0/g, ' ').trim();
    const third = String(row[2] || '').replace(/\u00a0/g, ' ').trim();
    if (!first) return;

    const normalizedFirst = normalizeKey(first);
    const normalizedSecond = normalizeKey(second);
    if (
      normalizedFirst === 'service' ||
      normalizedFirst === 'category' ||
      normalizedFirst === 'main category'
    ) {
      return;
    }

    if (!second && !third) {
      currentSection = first;
      return;
    }

    const serviceName = third ? second : first;
    const categoryName = third ? second ? first : currentSection : currentSection;
    const durationLabel = third || second;
    if (!serviceName || !durationLabel || normalizeKey(durationLabel) === 'new duration') {
      return;
    }

    const override = {
      durationLabel,
      durationMinutes: parseDurationMinutes(durationLabel),
    };
    overrides.set(buildOverrideKey(currentSection, serviceName), override);
    if (categoryName) {
      overrides.set(buildOverrideKey(categoryName, serviceName), override);
    }
    if (!overrides.has(buildOverrideKey('', serviceName))) {
      overrides.set(buildOverrideKey('', serviceName), override);
    }

    if (!normalizedSecond && !third) {
      currentSection = first;
    }
  });

  durationOverridesCache = overrides;
  return overrides;
}

function applyDurationOverride(
  item: CsvItem,
  sectionTitle: string,
  serviceLabel?: string,
): CsvItem {
  const overrides = loadDurationOverrides();
  const override =
    overrides.get(buildOverrideKey(serviceLabel || '', item.name)) ||
    overrides.get(buildOverrideKey(sectionTitle, item.name)) ||
    overrides.get(buildOverrideKey('', item.name));

  if (!override) return item;

  return {
    ...item,
    durationLabel: override.durationLabel,
    durationMinutes: override.durationMinutes,
  };
}

const PAINTING_SERVICE_SEEDS: Array<{
  serviceId: string;
  label: string;
  categorySlug: string;
  imageUrl: string;
  serviceSortOrder: number;
  packages: CsvItem[];
}> = [
  {
    serviceId: 'interior-painting',
    label: 'Interior Painting',
    categorySlug: 'painting-interior',
    imageUrl: resolveBookNowServiceImageUrl('painting-interior', PAINTING_PLACEHOLDER_IMAGE),
    serviceSortOrder: 1,
    packages: [
      { name: '1 Room Painting', offerPrice: 4999, originalPrice: 5999, durationLabel: '1 Day', durationMinutes: 480 },
      { name: '2 Rooms Painting', offerPrice: 8999, originalPrice: 10999, durationLabel: '2 Days', durationMinutes: 960 },
      { name: 'Full 1 BHK Painting', offerPrice: 8999, originalPrice: 10999, durationLabel: '2 Days', durationMinutes: 960 },
      { name: 'Full 2 BHK Painting', offerPrice: 11999, originalPrice: 14999, durationLabel: '2 Days', durationMinutes: 960 },
      { name: 'Full 3 BHK Painting', offerPrice: 15999, originalPrice: 19999, durationLabel: '3 Days', durationMinutes: 1440 },
      { name: 'Full 4 BHK Painting', offerPrice: 19999, originalPrice: 24999, durationLabel: '4 Days', durationMinutes: 1920 },
    ],
  },
  {
    serviceId: 'exterior-painting',
    label: 'Exterior Painting',
    categorySlug: 'painting-exterior',
    imageUrl: resolveBookNowServiceImageUrl('painting-exterior', PAINTING_PLACEHOLDER_IMAGE),
    serviceSortOrder: 2,
    packages: [
      { name: 'Balcony / Small Exterior Area', offerPrice: 2999, originalPrice: 3999, durationLabel: '1 Day', durationMinutes: 480 },
      { name: 'Exterior Wall Painting', offerPrice: 4999, originalPrice: 6499, durationLabel: '2 Days', durationMinutes: 960 },
    ],
  },
  {
    serviceId: 'rental-painting',
    label: 'Rental Painting',
    categorySlug: 'painting-rental',
    imageUrl: resolveBookNowServiceImageUrl('painting-rental', PAINTING_PLACEHOLDER_IMAGE),
    serviceSortOrder: 3,
    packages: [
      { name: '1 BHK Rental Painting', offerPrice: 8999, originalPrice: 10999, durationLabel: '2 Days', durationMinutes: 960 },
      { name: '2 BHK Rental Painting', offerPrice: 11999, originalPrice: 14999, durationLabel: '2 Days', durationMinutes: 960 },
      { name: '3 BHK Rental Painting', offerPrice: 15999, originalPrice: 19999, durationLabel: '3 Days', durationMinutes: 1440 },
    ],
  },
  {
    serviceId: 'waterproofing',
    label: 'Waterproofing',
    categorySlug: 'painting-waterproofing',
    imageUrl: resolveBookNowServiceImageUrl('painting-waterproofing', PAINTING_PLACEHOLDER_IMAGE),
    serviceSortOrder: 4,
    packages: [
      { name: 'Wall Waterproofing', offerPrice: 4999, originalPrice: 5999, durationLabel: '1 Day', durationMinutes: 480 },
      { name: 'Terrace Waterproofing', offerPrice: 5499, originalPrice: 6999, durationLabel: '2 Days', durationMinutes: 960 },
      { name: 'Bathroom / Kitchen Grouting', offerPrice: 2399, originalPrice: 2999, durationLabel: '4 Hours', durationMinutes: 240 },
    ],
  },
];

const CAR_WASH_SERVICE_SEEDS: Array<{
  serviceId: string;
  label: string;
  categorySlug: string;
  imageUrl: string;
  serviceSortOrder: number;
  packages: CsvItem[];
}> = [
  {
    serviceId: 'basic-car-wash',
    label: 'Basic Car Wash',
    categorySlug: 'car-wash-basic',
    imageUrl: resolveBookNowServiceImageUrl('car-wash-basic', CAR_WASH_PLACEHOLDER_IMAGE),
    serviceSortOrder: 1,
    packages: [
      { name: 'Hatchback', offerPrice: 499, originalPrice: 699, durationLabel: '45 mins', durationMinutes: 45 },
      { name: 'Sedan', offerPrice: 549, originalPrice: 749, durationLabel: '45 mins', durationMinutes: 45 },
      { name: 'Premium Sedan', offerPrice: 599, originalPrice: 799, durationLabel: '60 mins', durationMinutes: 60 },
      { name: 'Compact SUV', offerPrice: 649, originalPrice: 849, durationLabel: '60 mins', durationMinutes: 60 },
      { name: 'SUV / MUV', offerPrice: 699, originalPrice: 899, durationLabel: '60 mins', durationMinutes: 60 },
      { name: 'Luxury / Premium Car', offerPrice: 799, originalPrice: 999, durationLabel: '75 mins', durationMinutes: 75 },
    ],
  },
  {
    serviceId: 'premium-car-wash',
    label: 'Premium Car Wash',
    categorySlug: 'car-wash-premium',
    imageUrl: resolveBookNowServiceImageUrl('car-wash-premium', CAR_WASH_PLACEHOLDER_IMAGE),
    serviceSortOrder: 2,
    packages: [
      { name: 'Hatchback', offerPrice: 799, originalPrice: 999, durationLabel: '75 mins', durationMinutes: 75 },
      { name: 'Sedan', offerPrice: 849, originalPrice: 1099, durationLabel: '75 mins', durationMinutes: 75 },
      { name: 'Premium Sedan', offerPrice: 899, originalPrice: 1149, durationLabel: '90 mins', durationMinutes: 90 },
      { name: 'Compact SUV', offerPrice: 949, originalPrice: 1199, durationLabel: '90 mins', durationMinutes: 90 },
      { name: 'SUV / MUV', offerPrice: 999, originalPrice: 1249, durationLabel: '90 mins', durationMinutes: 90 },
      { name: 'Luxury / Premium Car', offerPrice: 1099, originalPrice: 1399, durationLabel: '105 mins', durationMinutes: 105 },
    ],
  },
  {
    serviceId: 'car-interior-deep-cleaning',
    label: 'Car Interior Deep Cleaning',
    categorySlug: 'car-wash-interior-deep-cleaning',
    imageUrl: resolveBookNowServiceImageUrl('car-wash-interior-deep-cleaning', CAR_WASH_PLACEHOLDER_IMAGE),
    serviceSortOrder: 3,
    packages: [
      { name: 'Hatchback', offerPrice: 1199, originalPrice: 1499, durationLabel: '90 mins', durationMinutes: 90 },
      { name: 'Sedan', offerPrice: 1299, originalPrice: 1599, durationLabel: '90 mins', durationMinutes: 90 },
      { name: 'Premium Sedan', offerPrice: 1399, originalPrice: 1699, durationLabel: '105 mins', durationMinutes: 105 },
      { name: 'Compact SUV', offerPrice: 1499, originalPrice: 1799, durationLabel: '105 mins', durationMinutes: 105 },
      { name: 'SUV / MUV', offerPrice: 1599, originalPrice: 1899, durationLabel: '120 mins', durationMinutes: 120 },
      { name: 'Luxury / Premium Car', offerPrice: 1799, originalPrice: 2199, durationLabel: '120 mins', durationMinutes: 120 },
    ],
  },
  {
    serviceId: 'car-sanitization',
    label: 'Car Sanitization',
    categorySlug: 'car-wash-sanitization',
    imageUrl: resolveBookNowServiceImageUrl('car-wash-sanitization', CAR_WASH_PLACEHOLDER_IMAGE),
    serviceSortOrder: 4,
    packages: [
      { name: 'Hatchback', offerPrice: 799, originalPrice: 999, durationLabel: '60 mins', durationMinutes: 60 },
      { name: 'Sedan', offerPrice: 849, originalPrice: 1049, durationLabel: '60 mins', durationMinutes: 60 },
      { name: 'Premium Sedan', offerPrice: 899, originalPrice: 1099, durationLabel: '75 mins', durationMinutes: 75 },
      { name: 'Compact SUV', offerPrice: 949, originalPrice: 1149, durationLabel: '75 mins', durationMinutes: 75 },
      { name: 'SUV / MUV', offerPrice: 999, originalPrice: 1199, durationLabel: '75 mins', durationMinutes: 75 },
      { name: 'Luxury / Premium Car', offerPrice: 1099, originalPrice: 1299, durationLabel: '90 mins', durationMinutes: 90 },
    ],
  },
];

const LAUNDRY_SERVICE_SEEDS: Array<{
  serviceId: string;
  label: string;
  categorySlug: string;
  imageUrl: string;
  serviceSortOrder: number;
  packages: CsvItem[];
}> = [
  {
    serviceId: 'wash-by-weight',
    label: 'Wash by Weight',
    categorySlug: 'laundry-wash-by-weight',
    imageUrl: resolveBookNowServiceImageUrl('laundry-wash-by-weight', LAUNDRY_PLACEHOLDER_IMAGE),
    serviceSortOrder: 1,
    packages: [
      { name: 'Clothes Washing - per kg', offerPrice: 65, originalPrice: 85, durationLabel: '1.5 hours', durationMinutes: 90 },
      { name: 'Wash & Iron - per kg', offerPrice: 90, originalPrice: 120, durationLabel: '2.5 hours', durationMinutes: 150 },
    ],
  },
  {
    serviceId: 'ironing-services',
    label: 'Ironing Services',
    categorySlug: 'laundry-ironing-services',
    imageUrl: resolveBookNowServiceImageUrl('laundry-ironing-services', LAUNDRY_PLACEHOLDER_IMAGE),
    serviceSortOrder: 2,
    packages: [
      { name: 'Ironing / Steam Ironing - 8 pieces', offerPrice: 99, originalPrice: 149, durationLabel: '1 hour', durationMinutes: 60 },
    ],
  },
  {
    serviceId: 'traditional-wear',
    label: 'Traditional Wear',
    categorySlug: 'laundry-traditional-wear',
    imageUrl: resolveBookNowServiceImageUrl('laundry-traditional-wear', LAUNDRY_PLACEHOLDER_IMAGE),
    serviceSortOrder: 3,
    packages: [
      { name: 'Saree & Traditional Wear Cleaning - per piece', offerPrice: 99, originalPrice: 149, durationLabel: '1 hour', durationMinutes: 60 },
    ],
  },
  {
    serviceId: 'bedding-and-blankets',
    label: 'Bedding & Blankets',
    categorySlug: 'laundry-bedding-and-blankets',
    imageUrl: resolveBookNowServiceImageUrl('laundry-bedding-and-blankets', LAUNDRY_PLACEHOLDER_IMAGE),
    serviceSortOrder: 4,
    packages: [
      { name: 'Bedsheet Cleaning - per piece', offerPrice: 99, originalPrice: 199, durationLabel: '1.5-2 hours', durationMinutes: 105 },
      { name: 'Single Blanket Cleaning - per piece', offerPrice: 179, originalPrice: 249, durationLabel: '2-2.5 hours', durationMinutes: 135 },
      { name: 'Double Blanket Cleaning - per piece', offerPrice: 249, originalPrice: 349, durationLabel: '2.5-3 hours', durationMinutes: 165 },
    ],
  },
  {
    serviceId: 'shoe-cleaning',
    label: 'Shoe Cleaning',
    categorySlug: 'laundry-shoe-cleaning',
    imageUrl: resolveBookNowServiceImageUrl('laundry-shoe-cleaning', LAUNDRY_PLACEHOLDER_IMAGE),
    serviceSortOrder: 5,
    packages: [
      { name: 'Shoe Cleaning - per pair', offerPrice: 99, originalPrice: 149, durationLabel: '30-45 minutes', durationMinutes: 38 },
    ],
  },
];

export type BookNowCsvServiceSeed = {
  serviceId: string;
  label: string;
  categorySlug: string;
  imageUrl: string;
  sectionId?: string;
  serviceSortOrder: number;
  packages: CsvItem[];
};

export type BookNowCsvHubSectionSeed = {
  slug: string;
  title: string;
  iconKey: string;
  sortOrder: number;
  services: BookNowCsvServiceSeed[];
};

export type BookNowCsvCategorySeed = {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  taskCategory: string;
  heroImageUrl: string;
  serviceLabel: string;
  topLevelCategory: string;
};

export type BookNowCsvPackageSeed = {
  categorySlug: string;
  skuSlug: string;
  name: string;
  offerPrice: number;
  originalPrice: number;
  durationLabel: string;
  durationMinutes: number;
  description: string;
  imageUrls: string[];
  sortOrder: number;
};

export type BookNowCsvSeed = {
  hubSections: BookNowCsvHubSectionSeed[];
  categories: BookNowCsvCategorySeed[];
  packages: BookNowCsvPackageSeed[];
};

function loadRawSections(): RawSection[] {
  const rows = parseCsv(fs.readFileSync(resolveCsvPath(), 'utf8'));
  const sections: RawSection[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const first = String(rows[i]?.[0] || '').replace(/\u00a0/g, ' ').trim();
    if (!first || first.toUpperCase() !== first || first === 'SERVICE') {
      continue;
    }

    const title = first;
    const items: CsvItem[] = [];
    let cursor = i + 1;
    const nextFirst = String(rows[cursor]?.[0] || '').replace(/\u00a0/g, ' ').trim();
    if (nextFirst.toUpperCase() === 'SERVICE') {
      cursor += 1;
    }
    i = cursor;

    while (i < rows.length) {
      const row = rows[i];
      const nextTitle = String(row?.[0] || '').replace(/\u00a0/g, ' ').trim();
      if (nextTitle && nextTitle.toUpperCase() === nextTitle && nextTitle !== 'SERVICE') {
        i -= 1;
        break;
      }

      if (row && row[0]) {
        const name = String(row[0] || '').trim();
        const offerPrice = parsePrice(row[1] || '');
        const originalPrice = parsePrice(row[2] || '') || offerPrice;
        const durationLabel = String(row[3] || '').trim();
        items.push(applyDurationOverride({
          name,
          offerPrice,
          originalPrice,
          durationLabel,
          durationMinutes: parseDurationMinutes(durationLabel),
        }, title));
      }
      i += 1;
    }

    sections.push({ title, items });
  }

  return sections;
}

function loadBeautyCsvItems(): BeautyCsvItem[] {
  const rows = parseCsv(fs.readFileSync(resolveCsvPath(), 'utf8'));
  const items: BeautyCsvItem[] = [];
  let inBeautySection = false;
  let currentServiceLabel = '';

  for (const row of rows) {
    const first = String(row?.[0] || '').replace(/\u00a0/g, ' ').trim();
    const second = String(row?.[1] || '').replace(/\u00a0/g, ' ').trim();

    if (!inBeautySection) {
      inBeautySection = normalizeKey(first) === 'beauty services';
      continue;
    }

    if (first && first.toUpperCase() === first && !second) {
      break;
    }

    if (normalizeKey(first) === 'category' && normalizeKey(second) === 'service') {
      continue;
    }

    if (first) {
      currentServiceLabel = first;
    }

    if (!currentServiceLabel || !second) {
      continue;
    }

    const durationLabel = String(row?.[4] || '').replace(/\u00a0/g, ' ').trim();
    items.push({
      ...applyDurationOverride({
        name: second,
        offerPrice: parsePrice(row?.[2] || ''),
        originalPrice: parsePrice(row?.[3] || '') || parsePrice(row?.[2] || ''),
        durationLabel,
        durationMinutes: parseDurationMinutes(durationLabel),
      }, 'BEAUTY SERVICES', currentServiceLabel),
      serviceLabel: currentServiceLabel,
    });
  }

  return items;
}

function buildHomeCleaningServices(
  mainSection: RawSection,
): BookNowCsvServiceSeed[] {
  const buckets: Record<string, BookNowCsvServiceSeed> = {
    'full-house': {
      serviceId: 'full-house',
      label: 'Full House',
      categorySlug: 'full-house',
      imageUrl: cdnImage('fullhouse-booknow'),
      serviceSortOrder: 10,
      packages: [],
    },
    bathroom: {
      serviceId: 'bathroom',
      label: 'Bathroom',
      categorySlug: 'bathroom',
      imageUrl: cdnImage('bathroom-booknow'),
      serviceSortOrder: 20,
      packages: [],
    },
    kitchen: {
      serviceId: 'kitchen',
      label: 'Kitchen',
      categorySlug: 'kitchen',
      imageUrl: cdnImage('kitchen-booknow'),
      serviceSortOrder: 30,
      packages: [],
    },
    sofa: {
      serviceId: 'sofa',
      label: 'Sofa',
      categorySlug: 'sofa',
      imageUrl: cdnImage('sofa-booknow'),
      serviceSortOrder: 40,
      packages: [],
    },
    mattress: {
      serviceId: 'mattress',
      label: 'Mattress',
      categorySlug: 'mattress',
      imageUrl: cdnImage('mattress-cleaning-post_card'),
      serviceSortOrder: 50,
      packages: [],
    },
    'window-glass': {
      serviceId: 'window-glass',
      label: 'Window Glass',
      categorySlug: 'window-glass',
      imageUrl: cdnImage('window-glass-interior-post_card'),
      serviceSortOrder: 60,
      packages: [],
    },
  };

  mainSection.items.forEach((item) => {
    const name = item.name.toLowerCase();
    if (
      /^(\d+\s*bhk|1 bedroom combo|2 bedroom combo|full home deep clean)/i.test(item.name)
    ) {
      buckets['full-house'].packages.push(item);
      return;
    }
    if (name.startsWith('bathroom cleaning') || name.startsWith('deep bathroom cleaning')) {
      buckets.bathroom.packages.push(item);
      return;
    }
    if (
      name.includes('kitchen') ||
      name.includes('fridge cleaning') ||
      name.includes('chimney') ||
      name.includes('sink & under-sink') ||
      name.includes('gas stove')
    ) {
      buckets.kitchen.packages.push(item);
      return;
    }
    if (name.includes('mattress')) {
      buckets.mattress.packages.push(item);
      return;
    }
    if (name.includes('window cleaning')) {
      buckets['window-glass'].packages.push(item);
      return;
    }
    buckets.sofa.packages.push(item);
  });

  return Object.values(buckets)
    .filter((service) => service.packages.length > 0)
    .sort(
    (left, right) => left.serviceSortOrder - right.serviceSortOrder,
  );
}

function buildPrefixServices(
  section: RawSection,
  config: {
    slug: string;
    title: string;
    iconKey: string;
    sortOrder: number;
    categoryTask: string;
    serviceMap: Array<{
      match: RegExp;
      serviceId: string;
      label: string;
      categorySlug: string;
      imageUrl: string;
      sectionId?: string;
      sortOrder: number;
    }>;
  },
): BookNowCsvHubSectionSeed {
  const services = config.serviceMap.map((service) => ({
    serviceId: service.serviceId,
    label: service.label,
    categorySlug: service.categorySlug,
    imageUrl: service.imageUrl,
    sectionId: service.sectionId,
    serviceSortOrder: service.sortOrder,
    packages: section.items.filter((item) => service.match.test(item.name)),
  }));
  // Keep every configured hub tile (e.g. AC Install/Uninstall) even when CSV
  // package names differ; CatalogService still requires the category to have packages.

  return {
    slug: config.slug,
    title: config.title,
    iconKey: config.iconKey,
    sortOrder: config.sortOrder,
    services,
  };
}

function buildElectricianServices(section: RawSection): BookNowCsvHubSectionSeed {
  const serviceImageUrl = cdnImage('auto-electricians');
  const buckets = new Map<string, BookNowCsvServiceSeed>();

  section.items.forEach((item, index) => {
    const label = item.name.includes(' - ')
      ? item.name.split(' - ')[0].trim()
      : item.name.includes(' – ')
        ? item.name.split(' – ')[0].trim()
        : item.name.trim();
    const serviceId = slugify(label);
    if (!buckets.has(serviceId)) {
      const categorySlug = `electrician-${serviceId}`;
      buckets.set(serviceId, {
        serviceId,
        label,
        categorySlug,
        imageUrl: resolveBookNowServiceImageUrl(categorySlug, serviceImageUrl),
        serviceSortOrder: index + 1,
        packages: [],
      });
    }
    buckets.get(serviceId)!.packages.push(item);
  });

  return {
    slug: 'electrician',
    title: 'Electrician',
    iconKey: 'Zap',
    sortOrder: 50,
    services: Array.from(buckets.values()),
  };
}

function buildPlumbingServices(section: RawSection): BookNowCsvHubSectionSeed {
  const rules = [
    {
      id: 'tap-mixer',
      label: 'Tap & Mixer',
      categorySlug: 'plumbing-tap-mixer',
      imageUrl: cdnImage('plumbing-tap-mixer'),
      match: /(tap|mixer)/i,
    },
    {
      id: 'toilet',
      label: 'Toilet',
      categorySlug: 'plumbing-toilet',
      imageUrl: cdnImage('plumbing-toilet'),
      match: /(toilet|flush|jet spray|seat cover)/i,
    },
    {
      id: 'basin-sink',
      label: 'Basin & Sink',
      categorySlug: 'plumbing-basin-sink',
      imageUrl: cdnImage('plumbing-basin-sink'),
      match: /(basin|sink)/i,
    },
    {
      id: 'bath-shower',
      label: 'Bath & Shower',
      categorySlug: 'plumbing-bath-shower',
      imageUrl: cdnImage('plumbing-bath-shower'),
      match: /(shower)/i,
    },
    {
      id: 'drainage-pipe',
      label: 'Drainage Pipe',
      categorySlug: 'plumbing-drainage-pipe',
      imageUrl: cdnImage('plumbing-drainage-pipe'),
      match: /(drain|blockage)/i,
    },
    {
      id: 'water-pipe-connection',
      label: 'Water Pipe',
      categorySlug: 'plumbing-water-pipe-connection',
      imageUrl: cdnImage('plumbing-water-pipe-connection'),
      match: /(water pipe|pipe repair|pipe replacement|pipe connection)/i,
    },
    {
      id: 'water-tank',
      label: 'Water Tank',
      categorySlug: 'plumbing-water-tank',
      imageUrl: cdnImage('plumbing-water-tank'),
      match: /(water tank)/i,
    },
    {
      id: 'grouting',
      label: 'Grouting',
      categorySlug: 'plumbing-grouting',
      imageUrl: cdnImage('plumbing-grouting'),
      match: /(grouting)/i,
    },
  ];

  const buckets = new Map<string, BookNowCsvServiceSeed>();
  section.items.forEach((item, index) => {
    const rule = rules.find((candidate) => candidate.match.test(item.name)) || {
      id: 'general',
      label: 'General Plumbing',
      categorySlug: 'plumbing',
      imageUrl: cdnImage('plumbing'),
    };
    if (!buckets.has(rule.id)) {
      buckets.set(rule.id, {
        serviceId: rule.id,
        label: rule.label,
        categorySlug: rule.categorySlug,
        imageUrl: rule.imageUrl,
        serviceSortOrder: index + 1,
        packages: [],
      });
    }
    buckets.get(rule.id)!.packages.push(item);
  });

  return {
    slug: 'plumbing',
    title: 'Plumbing',
    iconKey: 'Wrench',
    sortOrder: 60,
    services: Array.from(buckets.values()),
  };
}

function buildCarpentryServices(sectionMap: Map<string, RawSection>): BookNowCsvHubSectionSeed {
  const carpentrySections = [
    {
      title: 'CUPBOARD & DRAWER',
      serviceId: 'cupboard-drawer',
      label: 'Cupboard & Drawer',
      categorySlug: 'carpenter-cupboard-drawer',
      imageUrl: cdnImage('carpenter-cupboard-drawer'),
    },
    {
      title: 'KITCHEN FITTINGS',
      serviceId: 'kitchen-fittings',
      label: 'Kitchen Fittings',
      categorySlug: 'carpenter-kitchen-fittings',
      imageUrl: cdnImage('carpenter-cupboard-drawer'),
    },
    {
      title: 'SHELVES & WALL DÉCOR',
      serviceId: 'shelves-wall-decor',
      label: 'Shelves & Wall Decor',
      categorySlug: 'carpenter-shelves-wall-decor',
      imageUrl: cdnImage('carpenter-drill-hang'),
    },
    {
      title: 'WOODEN DOORS',
      serviceId: 'wooden-doors',
      label: 'Wooden Doors',
      categorySlug: 'carpenter-door',
      imageUrl: cdnImage('carpenter-door'),
    },
    {
      title: 'WINDOWS & CURTAINS',
      serviceId: 'windows-curtains',
      label: 'Windows & Curtains',
      categorySlug: 'carpenter-windows-curtain',
      imageUrl: cdnImage('carpenter-windows-curtain'),
    },
    {
      title: 'FURNITURE REPAIR',
      serviceId: 'furniture-repair',
      label: 'Furniture Repair',
      categorySlug: 'carpenter-furniture-repair',
      imageUrl: cdnImage('carpenter-bed'),
    },
    {
      title: 'FURNITURE ASSEMBLY',
      serviceId: 'furniture-assembly',
      label: 'Furniture Assembly',
      categorySlug: 'carpenter-furniture-assembly',
      imageUrl: cdnImage('carpenter-furniture-assembly'),
    },
    {
      title: 'WARDROBE ASSEMBLY',
      serviceId: 'wardrobe-assembly',
      label: 'Wardrobe Assembly',
      categorySlug: 'carpenter-wardrobe',
      imageUrl: cdnImage('carpenter-wardrobe'),
    },
    {
      title: 'CLOTHES HANGERS',
      serviceId: 'clothes-hangers',
      label: 'Clothes Hangers',
      categorySlug: 'carpenter-clothes-hangers',
      imageUrl: cdnImage('carpenter-drill-hang'),
    },
  ];

  return {
    slug: 'carpentry',
    title: 'Carpentry',
    iconKey: 'Hammer',
    sortOrder: 70,
    services: carpentrySections
      .map((entry, index) => {
        const section = sectionMap.get(entry.title);
        if (!section || section.items.length === 0) {
          return null;
        }
        return {
          serviceId: entry.serviceId,
          label: entry.label,
          categorySlug: entry.categorySlug,
          imageUrl: resolveBookNowServiceImageUrl(entry.categorySlug, entry.imageUrl),
          serviceSortOrder: index + 1,
          packages: section.items,
        } satisfies BookNowCsvServiceSeed;
      })
      .filter(Boolean) as BookNowCsvServiceSeed[],
  };
}

function buildBeautyServices(): BookNowCsvHubSectionSeed {
  const packagesByService = new Map<string, CsvItem[]>();
  loadBeautyCsvItems().forEach(({ serviceLabel, ...item }) => {
    const serviceKey = normalizeKey(serviceLabel);
    const current = packagesByService.get(serviceKey) || [];
    current.push(item);
    packagesByService.set(serviceKey, current);
  });

  const services = [
    {
      serviceId: 'womens-beauty',
      label: "Women's Beauty",
      csvLabel: 'Women’s Beauty',
      categorySlug: 'womens-beauty',
      imageUrl: cdnImage('beauty-services'),
      serviceSortOrder: 1,
    },
    {
      serviceId: 'womens-hair',
      label: "Women's Hair",
      csvLabel: 'Women’s Hair',
      categorySlug: 'womens-hair',
      imageUrl: cdnImage('beauty-services'),
      serviceSortOrder: 2,
    },
    {
      serviceId: 'mens-grooming',
      label: "Men's Grooming",
      csvLabel: 'Men’s Grooming',
      categorySlug: 'mens-grooming',
      imageUrl: cdnImage('beauty-services'),
      serviceSortOrder: 3,
    },
    {
      serviceId: 'massage',
      label: 'Massage',
      csvLabel: 'Massage',
      categorySlug: 'massage',
      imageUrl: cdnImage('massage-spa'),
      serviceSortOrder: 4,
    },
  ];

  return {
    slug: 'beauty-services',
    title: 'Beauty Services',
    iconKey: 'Sparkles',
    sortOrder: 80,
    services: services
      .map((service) => ({
        serviceId: service.serviceId,
        label: service.label,
        categorySlug: service.categorySlug,
        imageUrl: resolveBookNowServiceImageUrl(service.categorySlug, service.imageUrl),
        serviceSortOrder: service.serviceSortOrder,
        packages: packagesByService.get(normalizeKey(service.csvLabel)) || [],
      }))
      .filter((service) => service.packages.length > 0),
  };
}

function buildPaintingServices(): BookNowCsvHubSectionSeed {
  return {
    slug: 'painting',
    title: 'Painting',
    iconKey: 'Paintbrush',
    sortOrder: 85,
    services: PAINTING_SERVICE_SEEDS.map((service) => ({
      serviceId: service.serviceId,
      label: service.label,
      categorySlug: service.categorySlug,
      imageUrl: service.imageUrl,
      serviceSortOrder: service.serviceSortOrder,
      packages: service.packages.map((pkg) => applyDurationOverride(pkg, 'painting', service.label)),
    })),
  };
}

function buildCarWashServices(): BookNowCsvHubSectionSeed {
  return {
    slug: 'car-wash',
    title: 'Car Wash',
    iconKey: 'CarFront',
    sortOrder: 90,
    services: CAR_WASH_SERVICE_SEEDS.map((service) => ({
      serviceId: service.serviceId,
      label: service.label,
      categorySlug: service.categorySlug,
      imageUrl: service.imageUrl,
      serviceSortOrder: service.serviceSortOrder,
      packages: service.packages,
    })),
  };
}

function buildLaundryServices(): BookNowCsvHubSectionSeed {
  return {
    slug: 'laundry',
    title: 'Laundry',
    iconKey: 'Shirt',
    sortOrder: 95,
    services: LAUNDRY_SERVICE_SEEDS.map((service) => ({
      serviceId: service.serviceId,
      label: service.label,
      categorySlug: service.categorySlug,
      imageUrl: service.imageUrl,
      serviceSortOrder: service.serviceSortOrder,
      packages: service.packages,
    })),
  };
}

export function buildBookNowCsvSeed(): BookNowCsvSeed {
  const rawSections = loadRawSections();
  const sectionMap = new Map(rawSections.map((section) => [section.title, section] as const));

  const hubSections: BookNowCsvHubSectionSeed[] = [
    {
      slug: 'home-cleaning',
      title: 'Home Cleaning',
      iconKey: 'Broom',
      sortOrder: 10,
      services: buildHomeCleaningServices(
        sectionMap.get('HOME CLEANING') || { title: 'HOME CLEANING', items: [] },
      ),
    },
    buildPrefixServices(sectionMap.get('AC SERVICES') || { title: 'AC SERVICES', items: [] }, {
      slug: 'ac-services',
      title: 'AC Services',
      iconKey: 'Snowflake',
      sortOrder: 20,
      categoryTask: 'repair',
      serviceMap: [
        { match: /^AC Repair/i, serviceId: 'ac-repair', label: 'AC Repair', categorySlug: 'ac-services', imageUrl: cdnImage('acrepair-booknow'), sectionId: 'repair', sortOrder: 1 },
        { match: /^Foam Jet AC Service/i, serviceId: 'ac-servicing', label: 'AC Servicing', categorySlug: 'ac-services', imageUrl: cdnImage('foanjetacservice-booknow'), sectionId: 'servicing', sortOrder: 2 },
        { match: /^AC Gas Refill/i, serviceId: 'gas-refill', label: 'Gas Refill', categorySlug: 'ac-services', imageUrl: cdnImage('gasrefill-booknow'), sectionId: 'gas-refill', sortOrder: 3 },
        { match: /AC Installation/i, serviceId: 'install', label: 'Install', categorySlug: 'ac-services', imageUrl: cdnImage('acinstall-booknow'), sectionId: 'install', sortOrder: 4 },
        { match: /AC Uninstallation/i, serviceId: 'uninstall', label: 'Uninstall', categorySlug: 'ac-services', imageUrl: cdnImage('acuninstall-booknow'), sectionId: 'uninstall', sortOrder: 5 },
      ],
    }),
    buildPrefixServices(sectionMap.get('APPLIANCES REPAIR') || { title: 'APPLIANCES REPAIR', items: [] }, {
      slug: 'appliance-repair',
      title: 'Appliance Repair',
      iconKey: 'Wrench',
      sortOrder: 30,
      categoryTask: 'repair',
      serviceMap: [
        { match: /^Washing Machine/i, serviceId: 'washing-machine', label: 'Washing Machine', categorySlug: 'appliance-repair', imageUrl: cdnImage('wachingmachinecheckup-booknow'), sectionId: 'washing-machine', sortOrder: 1 },
        { match: /^Refrigerator/i, serviceId: 'refrigerator', label: 'Refrigerator', categorySlug: 'appliance-repair', imageUrl: cdnImage('refrigeratorcheckup-booknow'), sectionId: 'refrigerator', sortOrder: 2 },
        { match: /^Water Purifier/i, serviceId: 'water-purifier', label: 'Water Purifier', categorySlug: 'appliance-repair', imageUrl: cdnImage('waterpurifiervheckup-booknow'), sectionId: 'water-purifier', sortOrder: 3 },
        { match: /^Geyser/i, serviceId: 'geyser', label: 'Geyser', categorySlug: 'appliance-repair', imageUrl: cdnImage('geysercheckup-booknow'), sectionId: 'geyser', sortOrder: 4 },
      ],
    }),
    buildPrefixServices(sectionMap.get('PEST CONTROL') || { title: 'PEST CONTROL', items: [] }, {
      slug: 'pest-control',
      title: 'Pest Control',
      iconKey: 'Bug',
      sortOrder: 40,
      categoryTask: 'cleaning',
      serviceMap: [
        { match: /^Cockroach Control/i, serviceId: 'cockroach-control', label: 'Cockroach Control', categorySlug: 'pest-control-cockroach-control', imageUrl: uploadedCategoryImage('cockroach-control-main.png'), sortOrder: 1 },
        { match: /^Ant Control/i, serviceId: 'ant-control', label: 'Ant Control', categorySlug: 'pest-control-ant-control', imageUrl: uploadedCategoryImage('ant-control-main.png'), sortOrder: 2 },
        { match: /^Bed Bug Control/i, serviceId: 'bed-bug-control', label: 'Bed Bug Control', categorySlug: 'pest-control-bed-bug-control', imageUrl: uploadedCategoryImage('bedbug-control-main.png'), sortOrder: 3 },
      ],
    }),
    buildElectricianServices(sectionMap.get('ELECTRICIAN') || { title: 'ELECTRICIAN', items: [] }),
    buildPlumbingServices(sectionMap.get('PLUMBING') || { title: 'PLUMBING', items: [] }),
    buildCarpentryServices(sectionMap),
    buildPaintingServices(),
    buildCarWashServices(),
    buildLaundryServices(),
    buildBeautyServices(),
  ].filter((section) => section.services.length > 0);

  const categories: BookNowCsvCategorySeed[] = [];
  const packages: BookNowCsvPackageSeed[] = [];
  let categorySort = 0;

  hubSections.forEach((hubSection) => {
    hubSection.services.forEach((service) => {
      categorySort += 10;
      categories.push({
        slug: service.categorySlug,
        name: service.label,
        description: `${service.label} under ${hubSection.title}`,
        sortOrder: categorySort,
        taskCategory:
          hubSection.slug === 'home-cleaning' || hubSection.slug === 'pest-control'
            ? 'cleaning'
            : hubSection.slug === 'car-wash'
              ? 'cleaning'
            : hubSection.slug === 'laundry'
              ? 'cleaning'
            : hubSection.slug === 'painting'
              ? 'other'
            : hubSection.slug === 'beauty-services'
              ? 'other'
              : 'repair',
        heroImageUrl: service.imageUrl,
        serviceLabel: service.label,
        topLevelCategory: hubSection.title,
      });

      service.packages.forEach((item, index) => {
        const skuSlug = slugify(item.name);
        packages.push({
          categorySlug: service.categorySlug,
          skuSlug,
          name: item.name,
          offerPrice: item.offerPrice,
          originalPrice: item.originalPrice || item.offerPrice,
          durationLabel: item.durationLabel,
          durationMinutes: item.durationMinutes,
          description: `${item.durationLabel} • Offer ₹${item.offerPrice}${item.originalPrice ? ` from ₹${item.originalPrice}` : ''}`,
          imageUrls: resolveBookNowPackageImageUrls(service.categorySlug, skuSlug, service.imageUrl, item.name),
          sortOrder: index,
        });
      });
    });
  });

  return { hubSections, categories, packages };
}
