import { getPreset, HTTP_PRESETS, type HttpPreset } from '../shared/presets.js';

/**
 * Presets with their effective base URL. VAULTAI_API_BASE_<PRESET> overrides the default
 * (self-hosted instances, and the E2E mock upstream).
 */
export function presetBaseUrl(id: string): string {
  const env = process.env[`VAULTAI_API_BASE_${id.toUpperCase()}`];
  if (env) {
    const extra: Record<string, string> = { sentry: '/api/0', slack: '/api' };
    return env.replace(/\/$/, '') + (extra[id] || '');
  }
  return getPreset(id).baseUrl;
}

export function resolvedPresets(): HttpPreset[] {
  return HTTP_PRESETS.map((p) => ({ ...p, baseUrl: p.id === 'custom' ? '' : presetBaseUrl(p.id) }));
}

const VENDOR_DEFAULTS = { github: 'https://api.github.com', notion: 'https://api.notion.com', stripe: 'https://api.stripe.com' } as const;
/** Base URL for the dedicated connectors. VAULTAI_API_BASE_<KIND> overrides it for tool calls and "Test connection" alike. */
export function vendorBase(kind: keyof typeof VENDOR_DEFAULTS): string {
  return (process.env[`VAULTAI_API_BASE_${kind.toUpperCase()}`] || VENDOR_DEFAULTS[kind]).replace(/\/$/, '');
}
