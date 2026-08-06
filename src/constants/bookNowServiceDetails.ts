/**
 * Book Now service catalog: what is included / not included for each package.
 * Keys match the catalogId and packageId from the backend seed data.
 * Used on the partner side to enrich the Book Now job details screen.
 */

export interface BookNowServiceDetail {
  catalogId: string;
  packageId: string;
  name: string;
  includes: string[];
  notIncludes: string[];
}

export const BOOK_NOW_SERVICE_DETAILS: BookNowServiceDetail[] = [
  // ─── Full House Cleaning ────────────────────────────────────────────────────
  {
    catalogId: 'full-house',
    packageId: '1bhk-economy',
    name: '1 BHK Economy Clean',
    includes: [
      'Bedroom sweeping & mopping',
      'Living room sweeping & mopping',
      'Kitchen platform & sink wipe',
      '1 bathroom cleaning (toilet, basin, floor)',
      'Dusting of fans, switches, and surfaces',
    ],
    notIncludes: [
      'Sofa or upholstery cleaning',
      'Inside kitchen cabinets',
      'Balcony deep scrubbing',
      'Appliance interior cleaning',
      'Wall washing',
    ],
  },
  {
    catalogId: 'full-house',
    packageId: '1bhk-deep',
    name: '1 BHK Deep Clean',
    includes: [
      'Everything in Economy Clean',
      'Sofa surface wipe',
      'Appliance exterior cleaning',
      'Balcony sweeping & mopping',
      'Inside cabinets (basic)',
    ],
    notIncludes: [
      'Inside appliances (fridge, microwave)',
      'Upholstery stain removal',
      'Wall washing',
      'Terrace or outdoor areas',
    ],
  },
  {
    catalogId: 'full-house',
    packageId: '2bhk-economy',
    name: '2 BHK Economy Clean',
    includes: [
      '2 bedrooms sweeping & mopping',
      'Living room sweeping & mopping',
      'Kitchen platform & sink wipe',
      '2 bathrooms cleaning',
      'Dusting of fans, switches, and surfaces',
    ],
    notIncludes: [
      'Sofa or upholstery cleaning',
      'Inside kitchen cabinets',
      'Balcony deep scrubbing',
      'Appliance interior cleaning',
      'Wall washing',
    ],
  },
  {
    catalogId: 'full-house',
    packageId: '2bhk-deep',
    name: '2 BHK Deep Clean',
    includes: [
      'Everything in 2 BHK Economy Clean',
      'Detailed appliance exterior cleaning',
      'Furniture surface wipe',
      'Inside kitchen cabinets (basic)',
      'Balcony sweeping & mopping',
    ],
    notIncludes: [
      'Appliance interior cleaning',
      'Upholstery stain removal',
      'Wall washing',
      'Terrace or outdoor areas',
    ],
  },
  {
    catalogId: 'full-house',
    packageId: '3bhk-economy',
    name: '3 BHK Economy Clean',
    includes: [
      '3 bedrooms sweeping & mopping',
      'Living room sweeping & mopping',
      'Kitchen platform & sink wipe',
      '3 bathrooms cleaning',
      'Dusting of fans, switches, and surfaces',
    ],
    notIncludes: [
      'Sofa or upholstery cleaning',
      'Inside kitchen cabinets',
      'Balcony deep scrubbing',
      'Appliance interior cleaning',
      'Wall washing',
    ],
  },
  {
    catalogId: 'full-house',
    packageId: '4bhk-economy',
    name: '4 BHK Economy Clean',
    includes: [
      '4 bedrooms sweeping & mopping',
      'Living room sweeping & mopping',
      'Kitchen platform & sink wipe',
      '4 bathrooms cleaning',
      'Dusting of fans, switches, and surfaces',
    ],
    notIncludes: [
      'Sofa or upholstery cleaning',
      'Inside kitchen cabinets',
      'Balcony deep scrubbing',
      'Appliance interior cleaning',
      'Wall washing',
    ],
  },
  {
    catalogId: 'full-house',
    packageId: 'combo-1bed',
    name: '1 Bedroom Combo',
    includes: [
      '1 bedroom sweeping & mopping',
      'Attached bathroom cleaning',
      'Dusting of fans and surfaces',
    ],
    notIncludes: [
      'Living room or kitchen',
      'Sofa or upholstery cleaning',
      'Appliance cleaning',
    ],
  },
  {
    catalogId: 'full-house',
    packageId: 'combo-2bed',
    name: '2 Bedroom Combo',
    includes: [
      '2 bedrooms sweeping & mopping',
      '2 attached bathrooms cleaning',
      'Dusting of fans and surfaces',
    ],
    notIncludes: [
      'Living room or kitchen',
      'Sofa or upholstery cleaning',
      'Appliance cleaning',
    ],
  },
  {
    catalogId: 'full-house',
    packageId: 'full-home-deep',
    name: 'Full Home Deep Clean',
    includes: [
      'All rooms sweeping, mopping & scrubbing',
      'Wall wiping (reachable areas)',
      'Fan blades and exhaust cleaning',
      'All bathrooms deep clean',
      'Kitchen platform, sink, and hob cleaning',
      'Appliance exterior wipe',
      'Balcony sweeping & mopping',
    ],
    notIncludes: [
      'Appliance interior cleaning',
      'Upholstery stain removal',
      'Pest control',
      'Terrace or compound area',
    ],
  },

  // ─── Bathroom Cleaning ───────────────────────────────────────────────────────
  {
    catalogId: 'bathroom',
    packageId: 'regular-clean',
    name: 'Bathroom Cleaning',
    includes: [
      'Toilet bowl and seat cleaning',
      'Basin and tap scrubbing',
      'Mirror cleaning',
      'Floor mopping',
      'Visible surface wiping',
      'Exhaust fan exterior wipe',
    ],
    notIncludes: [
      'Tile grout scrubbing',
      'Shower glass deep cleaning',
      'Drain unclogging',
      'Ceiling cleaning',
    ],
  },

  // ─── Kitchen Cleaning ────────────────────────────────────────────────────────
  {
    catalogId: 'kitchen',
    packageId: 'standard-kitchen-clean',
    name: 'Standard Kitchen Clean',
    includes: [
      'Platform (countertop) scrubbing',
      'Tile wipe',
      'Appliance exterior cleaning (fridge, microwave)',
      'Inside cabinet shelves (basic)',
      'Sink scrubbing',
      'Floor mopping',
    ],
    notIncludes: [
      'Chimney / hood deep cleaning',
      'Oven interior cleaning',
      'Degreasing of hob burners',
      'Drain unclogging',
    ],
  },
  {
    catalogId: 'kitchen',
    packageId: 'deep-kitchen-clean',
    name: 'Deep Kitchen Clean',
    includes: [
      'Everything in Standard Kitchen Clean',
      'Hob burner degreasing',
      'Sink descaling',
      'Tile deep scrubbing',
      'Cabinet exterior degreasing',
    ],
    notIncludes: [
      'Chimney internal cleaning',
      'Oven interior cleaning',
      'Drain unclogging',
    ],
  },
  {
    catalogId: 'kitchen',
    packageId: 'empty-kitchen-clean',
    name: 'Empty Kitchen Clean',
    includes: [
      'Deep scrubbing of all surfaces',
      'Cabinet interior and exterior',
      'Platform, sink, and tiles',
      'Floor mopping',
    ],
    notIncludes: [
      'Appliance cleaning (if present)',
      'Chimney cleaning',
      'Drain repair',
    ],
  },
  {
    catalogId: 'kitchen',
    packageId: 'kitchen-chimney-clean',
    name: 'Kitchen Chimney Clean',
    includes: [
      'Filter (baffle or mesh) cleaning',
      'Oil tray cleaning',
      'Chimney exterior wipe',
    ],
    notIncludes: [
      'Motor repair',
      'Filter replacement',
      'Electrical fault fixing',
    ],
  },
  {
    catalogId: 'kitchen',
    packageId: 'post-reno-kitchen-clean',
    name: 'Post Reno Kitchen Clean',
    includes: [
      'Construction dust removal',
      'Grout residue cleaning',
      'Paint spot removal (light)',
      'Tile scrubbing',
      'Platform and sink cleaning',
    ],
    notIncludes: [
      'Heavy paint stripping',
      'Wall sanding',
      'Appliance installation',
    ],
  },

  // ─── Sofa Cleaning ───────────────────────────────────────────────────────────
  {
    catalogId: 'sofa',
    packageId: '2-seater-dry-foam-wash',
    name: '2 Seater Dry Foam Wash',
    includes: [
      'Dry foam application on fabric',
      'Stain treatment',
      'Vacuuming of seat cushions',
      'Odour neutraliser',
    ],
    notIncludes: [
      'Leather sofa wet cleaning',
      'Cushion replacement',
      'Structural repair',
      'Wooden frame polishing',
    ],
  },
  {
    catalogId: 'sofa',
    packageId: '3-seater-dry-foam',
    name: '3 Seater Dry Foam Wash',
    includes: [
      'Dry foam application on fabric',
      'Stain treatment',
      'Vacuuming of seat cushions',
      'Odour neutraliser',
    ],
    notIncludes: [
      'Leather sofa wet cleaning',
      'Cushion replacement',
      'Structural repair',
      'Wooden frame polishing',
    ],
  },
  {
    catalogId: 'sofa',
    packageId: 'l-shape-dry-foam',
    name: 'L-Shape Dry Foam Wash',
    includes: [
      'Full L-shape dry foam application',
      'Stain treatment',
      'Cushion vacuuming',
      'Odour neutraliser',
    ],
    notIncludes: [
      'Leather or rexine sofa treatment',
      'Cushion replacement',
      'Structural repair',
    ],
  },
  {
    catalogId: 'sofa',
    packageId: 'sofa-chair-clean',
    name: 'Sofa Chair Clean',
    includes: [
      'Single chair dry foam wash',
      'Stain treatment',
      'Vacuuming',
    ],
    notIncludes: [
      'Leather treatment',
      'Cushion replacement',
    ],
  },

  // ─── Mattress Cleaning ───────────────────────────────────────────────────────
  {
    catalogId: 'mattress',
    packageId: 'single-mattress-clean',
    name: 'Single Mattress Clean',
    includes: [
      'UV sanitisation',
      'Vacuum cleaning (dust & allergens)',
      'Deodorising spray',
    ],
    notIncludes: [
      'Mattress protector wash',
      'Stain removal (heavy)',
      'Foam or spring repair',
    ],
  },
  {
    catalogId: 'mattress',
    packageId: 'double-queen-mattress-clean',
    name: 'Double/Queen Mattress Clean',
    includes: [
      'UV sanitisation',
      'Vacuum cleaning (dust & allergens)',
      'Deodorising spray',
    ],
    notIncludes: [
      'Mattress protector wash',
      'Stain removal (heavy)',
      'Foam or spring repair',
    ],
  },
  {
    catalogId: 'mattress',
    packageId: 'king-mattress-clean',
    name: 'King Mattress Clean',
    includes: [
      'UV sanitisation',
      'Vacuum cleaning (dust & allergens)',
      'Deodorising spray',
    ],
    notIncludes: [
      'Mattress protector wash',
      'Stain removal (heavy)',
      'Foam or spring repair',
    ],
  },
  {
    catalogId: 'mattress',
    packageId: 'mattress-protector-wash',
    name: 'Mattress Protector Wash',
    includes: [
      'Machine wash of mattress protector',
      'Drying',
      'Delivery within 48 hours',
    ],
    notIncludes: [
      'Ironing / pressing',
      'Mattress itself',
      'Stain guarantee on heavily soiled protectors',
    ],
  },

  // ─── Window & Glass Cleaning ─────────────────────────────────────────────────
  {
    catalogId: 'window-glass',
    packageId: 'interior-windows-per-5',
    name: 'Interior Windows (per 5)',
    includes: [
      'Inside glass surface cleaning (up to 5 windows)',
      'Frame wipe',
      'Streak-free finish',
    ],
    notIncludes: [
      'Exterior glass surface',
      'Window mesh / net cleaning',
      'Window repair',
    ],
  },
  {
    catalogId: 'window-glass',
    packageId: 'exterior-windows-per-5',
    name: 'Exterior Windows (per 5)',
    includes: [
      'Outside glass surface cleaning (up to 5 windows)',
      'Frame wipe',
      'Streak-free finish',
    ],
    notIncludes: [
      'Interior glass surface',
      'High-rise window cleaning (above 2nd floor)',
      'Window mesh / net cleaning',
    ],
  },
  {
    catalogId: 'window-glass',
    packageId: 'glass-door-per-door',
    name: 'Glass Door (per door)',
    includes: [
      'Full glass door surface cleaning (both sides)',
      'Frame wipe',
      'Handle wipe',
    ],
    notIncludes: [
      'Door repair or hinge fixing',
      'High-reach doors (above 8ft)',
    ],
  },
  {
    catalogId: 'window-glass',
    packageId: 'mirror-clean-per-mirror',
    name: 'Mirror Clean (per mirror)',
    includes: [
      'Streak-free mirror surface cleaning',
      'Frame wipe',
    ],
    notIncludes: [
      'Mirror repair or replacement',
      'Mirror silvering',
    ],
  },

  // ─── AC Services ─────────────────────────────────────────────────────────────
  {
    catalogId: 'ac-services',
    packageId: 'foam-blast-service',
    name: 'Foam Blast Service',
    includes: [
      'Jet wash of indoor unit',
      'Filter cleaning',
      'Coil (evaporator) wash',
      'Basic performance check',
    ],
    notIncludes: [
      'Gas refill',
      'Outdoor unit cleaning',
      'PCB or electrical repair',
      'Spare parts',
    ],
  },
  {
    catalogId: 'ac-services',
    packageId: 'premium-ac-service',
    name: 'Premium AC Service',
    includes: [
      'Full indoor unit deep clean',
      'Outdoor condenser coil clean',
      'Gas pressure check',
      'Electrical connections check',
      'Performance test',
    ],
    notIncludes: [
      'Gas refill (charged separately)',
      'Spare parts replacement',
      'PCB repair',
    ],
  },
  {
    catalogId: 'ac-services',
    packageId: 'anti-rust-service',
    name: 'Anti-Rust Service',
    includes: [
      'Full AC service (foam wash + coil clean)',
      'Anti-rust protective coat on outdoor unit',
      'Condenser fin straightening (minor)',
    ],
    notIncludes: [
      'Gas refill',
      'Spare parts',
      'Structural outdoor unit repair',
    ],
  },
  {
    catalogId: 'ac-services',
    packageId: 'r22-gas-refill',
    name: 'R22 Gas Refill',
    includes: [
      'R22 refrigerant refill',
      'Leak check before filling',
      'Pressure test after filling',
    ],
    notIncludes: [
      'AC servicing / cleaning',
      'Pipe leak repair',
      'Spare parts',
    ],
  },
  {
    catalogId: 'ac-services',
    packageId: 'r32-gas-refill',
    name: 'R32 Gas Refill',
    includes: [
      'R32 refrigerant refill',
      'Leak check before filling',
      'Pressure test after filling',
    ],
    notIncludes: [
      'AC servicing / cleaning',
      'Pipe leak repair',
      'Spare parts',
    ],
  },
  {
    catalogId: 'ac-services',
    packageId: 'split-ac-installation',
    name: 'Split AC Installation',
    includes: [
      'Mounting of indoor unit on wall',
      'Outdoor unit placement',
      'Copper pipe connection (up to 15 ft)',
      'Power cable connection',
      'Drain pipe setup',
      'Trial run',
    ],
    notIncludes: [
      'Extra copper piping beyond 15 ft (charged extra)',
      'Wall drilling through RCC/brick (basic holes only)',
      'AC stabiliser installation',
      'Any parts or materials',
    ],
  },
  {
    catalogId: 'ac-services',
    packageId: 'split-ac-uninstallation',
    name: 'Split AC Uninstallation',
    includes: [
      'Safe removal of indoor and outdoor units',
      'Pipe disconnection',
      'Gas recovery (basic)',
      'Packing support',
    ],
    notIncludes: [
      'Reinstallation at new location',
      'Disposal of old AC',
      'Wall patching',
    ],
  },
  {
    catalogId: 'ac-services',
    packageId: 'ac-diagnosis-inspection',
    name: 'AC Diagnosis / Inspection',
    includes: [
      'Technician visit',
      'Full unit inspection (indoor + outdoor)',
      'Gas level check',
      'Electrical connection check',
      'Fault diagnosis report',
    ],
    notIncludes: [
      'Repair or spare parts',
      'Gas refill',
      'Cleaning',
    ],
  },

  // ─── Appliance Repair ────────────────────────────────────────────────────────
  {
    catalogId: 'appliance-repair',
    packageId: 'wm-checkup',
    name: 'Washing Machine Check-Up',
    includes: [
      'Technician inspection',
      'Fault diagnosis',
      'Basic functional test',
    ],
    notIncludes: [
      'Spare parts',
      'Repair labour (charged separately)',
      'Drum cleaning',
    ],
  },
  {
    catalogId: 'appliance-repair',
    packageId: 'wm-installation',
    name: 'Washing Machine Installation',
    includes: [
      'Placement and levelling',
      'Inlet hose connection',
      'Drain hose connection',
      'Trial wash cycle',
    ],
    notIncludes: [
      'New inlet/drain pipes (if required)',
      'Electrical socket installation',
      'Washing machine itself',
    ],
  },
  {
    catalogId: 'appliance-repair',
    packageId: 'wm-uninstallation',
    name: 'Washing Machine Uninstallation',
    includes: [
      'Hose disconnection',
      'Safe removal of machine',
      'Area clean-up',
    ],
    notIncludes: [
      'Disposal of old machine',
      'Wall or floor repair',
    ],
  },
  {
    catalogId: 'appliance-repair',
    packageId: 'fridge-checkup',
    name: 'Refrigerator Check-Up',
    includes: [
      'Technician inspection',
      'Cooling and temperature test',
      'Fault diagnosis',
    ],
    notIncludes: [
      'Spare parts',
      'Gas refill',
      'Repair labour (charged separately)',
    ],
  },
  {
    catalogId: 'appliance-repair',
    packageId: 'purifier-checkup',
    name: 'Water Purifier Check-Up',
    includes: [
      'Complete unit inspection',
      'Water flow and pressure check',
      'TDS reading',
      'Fault diagnosis',
    ],
    notIncludes: [
      'Filter replacement',
      'Membrane replacement',
      'Repair parts',
    ],
  },
  {
    catalogId: 'appliance-repair',
    packageId: 'purifier-filter-checkup',
    name: 'Water Purifier Filter Check-Up',
    includes: [
      'Filter condition inspection',
      'Membrane condition check',
      'Flow test',
    ],
    notIncludes: [
      'Filter or membrane replacement (charged separately)',
      'Full unit repair',
    ],
  },
  {
    catalogId: 'appliance-repair',
    packageId: 'purifier-regular-service',
    name: 'Water Purifier Regular Service',
    includes: [
      'Full unit cleaning',
      'Internal tubing flush',
      'Performance and TDS testing',
      'Basic filter inspection',
    ],
    notIncludes: [
      'Filter or membrane replacement',
      'UV lamp replacement',
      'Repair parts',
    ],
  },
  {
    catalogId: 'appliance-repair',
    packageId: 'purifier-installation',
    name: 'Water Purifier Installation',
    includes: [
      'Wall mounting (if applicable)',
      'Inlet pipe connection',
      'Drain pipe connection',
      'Power connection',
      'Trial run and output check',
    ],
    notIncludes: [
      'Plumbing work beyond basic connection',
      'Electrical socket installation',
      'The purifier unit itself',
    ],
  },
  {
    catalogId: 'appliance-repair',
    packageId: 'purifier-uninstallation',
    name: 'Water Purifier Uninstallation',
    includes: [
      'Pipe disconnection (inlet + drain)',
      'Power disconnection',
      'Safe removal of unit',
    ],
    notIncludes: [
      'Wall patching',
      'Disposal of old unit',
    ],
  },
  {
    catalogId: 'appliance-repair',
    packageId: 'geyser-checkup',
    name: 'Geyser Check-Up',
    includes: [
      'Technician inspection',
      'Thermostat and heating element check',
      'Safety valve check',
      'Fault diagnosis',
    ],
    notIncludes: [
      'Spare parts',
      'Repair labour (charged separately)',
    ],
  },
  {
    catalogId: 'appliance-repair',
    packageId: 'geyser-servicing',
    name: 'Geyser Service',
    includes: [
      'Tank flushing and descaling',
      'Heating element cleaning',
      'Safety valve check',
      'Thermostat calibration',
    ],
    notIncludes: [
      'Spare parts replacement',
      'Pipe leak repair',
      'Electrical wiring work',
    ],
  },
  {
    catalogId: 'appliance-repair',
    packageId: 'geyser-installation',
    name: 'Geyser Installation',
    includes: [
      'Wall mounting',
      'Water pipe connection (inlet + outlet)',
      'Electrical connection',
      'Trial run',
    ],
    notIncludes: [
      'Pipes or fittings material',
      'Electrical wiring beyond standard connection',
      'The geyser unit itself',
    ],
  },
  {
    catalogId: 'appliance-repair',
    packageId: 'geyser-uninstallation',
    name: 'Geyser Uninstallation',
    includes: [
      'Water pipe disconnection',
      'Power disconnection',
      'Safe removal from wall',
    ],
    notIncludes: [
      'Wall patching',
      'Disposal of old geyser',
    ],
  },
];

