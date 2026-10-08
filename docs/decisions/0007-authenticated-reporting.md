# 0007: Reports require a signed-in reporter

Status: Accepted

## Decision
Only signed-in users can submit reports. Anonymous reporting is not offered in Phase 3. At least one and at most three photos are required per report.

## Rationale
Tracking and resident confirmation (Phase 7) need a known reporter, and notifications need a contact. Anonymous reporting would also need a separate abuse control (such as a CAPTCHA vendor) and a way to track a report without an account. Required photos give agencies evidence and make false or duplicate reports easier to spot.

## Consequences
Residents without an email address cannot report until phone OTP sign-in exists (Phase 6). Required photos raise the cost of reporting on slow connections, so photos are resized in the browser before upload. This resolves the "anonymous reporting" blocking decision for now; revisit it with a new ADR if adoption data shows the sign-in step is a barrier.
