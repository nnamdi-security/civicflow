import type { Clock } from "../clock";

export const CODE_LENGTH = 6;
export const CODE_TTL_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;

/**
 * A six-digit code with no modulo bias. `randomBytes` is injected so the domain stays pure;
 * callers pass a cryptographic source.
 */
export function generateVerificationCode(randomBytes: (length: number) => Uint8Array): string {
  const limit = 250; // largest multiple of 10 that fits in a byte; larger bytes are rejected
  let code = "";
  while (code.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH * 2)) {
      if (byte >= limit) continue;
      code += String(byte % 10);
      if (code.length === CODE_LENGTH) break;
    }
  }
  return code;
}

export function codeExpiresAt(clock: Clock): Date {
  return new Date(clock.now().getTime() + CODE_TTL_MINUTES * 60_000);
}

/** Expired strictly after the stored time. */
export function isCodeExpired(expiresAt: Date, clock: Clock): boolean {
  return clock.now().getTime() > expiresAt.getTime();
}

export function isValidCodeFormat(input: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(input);
}
