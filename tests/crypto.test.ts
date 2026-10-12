import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, isEncrypted, parseKey, sha256 } from '../src/utils/crypto.js';

describe('crypto', () => {
  it('round-trips text and uses a random IV', () => {
    const a = encrypt('alex.martin@example.com');
    const b = encrypt('alex.martin@example.com');
    expect(a).not.toEqual(b);
    expect(isEncrypted(a)).toBe(true);
    expect(a).not.toContain('alex');
    expect(decrypt(a)).toBe('alex.martin@example.com');
  });

  it('detects tampering (GCM auth tag)', () => {
    const payload = encrypt('secret');
    const parts = payload.split(':');
    const ct = Buffer.from(parts[4]!, 'base64');
    ct[0] = ct[0]! ^ 0xff;
    parts[4] = ct.toString('base64');
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('accepts base64 or hex 32-byte keys and rejects others', () => {
    expect(parseKey(Buffer.alloc(32, 1).toString('base64')).length).toBe(32);
    expect(parseKey('ab'.repeat(32)).length).toBe(32);
    expect(() => parseKey('too-short')).toThrow(/32 bytes/);
  });

  it('hashes deterministically', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
