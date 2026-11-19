import type { AppKind, PermissionLevel } from '../types/index.js';

/** One ladder for every connection: off → read → write → full */
export const LEVELS: PermissionLevel[] = ['off', 'read', 'write', 'full'];
const RANK: Record<PermissionLevel, number> = { off: 0, read: 1, write: 2, full: 3 };

export function isLevel(v: unknown): v is PermissionLevel {
  return typeof v === 'string' && (LEVELS as string[]).includes(v);
}

export function levelAllows(have: PermissionLevel, need: PermissionLevel): boolean {
  return (RANK[have] ?? 0) >= RANK[need];
}

export function methodNeedsWrite(method: string): boolean {
  const m = method.toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}

/** Every connection uses the same four levels. */
export function levelsForApp(_kind: AppKind): PermissionLevel[] {
  return LEVELS;
}

/** The password vault has no "write": AI assistants can never create or edit items. */
export function levelsForPasswords(): PermissionLevel[] {
  return ['off', 'read', 'full'];
}

export const GOOGLE_SCOPES = {
  gmail_modify: 'https://www.googleapis.com/auth/gmail.modify',
  gmail_compose: 'https://www.googleapis.com/auth/gmail.compose',
  gmail_send: 'https://www.googleapis.com/auth/gmail.send',
  calendar: 'https://www.googleapis.com/auth/calendar',
  email: 'openid email profile',
};

export function googleConnectScopes(): string {
  return [GOOGLE_SCOPES.email, GOOGLE_SCOPES.gmail_modify, GOOGLE_SCOPES.gmail_compose, GOOGLE_SCOPES.gmail_send, GOOGLE_SCOPES.calendar].join(' ');
}
