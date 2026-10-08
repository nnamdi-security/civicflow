# 0012: SMS consent and phone verification

Status: Accepted

## Decision
A phone number is optional personal data stored on the user. SMS is sent only to a resident who has added a Nigerian number, **verified** it, and switched SMS on. Verification texts a 6-digit code that is stored hashed, expires after 10 minutes, allows 5 attempts, and is rate limited per account. Numbers are normalized to E.164 (+234…) before storage. SMS is off by default and removing the number or switching SMS off stops it immediately.

SMS is reserved for two events: a report is resolved (asking the resident to confirm) and a report becomes publicly overdue. Other messages go by email only. Opt-out is an in-app toggle; handling "reply STOP" through Termii inbound webhooks is deferred.

Staff do not receive SMS. Staff escalation and dispute emails are operational and cannot be switched off; residents can switch off their own report emails.

## Rationale
Texting an unverified number risks sending report details to someone who never asked for them, which is a consent problem under the NDPA and a real cost for the recipient. Verification costs one extra SMS and some code. Limiting SMS to key events controls cost and avoids fatigue.

## Consequences
Adding a number costs one SMS per attempt, so verification is rate limited. Residents who never verify get email only. Reply-to-opt-out is not supported yet, so the in-app toggle is the only opt-out path. Sender ID registration and Nigerian DND routing must be sorted out with Termii before real sending.
