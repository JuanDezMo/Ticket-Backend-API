import { describe, expect, it } from 'vitest';
import { generateSeatLayout } from '../../src/modules/seats/seat-layout.js';

describe('generateSeatLayout', () => {
  it.each([
    [1, 'A1', 'A1'],
    [10, 'A1', 'A10'],
    [20, 'A1', 'B10'],
    [25, 'A1', 'C5'],
    [100, 'A1', 'J10'],
    [260, 'A1', 'Z10'],
  ])('capacity %i goes from %s to %s with exactly that many seats', (capacity, first, last) => {
    const layout = generateSeatLayout(capacity);
    const labels = layout.map((s) => `${s.row}${s.number}`);
    expect(layout).toHaveLength(capacity);
    expect(labels[0]).toBe(first);
    expect(labels.at(-1)).toBe(last);
    expect(new Set(labels).size).toBe(capacity);
  });

  it('leaves the last row incomplete when capacity is not a multiple of 10', () => {
    const layout = generateSeatLayout(25);
    expect(layout.filter((s) => s.row === 'C')).toHaveLength(5);
    expect(layout.filter((s) => s.row === 'B')).toHaveLength(10);
  });
});