/**
 * Get service details by catalogId and packageId (matched by task title + categorySlug).
 */
export function getBookNowServiceDetail(
  catalogId: string,
  packageId?: string,
): BookNowServiceDetail | undefined {
  const normalised = (s: string) => s.toLowerCase().trim();
  return BOOK_NOW_SERVICE_DETAILS.find(
    (d) =>
      normalised(d.catalogId) === normalised(catalogId) &&
      (!packageId || normalised(d.packageId) === normalised(packageId)),
  );
}

/**
 * Get service details by category slug only (falls back to first match for that category).
 * Used when only the task category is available.
 */
export function getBookNowServiceDetailByCategory(
  categorySlug: string,
): BookNowServiceDetail | undefined {
  const normalised = (s: string) => s.toLowerCase().trim();
  return BOOK_NOW_SERVICE_DETAILS.find(
    (d) => normalised(d.catalogId) === normalised(categorySlug),
  );
}

/**
 * Match service detail from the task title (subcategory/packageId) + categorySlug.
 * This is the primary lookup used in the partner job details screen.
 */
export function resolveBookNowServiceDetail(
  categorySlug: string,
  taskTitle?: string,
): BookNowServiceDetail | undefined {
  const normalised = (s: string) => s.toLowerCase().replace(/[-_\s]+/g, '-').trim();

  const normCat = normalised(categorySlug);
  const normTitle = taskTitle ? normalised(taskTitle) : undefined;

  // Try exact match on catalogId + name
  if (normTitle) {
    const byName = BOOK_NOW_SERVICE_DETAILS.find(
      (d) =>
        normalised(d.catalogId) === normCat &&
        normalised(d.name) === normTitle,
    );
    if (byName) return byName;

    // Try matching packageId (packageId is often the subcategory slug)
    const byPkg = BOOK_NOW_SERVICE_DETAILS.find(
      (d) =>
        normalised(d.catalogId) === normCat &&
        normalised(d.packageId) === normTitle,
    );
    if (byPkg) return byPkg;

    // Try if title contains packageId substring
    const bySubstr = BOOK_NOW_SERVICE_DETAILS.find(
      (d) =>
        normalised(d.catalogId) === normCat &&
        (normTitle.includes(normalised(d.packageId)) ||
          normalised(d.name).split(' ').some((w) => normTitle.includes(w))),
    );
    if (bySubstr) return bySubstr;
  }

  // Fallback: first entry for the category
  return BOOK_NOW_SERVICE_DETAILS.find(
    (d) => normalised(d.catalogId) === normCat,
  );
}
