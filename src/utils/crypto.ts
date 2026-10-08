import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * AES-256-GCM encryption for personal data stored in the database.
 * Format: "enc:v1:<iv b64>:<auth tag b64>:<ciphertext b64>"
 */
const PREFIX = 'enc:v1:';
const IV_LENGTH = 12;

let keyOverride: Buffer | undefined;

/** Used by tests to inject a key without touching process.env. */
export function setEncryptionKeyForTests(key: Buffer | undefined): void {
  keyOverride = key;
}

export function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const candidates: Buffer[] = [];
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) candidates.push(Buffer.from(trimmed, 'hex'));
  candidates.push(Buffer.from(trimmed, 'base64'));
  const key = candidates.find((b) => b.length === 32);
  if (!key) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes, encoded as base64 or 64 hex chars. Run `npm run gen:key`.');
  }
  return key;
}

function getKey(): Buffer {
  if (keyOverride) return keyOverride;
  const raw = env().ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY is not set. Run `npm run gen:key` and put the value in .env.');
  }
  return parseKey(raw);
}

export function generateKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decrypt(payload: string): string {
  if (!isEncrypted(payload)) {
    throw new Error('Value is not an encrypted payload');
  }
  const [ivB64, tagB64, ctB64] = payload.slice(PREFIX.length).split(':');
  if (!ivB64 || !tagB64 || ctB64 === undefined) throw new Error('Malformed encrypted payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
