import { describe, expect, it } from 'vitest';
import { buildPageMeta, paginate, paginationSchema } from '../../src/shared/utils/pagination.js';

describe('paginationSchema', () => {
  it('applies defaults', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('coerces strings from the query string', () => {
    expect(paginationSchema.parse({ page: '2', pageSize: '5' })).toEqual({ page: 2, pageSize: 5 });
  });

  it('accepts pageSize 1 and 20', () => {
    expect(paginationSchema.safeParse({ pageSize: '1' }).success).toBe(true);
    expect(paginationSchema.safeParse({ pageSize: '20' }).success).toBe(true);
  });

  it.each(['21', '100', '0', '-1', 'abc', '1.5', ''])(
    'rejects pageSize %j without clamping',
    (v) => {
      expect(paginationSchema.safeParse({ pageSize: v }).success).toBe(false);
    },
  );

  it.each(['0', '-1', 'abc', '1.5', ''])('rejects page %j', (v) => {
    expect(paginationSchema.safeParse({ page: v }).success).toBe(false);
  });
});

describe('buildPageMeta / paginate', () => {
  it.each([
    [0, 0],
    [20, 1],
    [21, 2],
    [45, 3],
  ])('%i records at pageSize 20 give %i pages', (total, totalPages) => {
    expect(buildPageMeta({ page: 1, pageSize: 20 }, total)).toEqual({
      page: 1,
      pageSize: 20,
      total,
      totalPages,
    });
  });

  it('wraps items in { data, meta }', () => {
    expect(paginate(['a'], { page: 1, pageSize: 20 }, 1)).toEqual({
      data: ['a'],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
  });
});
