import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

/** Validates raw env at the boundary; throws with variable names only, never values. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return result.data;
}
