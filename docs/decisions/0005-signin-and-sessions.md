# 0005: Sign-in methods and sessions

Status: Accepted

## Decision
Phase 2 supports email magic link sign-in only, sent through the `EmailSender` adapter (Resend in production, in-memory fake in tests, console outbox in local dev). Sessions are stored in the database (Auth.js database strategy), not in JWTs. Everyone signs up as `resident`. Staff accounts are pre-provisioned by a platform admin (or an agency admin for their own agency) with a role and agency; the user then signs in by magic link to that email. The first platform admin is created with a one-off script (`pnpm admin:create <email>`).

## Rationale
Magic link proves email ownership, so pre-provisioning by email is safe and needs no invitation table. Database sessions make role changes and revocation take effect immediately, which matters for agency staff. Phone OTP would need Auth.js Credentials, which forces JWT sessions, and a Termii adapter that is not scheduled until Phase 6.

## Consequences
Sessions cannot be verified at the edge, so authorization lives in the entry-point layer (as `docs/architecture.md` already requires). Phone OTP is deferred to Phase 6 and will need its own ADR, because it changes the session strategy question. Residents without email are not served until then. Anonymous reporting remains undecided and does not affect this phase. Extends ADR 0003 without changing it.
