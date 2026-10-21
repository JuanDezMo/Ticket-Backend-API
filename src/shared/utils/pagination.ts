import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 20;

// Un pageSize fuera de 1..20 se rechaza con 400; nunca se recorta en silencio
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export function buildPageMeta(params: PaginationParams, total: number): PageMeta {
  return {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.ceil(total / params.pageSize),
  };
}

export function paginate<T>(items: T[], params: PaginationParams, total: number): Page<T> {
  return { data: items, meta: buildPageMeta(params, total) };
}

export function offsetOf({ page, pageSize }: PaginationParams): number {
  return (page - 1) * pageSize;
}
