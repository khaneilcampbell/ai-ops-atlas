import { FINANCIAL_BUILDINGS, financialKey, type FinancialPlan } from "./financialPlan";
import { DEALERSHIP_KEY, type DealershipPlan } from "./dealershipPlan";

/** Existing buildings retain their selection IDs and routes inside one district. */
export const FINANCIAL_MEMBERS = [
  ...FINANCIAL_BUILDINGS.map(b => ({ key: financialKey(b.id), name: b.name, role: b.role })),
  { key: DEALERSHIP_KEY, name: "Vantor Motors", role: "Automotive showroom · Visual infrastructure" },
];

/** District framing includes the west residence and east showroom parcels without moving them. */
export function financialDistrictBounds(f: FinancialPlan, dealership?: DealershipPlan) {
  const parcels = [f, ...(f.circa ? [f.circa] : []), ...(dealership ? [dealership.lot] : [])];
  const x = Math.min(...parcels.map(p => p.x)), z = Math.min(...parcels.map(p => p.z));
  return { x, z, w: Math.max(...parcels.map(p => p.x + p.w)) - x, d: Math.max(...parcels.map(p => p.z + p.d)) - z };
}
