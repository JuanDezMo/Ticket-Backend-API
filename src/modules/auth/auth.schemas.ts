import { z } from 'zod';
import { emailSchema, passwordSchema } from '../users/user.schemas.js';

// .strict() rechaza cualquier campo extra, incluido `role`, en el registro público
export const registerSchema = z.object({ email: emailSchema, password: passwordSchema }).strict();

export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();

export type RegisterBody = z.infer<typeof registerSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
