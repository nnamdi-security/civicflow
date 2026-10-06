# Integrations

All vendors are accessed through adapter interfaces in `src/server/adapters/`, with retries, timeouts, and in-memory fakes for tests.

## Cloudinary (media)
Signed uploads from the client. Limit file size and type (images only); store public ID and URL on Media. Strip EXIF location data unless used deliberately.

## Resend (email)
Transactional only: report received, acknowledged, resolved, escalated. Templates versioned in code.

## Termii (SMS)
Nigerian numbers in E.164 (+234). Sender ID registration required. Respect DND routes and opt-out. SMS is more expensive than email: reserve for key events.

## Leaflet / OpenStreetMap
Client-only component. Follow the OSM tile usage policy; plan to move to a tile provider before significant traffic. Default map view: Nigeria.

## Secrets
Environment variables only; documented in `.env.example` (no real values).
