---
paths:
  - "src/app/**/*.tsx"
  - "src/components/**"
---

- Server components by default; add `"use client"` only when needed.
- Leaflet is client-only: load via dynamic import with `ssr: false`.
- Mobile-first, low-bandwidth: small images (Cloudinary transforms), no heavy dependencies.
- Tailwind utilities; extract components rather than long repeated class strings.
- Accessible by default: labels, focus states, sufficient contrast, keyboard operable. Status is never conveyed by colour alone.
- Never show reporter identity or contact details on public views.
