import { z } from 'zod';

export const cancelEventParamsSchema = z.object({ id: z.uuid() });
