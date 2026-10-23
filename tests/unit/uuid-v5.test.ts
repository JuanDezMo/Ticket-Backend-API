import { describe, expect, it } from 'vitest';
import { uuidV5 } from '../../src/shared/utils/uuid-v5.js';

describe('uuidV5', () => {
  // Vector conocido de la RFC 4122 (espacio de nombres DNS)
  it('matches the reference value for the DNS namespace', () => {
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('is deterministic and depends on both the name and the namespace', () => {
    const ns = '3f6d9b5e-1c42-4a8e-9f7a-2d5b8c1e7a90';
    expect(uuidV5('a,b', ns)).toBe(uuidV5('a,b', ns));
    expect(uuidV5('a,b', ns)).not.toBe(uuidV5('a,c', ns));
    expect(uuidV5('a,b', ns)).not.toBe(uuidV5('a,b', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'));
  });
});
