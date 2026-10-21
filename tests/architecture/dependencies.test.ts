import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('architecture rules (dependency-cruiser)', () => {
  it('respects the layer and module dependency rules', () => {
    const result = spawnSync(
      'pnpm',
      ['exec', 'depcruise', 'src', '--config', '.dependency-cruiser.cjs'],
      {
        encoding: 'utf8',
      },
    );
    expect(result.stdout + result.stderr).toContain('no dependency violations found');
    expect(result.status).toBe(0);
  });
});
