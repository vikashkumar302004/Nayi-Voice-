import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.APP_SECRET ?? 'dev-only-change-this-secret');

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const storedBuffer = Buffer.from(key, 'hex');
  const candidate = scryptSync(password, salt, 64);
  return storedBuffer.length === candidate.length && timingSafeEqual(storedBuffer, candidate);
}

export async function createToken(userId: string, workspaceId: string, role: string) {
  return new SignJWT({ workspaceId, role }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId).setIssuedAt().setExpirationTime('7d').sign(secret);
}

export async function readToken(value?: string) {
  if (!value?.startsWith('Bearer ')) return null;
  try { return (await jwtVerify(value.slice(7), secret)).payload; } catch { return null; }
}
