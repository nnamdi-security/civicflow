# 0003: Auth.js for authentication

Status: Accepted

## Decision
Use Auth.js with the Drizzle adapter. Roles stored on the user record: resident, agency_officer, agency_admin, platform_admin.

## Rationale
Native Next.js integration and no third-party auth service dependency.

## Consequences
Sign-in methods are TBD (email magic link via Resend and/or phone OTP via Termii are the likely candidates). Authorization is our responsibility and is enforced in the entry-point layer.
