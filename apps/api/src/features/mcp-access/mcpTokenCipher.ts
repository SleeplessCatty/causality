import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const tokenPattern = /^cau_pat_[A-Za-z0-9_-]{43}$/;

export interface McpTokenContext {
  userId: string;
  tokenId: string;
}

export interface EncryptedMcpToken {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export interface McpTokenCipher {
  encrypt(token: string, context: McpTokenContext): EncryptedMcpToken;
  decrypt(encrypted: EncryptedMcpToken, context: McpTokenContext): string;
  mask(token: string): string;
}

function parseKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32 || key.toString('base64') !== base64Key) {
    throw new Error('Invalid MCP token encryption key');
  }
  return key;
}

function additionalAuthenticatedData(context: McpTokenContext): Buffer {
  return Buffer.from(`mcp-token\0${context.userId}\0${context.tokenId}`, 'utf8');
}

function validateToken(token: string): void {
  if (!tokenPattern.test(token)) throw new Error('Invalid MCP personal access token');
}

export function createAesGcmMcpTokenCipher(base64Key: string): McpTokenCipher {
  const key = parseKey(base64Key);
  return {
    encrypt(token, context) {
      validateToken(token);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(additionalAuthenticatedData(context));
      const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
      return { ciphertext, iv, authTag: cipher.getAuthTag() };
    },
    decrypt(encrypted, context) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, encrypted.iv);
        decipher.setAAD(additionalAuthenticatedData(context));
        decipher.setAuthTag(encrypted.authTag);
        const token = Buffer.concat([
          decipher.update(encrypted.ciphertext),
          decipher.final(),
        ]).toString('utf8');
        validateToken(token);
        return token;
      } catch (error) {
        throw new Error('Unable to decrypt MCP token', { cause: error });
      }
    },
    mask(token) {
      validateToken(token);
      return `cau_pat_${token.slice(8, 12)}••••${token.slice(-4)}`;
    },
  };
}
