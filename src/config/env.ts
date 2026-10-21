import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(3600),
  // El seed del primer ADMIN es opcional: si faltan, el arranque continúa con un aviso
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
  PAYMENT_GATEWAY_URL: z.url(),
  PAYMENT_GATEWAY_API_KEY: z.string().min(1),
  PAYMENT_GATEWAY_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  RESERVATION_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  RESERVATION_EXPIRY_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
});

export type Env = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  readonly variables: string[];

  constructor(variables: string[]) {
    super(`Invalid or missing environment variables: ${variables.join(', ')}`);
    this.name = 'ConfigError';
    this.variables = variables;
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Las variables vacías (ej. "SEED_ADMIN_EMAIL=") se tratan como no definidas
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigError(names);
  }
  return result.data;
}
