import { customType } from "drizzle-orm/pg-core";

/**
 * Administrative boundary: geometry(MultiPolygon, 4326), lon/lat order.
 * Values are read and written as EWKB hex / WKT text; spatial logic stays in SQL (ST_*).
 */
export const multiPolygon = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geometry(MultiPolygon, 4326)";
  },
});
