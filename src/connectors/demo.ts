import type { PermissionLevel, ToolResult } from '../types/index.js';
import { levelAllows } from './permissions.js';

export function demoEcho(
  args: { message?: string },
  level: PermissionLevel
): ToolResult {
  if (!levelAllows(level, 'read')) {
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      message: 'demo:echo requires read',
      fix: 'Set Demo Echo access to Read',
    };
  }
  return {
    ok: true,
    data: {
      echo: String(args.message ?? 'hello from VaultAI'),
      at: new Date().toISOString(),
    },
  };
}

export function demoPing(level: PermissionLevel): ToolResult {
  if (!levelAllows(level, 'read')) {
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      message: 'demo:ping requires read',
    };
  }
  return { ok: true, data: { pong: true, service: 'VaultAI' } };
}
