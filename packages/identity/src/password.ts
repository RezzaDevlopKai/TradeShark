import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export type PasswordHash = string;

function encode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  if (password.length < 12) {
    throw new Error("Password must contain at least 12 characters");
  }

  const salt = randomBytes(SALT_BYTES);
  const derived = (await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 32 * 1024 * 1024
  })) as Buffer;

  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${encode(salt)}$${encode(derived)}`;
}

export async function verifyPassword(password: string, encodedHash: PasswordHash): Promise<boolean> {
  const [algorithm, nValue, rValue, pValue, saltValue, keyValue] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !nValue || !rValue || !pValue || !saltValue || !keyValue) {
    return false;
  }

  const N = Number(nValue);
  const r = Number(rValue);
  const p = Number(pValue);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) {
    return false;
  }

  try {
    const salt = decode(saltValue);
    const expected = decode(keyValue);
    const derived = (await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 32 * 1024 * 1024
    })) as Buffer;

    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
