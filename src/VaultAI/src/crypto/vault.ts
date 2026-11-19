import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'node:crypto';
import type { EncryptedBlob } from '../types/index.js';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const SALT_LEN = 16;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export function deriveKey(masterPassword: string, salt: Buffer): Buffer {
  return scryptSync(masterPassword, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
}

export function encrypt(plaintext: string | Buffer, key: Buffer): EncryptedBlob {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const pt = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const enc = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: '', // salt is at vault level for master key; per-blob salt unused when key given
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: enc.toString('hex'),
  };
}

export function encryptWithPassword(plaintext: string | Buffer, password: string): EncryptedBlob {
  const salt = randomBytes(SALT_LEN);
  const key = deriveKey(password, salt);
  const blob = encrypt(plaintext, key);
  blob.salt = salt.toString('hex');
  return blob;
}

export function decrypt(blob: EncryptedBlob, key: Buffer): Buffer {
  const decipher = createDecipheriv(ALGO, key, Buffer.from(blob.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'hex')),
    decipher.final(),
  ]);
}

export function decryptWithPassword(blob: EncryptedBlob, password: string): Buffer {
  if (!blob.salt) throw new Error('Missing salt on encrypted blob');
  const key = deriveKey(password, Buffer.from(blob.salt, 'hex'));
  return decrypt(blob, key);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return `vai_${randomBytes(24).toString('base64url')}`;
}

export function generateId(prefix = 'id'): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

export const VERIFIER_PLAIN = 'vaultai-ok-v1';
