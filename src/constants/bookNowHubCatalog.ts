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
  'full-house': cdnImage('fullhouse-booknow'),
  bathroom: cdnImage('bathroom-booknow'),
  kitchen: cdnImage('kitchen-booknow'),
  sofa: cdnImage('sofa-booknow'),
  mattress: cdnStatic('mattress-cleaning-post_card.webp'),
  'window-glass': cdnStatic('window-glass-interior-post_card.webp'),
  'ac-services': cdnImage('acrepair-booknow'),
  'appliance-repair': cdnImage('wachingmachinecheckup-booknow'),
};

export const BOOK_NOW_PACKAGE_IMAGE_URLS_BY_CATEGORY_AND_SKU: Record<string, string[]> = {
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

