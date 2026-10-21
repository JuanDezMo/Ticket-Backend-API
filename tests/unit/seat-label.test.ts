import { describe, expect, it } from 'vitest';
import { parseSeatLabel } from '../../src/modules/seats/seat-label.js';

describe('parseSeatLabel', () => {
  it.each([
    ['C7', 'C', 7],
    ['A1', 'A', 1],
    ['A10', 'A', 10],
    ['Z10', 'Z', 10],
    ['c7', 'C', 7],
    [' b3 ', 'B', 3],
  ])('parses %j', (label, row, number) => {
    expect(parseSeatLabel(label)).toEqual({ row, number });
  });

  it.each(['7C', 'C0', 'C11', 'C', '7', '', ' ', 'AA1', 'C-1', 'C07', 'Ñ1', '1A'])(
    'rejects %j',
    (label) => {
      expect(parseSeatLabel(label)).toBeNull();
    },
  );
});
