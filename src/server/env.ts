import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

/** Validates raw env at the boundary; throws with variable names only, never values. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  return parseWith(envSchema, raw);
}

const authEnvSchema = z
  .object({
    AUTH_SECRET: z.string().min(32),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(3).optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .refine((env) => env.RESEND_API_KEY === undefined || env.EMAIL_FROM !== undefined, {
    path: ["EMAIL_FROM"],
    message: "required when RESEND_API_KEY is set",
  });

export type AuthEnv = z.infer<typeof authEnvSchema>;

export function parseAuthEnv(raw: Record<string, string | undefined>): AuthEnv {
  return parseWith(authEnvSchema, raw);
}

const mediaEnvSchema = z
  .object({
    AUTH_SECRET: z.string().min(32),
    CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
    CLOUDINARY_API_KEY: z.string().min(1).optional(),
    CLOUDINARY_API_SECRET: z.string().min(1).optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .refine(
    (env) => {
      const set = [env.CLOUDINARY_CLOUD_NAME, env.CLOUDINARY_API_KEY, env.CLOUDINARY_API_SECRET];
      return set.every((v) => v !== undefined) || set.every((v) => v === undefined);
    },
    { path: ["CLOUDINARY_CLOUD_NAME"], message: "set all three Cloudinary variables or none" },
  );

export type MediaEnv = z.infer<typeof mediaEnvSchema>;

export function parseMediaEnv(raw: Record<string, string | undefined>): MediaEnv {
  return parseWith(mediaEnvSchema, raw);
}

const emailEnvSchema = z
  .object({
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(3).optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .refine((env) => env.RESEND_API_KEY === undefined || env.EMAIL_FROM !== undefined, {
    path: ["EMAIL_FROM"],
    message: "required when RESEND_API_KEY is set",
  });

/** What the email sender needs; the worker has no AUTH_SECRET, so it cannot use AuthEnv. */
export type EmailEnv = z.infer<typeof emailEnvSchema>;

export function parseEmailEnv(raw: Record<string, string | undefined>): EmailEnv {
  return parseWith(emailEnvSchema, raw);
}

const appEnvSchema = z
  .object({
    AUTH_URL: z.url().optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .transform((env, ctx) => {
    if (env.AUTH_URL === undefined && env.NODE_ENV === "production") {
      ctx.addIssue({ code: "custom", path: ["AUTH_URL"], message: "required in production" });
      return z.NEVER;
    }
    return { baseUrl: env.AUTH_URL ?? "http://localhost:3000" };
  });

/** The public base URL used in message links. */
export type AppEnv = z.infer<typeof appEnvSchema>;

export function parseAppEnv(raw: Record<string, string | undefined>): AppEnv {
  return parseWith(appEnvSchema, raw);
}

const smsEnvSchema = z
  .object({
    TERMII_API_KEY: z.string().min(1).optional(),
    TERMII_SENDER_ID: z.string().min(1).max(11).optional(),
    TERMII_BASE_URL: z.url().default("https://api.ng.termii.com"),
    TERMII_CHANNEL: z.enum(["generic", "dnd"]).default("dnd"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .refine((env) => (env.TERMII_API_KEY === undefined) === (env.TERMII_SENDER_ID === undefined), {
    path: ["TERMII_SENDER_ID"],
    message: "set both TERMII_API_KEY and TERMII_SENDER_ID, or neither",
  });

export type SmsEnv = z.infer<typeof smsEnvSchema>;

export function parseSmsEnv(raw: Record<string, string | undefined>): SmsEnv {
  return parseWith(smsEnvSchema, raw);
}

function parseWith<T>(schema: z.ZodType<T>, raw: Record<string, string | undefined>): T {
  // `KEY=` in a .env file yields an empty string; treat blank values as unset.
  const present = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined && value !== ""));
  const result = schema.safeParse(present);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return result.data;
}
