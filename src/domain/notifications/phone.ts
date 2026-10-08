/**
 * Nigerian mobile numbers. Accepts 0803 123 4567, +234 803 123 4567, 234803…, with spaces,
 * dashes or brackets, and returns E.164 (+234XXXXXXXXXX) or null. Mobile numbers have ten
 * digits after the country code starting 7, 8 or 9; landlines and short codes are refused.
 */
export function normalizeNigerianPhone(input: string): string | null {
  const cleaned = input.trim().replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(cleaned)) return null;
  const digits = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;

  let national: string;
  if (digits.startsWith("234")) national = digits.slice(3);
  else if (digits.startsWith("0")) national = digits.slice(1);
  else if (cleaned.startsWith("+")) return null; // another country's code
  else national = digits;

  return /^[789]\d{9}$/.test(national) ? `+234${national}` : null;
}

/** Shows only the last two digits, for confirming a number back to its owner. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 4)}${"*".repeat(Math.max(e164.length - 6, 0))}${e164.slice(-2)}`;
}
