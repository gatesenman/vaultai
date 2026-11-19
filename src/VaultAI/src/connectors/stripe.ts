import type { PermissionLevel, ToolResult } from '../types/index.js';
import { levelAllows } from './permissions.js';
import { vendorBase } from './preset-base.js';


async function stripeFetch(
  secret: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${vendorBase('stripe')}/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep */
  }
  return { status: res.status, body };
}

/** Strip sensitive card fields if present */
function sanitizeStripe(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(sanitizeStripe);
  if (data && typeof data === 'object') {
    const o = { ...(data as Record<string, unknown>) };
    for (const k of ['number', 'cvc', 'cvc_check', 'exp_month', 'exp_year']) {
      if (k in o) delete o[k];
    }
    if (o.card && typeof o.card === 'object') {
      o.card = sanitizeStripe(o.card);
    }
    if (o.data) o.data = sanitizeStripe(o.data);
    // keep last4 / brand only on sources
    return o;
  }
  return data;
}

function needFor(action: string): PermissionLevel {
  if (action === 'list_customers' || action === 'list_charges' || action === 'list_payment_intents') {
    return 'read';
  }
  if (action === 'create_customer') return 'write';
  return 'full';
}

export async function stripeTool(
  action: string,
  args: Record<string, unknown>,
  secret: string,
  level: PermissionLevel
): Promise<ToolResult> {
  const need = needFor(action);
  if (!levelAllows(level, need)) {
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      message: `stripe:${action} requires ${need}; assistant has ${level}`,
      fix: `Raise Stripe permission to at least ${need}`,
    };
  }

  try {
    switch (action) {
      case 'list_customers': {
        const q = new URLSearchParams({ limit: String(args.limit || 20) });
        if (args.email) q.set('email', String(args.email));
        const { status, body } = await stripeFetch(secret, `/customers?${q}`);
        if (status >= 400) return { ok: false, code: 'STRIPE_API', message: `HTTP ${status}` };
        return { ok: true, data: sanitizeStripe(body) };
      }
      case 'list_charges': {
        const q = new URLSearchParams({ limit: String(args.limit || 20) });
        if (args.customer) q.set('customer', String(args.customer));
        const { status, body } = await stripeFetch(secret, `/charges?${q}`);
        if (status >= 400) return { ok: false, code: 'STRIPE_API', message: `HTTP ${status}` };
        return { ok: true, data: sanitizeStripe(body) };
      }
      case 'list_payment_intents': {
        const q = new URLSearchParams({ limit: String(args.limit || 20) });
        if (args.customer) q.set('customer', String(args.customer));
        const { status, body } = await stripeFetch(secret, `/payment_intents?${q}`);
        if (status >= 400) return { ok: false, code: 'STRIPE_API', message: `HTTP ${status}` };
        return { ok: true, data: sanitizeStripe(body) };
      }
      case 'create_customer': {
        const params = new URLSearchParams();
        if (args.email) params.set('email', String(args.email));
        if (args.name) params.set('name', String(args.name));
        if (args.description) params.set('description', String(args.description));
        const { status, body } = await stripeFetch(secret, '/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        if (status >= 400) return { ok: false, code: 'STRIPE_API', message: `HTTP ${status}` };
        return { ok: true, data: sanitizeStripe(body) };
      }
      default:
        return {
          ok: false,
          code: 'UNKNOWN_ACTION',
          message: `Unknown stripe action: ${action}`,
          fix: 'list_customers, list_charges, list_payment_intents, create_customer',
        };
    }
  } catch (e) {
    return {
      ok: false,
      code: 'STRIPE_NETWORK',
      message: e instanceof Error ? e.message : 'Network error',
    };
  }
}
