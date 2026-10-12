import { customType } from 'drizzle-orm/sqlite-core';
import { decrypt, encrypt } from '../utils/crypto.js';

/** Text column transparently encrypted at rest (AES-256-GCM). */
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'text';
  },
  toDriver(value) {
    return encrypt(value);
  },
  fromDriver(value) {
    return decrypt(value);
  },
});

/** JSON object column encrypted at rest. */
export const encryptedJson = <T>() =>
  customType<{ data: T; driverData: string }>({
    dataType() {
      return 'text';
    },
    toDriver(value) {
      return encrypt(JSON.stringify(value));
    },
    fromDriver(value) {
      return JSON.parse(decrypt(value)) as T;
    },
  });
