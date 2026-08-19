const CDN_IMAGE_BASE = 'https://extrahandimages-api.apps.extrahand.in/extrahand-categories-banners-images';

function cdnImage(key: string): string {
  return `${CDN_IMAGE_BASE}/${key}.webp`;
}

function cdnStatic(path: string): string {
  return `${CDN_IMAGE_BASE}/${path}`;
}

export type BookNowHubServiceSeed = {
  id: string;
  label: string;
  categorySlug: string;
  imageUrl: string;
  sectionId?: string;
};

export type BookNowHubSectionSeed = {
  id: string;
  title: string;
  iconKey: string;
  sortOrder: number;
  services: BookNowHubServiceSeed[];
};

export const BOOK_NOW_CATEGORY_HERO_IMAGE_BY_SLUG: Record<string, string> = {
  'personal-assistance': cdnImage('personal-assistance'),
  'full-house': cdnImage('fullhouse-booknow'),
  bathroom: cdnImage('bathroom-booknow'),
  kitchen: cdnImage('kitchen-booknow'),
  sofa: cdnImage('sofa-booknow'),
  mattress: cdnStatic('mattress-cleaning-post_card.webp'),
  'window-glass': cdnStatic('window-glass-interior-post_card.webp'),
  'ac-services': cdnImage('acrepair-booknow'),
  'appliance-repair': cdnImage('wachingmachinecheckup-booknow'),
};

/** Plumbing package cards (MinIO) — keep in sync with bookNowCsvCatalogSeed PLUMBING_PACKAGE_IMAGE_URLS */
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

export const BOOK_NOW_PACKAGE_IMAGE_URLS_BY_CATEGORY_AND_SKU: Record<string, string[]> = {
  ...PLUMBING_PACKAGE_IMAGE_URLS,
  'full-house::1bhk-economy': [cdnImage('fullhouse-1bhk-economy')],
  'full-house::1bhk-deep': [cdnImage('fullhouse-1bhk-deep')],
  'full-house::2bhk-economy': [cdnImage('fullhouse-2bhk-economy')],
  'full-house::2bhk-deep': [cdnImage('fullhouse-2bhk-deep')],
  'full-house::3bhk-economy': [cdnImage('fullhouse-3bhk-economy')],
  'full-house::4bhk-economy': [cdnImage('fullhouse-4bhk-economy')],
  'full-house::combo-1bed': [cdnImage('fullhouse-combo-1bed')],
  'full-house::combo-2bed': [cdnImage('fullhouse-combo-2bed')],
  'full-house::full-home-deep': [cdnImage('fullhouse-full-home-deep')],
  'bathroom::regular-clean': [cdnImage('bathroom-booknow')],
  'bathroom::deep-clean': [cdnImage('bathroomdeepclean-booknow')],
  'kitchen::kitchen-cleaning': [cdnImage('kitchenclean-booknow')],
  'kitchen::kitchen-cabinet-cleaning': [cdnImage('kitchencabinetcleaning-booknow')],
  'kitchen::fridge-cleaning': [cdnImage('fridgeclean-booknow')],
  'kitchen::chimney-exterior-cleaning': [cdnImage('chimney-booknow')],
  'kitchen::sink-under-sink-cleaning': [cdnImage('sink-undersink-booknow')],
  'kitchen::kitchen-window-cleaning': [cdnImage('kitchenwindow-booknow')],
  'kitchen::kitchen-exhaust-fan-cleaning': [cdnImage('kitchenclean-booknow')],
  'kitchen::gas-stove-cleaning': [cdnImage('gasstoveclean-booknow')],
  'sofa::sofa-cleaning': [cdnImage('sofa-booknow')],
  'sofa::sofa-cushion-cleaning': [cdnImage('sofapluscushionclean-booknow')],
  'sofa::mattress-cleaning': [cdnImage('mattresscelan-booknow')],
  'sofa::carpet-cleaning': [cdnImage('carpetclean-booknow')],
  'sofa::dining-table-chairs-cleaning': [cdnImage('diningtable-chairs-clean-booknow')],
  'sofa::window-cleaning': [cdnImage('windowclean-booknow')],
  'sofa::cushion-cleaning': [cdnImage('cushionclean-booknow')],
  'mattress::single-mattress-clean': [cdnStatic('mattress-cleaning-post_card.webp')],
  'mattress::double-queen-mattress-clean': [cdnStatic('mattress-cleaning-post_card.webp')],
  'mattress::king-mattress-clean': [cdnStatic('mattress-cleaning-post_card.webp')],
  'mattress::mattress-protector-wash': [cdnStatic('mattress-cleaning-post_card.webp')],
  'window-glass::interior-windows-per-5': [cdnStatic('window-glass-interior-post_card.webp')],
  'window-glass::exterior-windows-per-5': [cdnStatic('window-glass-exterior-post_card.webp')],
  'window-glass::glass-door-per-door': [cdnStatic('window-glass-doors-post_card.webp')],
  'window-glass::mirror-clean-per-mirror': [cdnStatic('window-glass-mirrors-post_card.webp')],
  'ac-services::ac-repair': [cdnImage('acrepair-booknow')],
  'ac-services::foam-jet-ac-service': [cdnImage('foanjetacservice-booknow')],
  'ac-services::ac-gas-refill-checkup': [cdnImage('gasrefill-booknow')],
  'ac-services::ac-installation': [cdnImage('acinstall-booknow')],
  'ac-services::ac-uninstallation': [cdnImage('acuninstall-booknow')],
  'appliance-repair::wm-checkup': [cdnImage('wachingmachinecheckup-booknow')],
  'appliance-repair::wm-installation': [cdnImage('wachingmachineinstallation-booknow')],
  'appliance-repair::wm-uninstallation': [cdnImage('whachingmachinuninstallation-booknow')],
  'appliance-repair::fridge-checkup': [cdnImage('refrigeratorcheckup-booknow')],
  'appliance-repair::purifier-checkup': [cdnImage('waterpurifiervheckup-booknow')],
  'appliance-repair::purifier-filter-checkup': [cdnImage('waterpurifierfilterchekup-booknow')],
  'appliance-repair::purifier-regular-service': [cdnImage('waterpurifierregularservice-booknow')],
  'appliance-repair::purifier-installation': [cdnImage('waterpurifierinstallation-booknow')],
  'appliance-repair::purifier-uninstallation': [cdnImage('waterpurifieruninstallation-booknow')],
  'appliance-repair::geyser-checkup': [cdnImage('geysercheckup-booknow')],
  'appliance-repair::geyser-servicing': [cdnImage('geyserservice-booknow')],
  'appliance-repair::geyser-installation': [cdnImage('geyserinstallation-booknow')],
  'appliance-repair::geyser-uninstallation': [cdnImage('geyseruninstallation-booknow')],
};

