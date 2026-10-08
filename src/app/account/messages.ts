const NOTICES: Record<string, { text: string; ok: boolean }> = {
  code_sent: { text: "We sent a 6-digit code to your phone. Enter it below.", ok: true },
  phone_verified: { text: "Phone number confirmed. You can now turn on SMS updates.", ok: true },
  phone_removed: { text: "Phone number removed.", ok: true },
  preferences_saved: { text: "Notification settings saved.", ok: true },
  malformed: { text: "Something was wrong with the form. Refresh the page and try again.", ok: false },
  invalid_phone: { text: "Enter a Nigerian mobile number, for example 0803 123 4567.", ok: false },
  already_verified: { text: "That number is already confirmed on your account.", ok: false },
  rate_limited: { text: "You have asked for several codes. Please wait a while and try again.", ok: false },
  sms_unavailable: { text: "SMS updates are not available right now.", ok: false },
  delivery_failed: { text: "We could not send the code. Check the number and try again.", ok: false },
  no_pending: { text: "There is no code waiting. Request a new one.", ok: false },
  expired: { text: "That code has expired. Request a new one.", ok: false },
  too_many_attempts: { text: "Too many wrong codes. Request a new one.", ok: false },
  wrong_code: { text: "That code is not right. Check it and try again.", ok: false },
  phone_not_verified: { text: "Confirm your phone number before turning on SMS updates.", ok: false },
};

/** Looks up a notice code from the URL; unknown codes show nothing. */
export function noticeFor(code: string | undefined) {
  return code && Object.hasOwn(NOTICES, code) ? NOTICES[code] : undefined;
}
