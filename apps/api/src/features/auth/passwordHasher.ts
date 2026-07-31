import { Algorithm, hash, verify } from '@node-rs/argon2';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(encodedHash: string, password: string): Promise<boolean>;
}

const argon2idOptions = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const;

export const argon2idPasswordHasher: PasswordHasher = {
  hash(password) {
    return hash(password, argon2idOptions);
  },
  verify(encodedHash, password) {
    return verify(encodedHash, password);
  },
};
