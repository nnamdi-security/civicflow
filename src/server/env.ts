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

function parseWith<T>(schema: z.ZodType<T>, raw: Record<string, string | undefined>): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return result.data;
}
