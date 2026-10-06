# 0001: Core stack

Status: Accepted

## Decision
Next.js, TypeScript (strict), PostgreSQL + PostGIS, Drizzle ORM, Tailwind, Cloudinary, Resend, Termii, Leaflet/OpenStreetMap. Package manager: pnpm.

## Rationale
PostGIS handles jurisdiction routing and spatial queries natively. Drizzle keeps SQL close and supports custom types for PostGIS. Termii and Resend cover Nigerian SMS and email delivery.

## Consequences
Hosting must provide PostGIS. Spatial columns need custom Drizzle types and hand-reviewed migrations.
