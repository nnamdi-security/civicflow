# 0008: Media upload flow

Status: Accepted

## Decision
Photos are uploaded directly from the browser to the media provider using a short-lived, server-signed request. The server issues the signature only after authentication, authorization and rate limiting, and scopes the upload to a per-reporter folder with allowed formats. When the report is submitted, the server re-verifies every photo with the provider (owner folder, format, size) before saving it. We store only the provider's `public_id` and metadata, and build image URLs server-side with small transforms.

Access goes through a `MediaStorage` adapter with three implementations: Cloudinary (production), an in-memory fake (tests), and a local-disk dev store used only outside production when Cloudinary is not configured.

## Rationale
Direct upload keeps large files off our server. Re-verification means a client cannot attach someone else's photo or an unchecked file by sending an arbitrary `public_id` or URL. Storing the `public_id` instead of a URL lets us change transforms without migrating data. The dev store keeps the full flow (including end-to-end tests) working without a Cloudinary account.

## Consequences
Stripping EXIF location data from stored originals must be confirmed against Cloudinary's behaviour and tested before launch (`docs/integrations.md`). The dev store must never be reachable in production: it refuses to start when `NODE_ENV=production`. Orphaned uploads (uploaded but never attached to a report) need a cleanup job, which fits the pg-boss work in Phase 5.
