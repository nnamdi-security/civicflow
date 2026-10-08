# Integrations

All vendors are accessed through adapter interfaces in `src/server/adapters/`, with retries, timeouts, and in-memory fakes for tests.

## Cloudinary (media)
Signed uploads from the client. Limit file size and type (images only); store the public ID (not the URL) on Media. Strip EXIF location data unless used deliberately.

Adapter: `src/server/adapters/media/` (`MediaStorage` interface, `CloudinaryMediaStorage`, `FakeMediaStorage`, and `DevMediaStorage`). Flow and rules: ADR 0008. Signing is hand-rolled and checked against the example in Cloudinary's signature documentation. Config: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (all three or none). Without them, development and tests use the local `DevMediaStorage` (files in the gitignored `.dev-media/`, served by `/api/dev-media/*`), which refuses to run when `NODE_ENV=production`; production refuses to start without Cloudinary. Allowed formats: jpg, png, webp, heic; at most 10 MB; the browser resizes to 1600 px first.

Not yet exercised against a live Cloudinary account: real uploads, the metadata-stripping transformation, and the Admin API lookup. Do this before launch.

## Resend (email)
Transactional only: sign-in link, report received, acknowledged, resolved, escalated. Templates versioned in code.

Adapter: `src/server/adapters/email/` (`EmailSender` interface, `ResendEmailSender`, `FakeEmailSender`). Sign-in links are sent synchronously and not retried; report notifications (Phase 6) go through pg-boss. In local dev without `RESEND_API_KEY`, messages are written to the gitignored `.dev-outbox/` (never logged); read the latest with `pnpm dev:last-email`. Production refuses to start without Resend configured (ADR 0005).

## Termii (SMS)
Nigerian numbers in E.164 (+234). Sender ID registration required. Respect DND routes and opt-out. SMS is more expensive than email: reserve for key events.

## Leaflet / OpenStreetMap
Client-only component (`src/components/map-picker.tsx`, loaded with `ssr: false`). Follow the OSM tile usage policy (attribution is shown); plan to move to a tile provider before significant traffic. Default map view: Nigeria. The pin uses a custom icon because Leaflet's default marker images are not resolved by bundlers. The report form also offers "use my location" and typed latitude/longitude as accessible alternatives to the map.

## Secrets
Environment variables only; documented in `.env.example` (no real values).