export const BOOK_NOW_HUB_SECTION_SEED: BookNowHubSectionSeed[] = [
  {
    id: 'personal-assistance',
    title: 'Personal Assistance',
    iconKey: 'User',
    sortOrder: 5,
    services: [
      {
        id: 'personal-assistance',
        label: 'Personal Assistant',
        categorySlug: 'personal-assistance',
        imageUrl: cdnImage('personal-assistance'),
      },
    ],
  },
  {
    id: 'home-cleaning',
    title: 'Home Cleaning',
    iconKey: 'Broom',
    sortOrder: 10,
    services: [
      { id: 'full-house', label: 'Full House', categorySlug: 'full-house', imageUrl: cdnImage('fullhouse-booknow') },
      { id: 'bathroom', label: 'Bathroom', categorySlug: 'bathroom', imageUrl: cdnImage('bathroom-booknow') },
      { id: 'kitchen', label: 'Kitchen', categorySlug: 'kitchen', imageUrl: cdnImage('kitchen-booknow') },
      { id: 'sofa', label: 'Sofa', categorySlug: 'sofa', imageUrl: cdnImage('sofa-booknow') },
      { id: 'mattress', label: 'Mattress', categorySlug: 'mattress', imageUrl: cdnStatic('mattress-cleaning-post_card.webp') },
      { id: 'window-glass', label: 'Window Glass', categorySlug: 'window-glass', imageUrl: cdnStatic('window-glass-interior-post_card.webp') },
    ],
  },
  {
    id: 'ac-services',
    title: 'AC Services',
    iconKey: 'Snowflake',
    sortOrder: 20,
    services: [
      { id: 'ac-repair', label: 'AC Repair', categorySlug: 'ac-services', sectionId: 'repair', imageUrl: cdnImage('acrepair-booknow') },
      { id: 'ac-servicing', label: 'AC Servicing', categorySlug: 'ac-services', sectionId: 'servicing', imageUrl: cdnImage('acservicing-booknow') },
      { id: 'gas-refill', label: 'Gas Refill', categorySlug: 'ac-services', sectionId: 'gas-refill', imageUrl: cdnImage('gasrefill-booknow') },
      { id: 'install', label: 'Install', categorySlug: 'ac-services', sectionId: 'install', imageUrl: cdnImage('acinstall-booknow') },
      { id: 'uninstall', label: 'Uninstall', categorySlug: 'ac-services', sectionId: 'uninstall', imageUrl: cdnImage('acuninstall-booknow') },
    ],
  },
  {
    id: 'appliance-repair',
    title: 'Appliance Repair',
    iconKey: 'Wrench',
    sortOrder: 30,
    services: [
      { id: 'washing-machine', label: 'Washing Machine', categorySlug: 'appliance-repair', sectionId: 'washing-machine', imageUrl: cdnImage('wachingmachinecheckup-booknow') },
      { id: 'refrigerator', label: 'Refrigerator', categorySlug: 'appliance-repair', sectionId: 'refrigerator', imageUrl: cdnImage('refrigeratorcheckup-booknow') },
      { id: 'water-purifier', label: 'Water Purifier', categorySlug: 'appliance-repair', sectionId: 'water-purifier', imageUrl: cdnImage('waterpurifiervheckup-booknow') },
      { id: 'geyser', label: 'Geyser', categorySlug: 'appliance-repair', sectionId: 'geyser', imageUrl: cdnImage('geysercheckup-booknow') },
    ],
  },
];

