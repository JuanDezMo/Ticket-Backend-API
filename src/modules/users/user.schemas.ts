import { z } from 'zod';
import { ROLE_VALUES } from '../../shared/security/roles.js';

export const MIN_PASSWORD_LENGTH = 8;

export const emailSchema = z.string().trim().email().max(254);
export const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(128);

// Creación por un ADMIN: el rol es obligatorio
export const createUserSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    role: z.enum(ROLE_VALUES),
  })
  .strict();

export type CreateUserBody = z.infer<typeof createUserSchema>;
