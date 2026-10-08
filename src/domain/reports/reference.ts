// No 0/O, 1/I/L, or U: codes are read aloud and typed from SMS and email.
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const CODE_LENGTH = 8;

/**
 * Human-friendly report reference such as CF-7K3M9QXD. `randomBytes` is injected so the
 * domain stays pure; callers pass a cryptographic source.
 */
export function generateReference(randomBytes: (length: number) => Uint8Array): string {
  const limit = 256 - (256 % ALPHABET.length); // reject biased bytes
  let code = "";
  while (code.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH * 2)) {
      if (byte >= limit) continue;
      code += ALPHABET[byte % ALPHABET.length];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return `CF-${code}`;
}

export const REFERENCE_PATTERN = /^CF-[A-HJKMNP-TV-Z2-9]{8}$/;
