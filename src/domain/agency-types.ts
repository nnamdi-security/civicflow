/** Agency types match report categories (see docs/product.md and docs/routing.md). */
export const AGENCY_TYPES = [
  "roads",
  "drainage",
  "water",
  "power",
  "waste",
  "streetlights",
] as const;

export type AgencyType = (typeof AGENCY_TYPES)[number];

export const JURISDICTION_LEVELS = ["state", "lga"] as const;

export type JurisdictionLevel = (typeof JURISDICTION_LEVELS)[number];
