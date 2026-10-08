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

/**
 * A point on the earth: geography(Point, 4326), lon/lat order (x = longitude).
 * Write it with ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography; read coordinates with
 * ST_X/ST_Y on a geometry cast.
 */
export const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geography(Point, 4326)";
  },
});
