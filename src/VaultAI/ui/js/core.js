// VaultAI UI core (v1.5): helpers, dialogs, clipboard, validation framework, strength meter, avatars.
import { estimateStrength, crackTimeBucket, isCommonPassword } from '/shared/strength.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const I = () => window.VaultI18n;
export const t = (k) => (I() ? I().t(k) : k);
/** t() with {placeholders} */
export const tf = (k, vars = {}) => t(k).replace(/\{(\w+)\}/g, (_, n) => (vars[n] ?? ''));
export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const ICONS = {
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3.2"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10.5 7 10.5 7a17 17 0 0 1-3.2 4M6.6 6.6C3.4 8.6 1.5 12 1.5 12S5.5 19 12 19c1.8 0 3.4-.5 4.8-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/></svg>',
  dice: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.3" class="fill"/><circle cx="15.5" cy="15.5" r="1.3" class="fill"/><circle cx="15.5" cy="8.5" r="1.3" class="fill"/><circle cx="8.5" cy="15.5" r="1.3" class="fill"/><circle cx="12" cy="12" r="1.3" class="fill"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.2v.3"/></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 22 20H2L12 3.5Z"/><path d="M12 10v4.5M12 17.2v.3"/></svg>',
  plug: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0V8ZM12 16.5V21"/></svg>',
};
const ICON_LABEL = { eye: 'a_show', copy: 'a_copy', dice: 'a_generate', external: 'a_open', x: 'a_close', refresh: 'a_regenerate', plug: 'a_test' };

export function applyIcons(root = document) {
  $$('[data-icon]', root).forEach((b) => {
    const name = b.dataset.icon;
    if (b.dataset.iconDone !== name) { b.innerHTML = ICONS[name] || ''; b.dataset.iconDone = name; }
    if (ICON_LABEL[name] && !b.dataset.labelFixed) {
      b.setAttribute('aria-label', t(ICON_LABEL[name]));
      b.title = t(ICON_LABEL[name]);
    }
  });
}

// ---------------- toast ----------------
let toastTimer = null;
export function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ---------------- API ----------------
export let onActivity = () => {};
export function setActivityHook(fn) { onActivity = fn; }
export async function api(path, init = {}) {
  onActivity();
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }, ...init });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.message || `HTTP ${res.status}`);
    err.code = json.code; err.json = json; err.status = res.status;
    throw err;
  }
  return json;
}

// ---------------- dialogs (Esc closes, Enter confirms, focus restore) ----------------
const dialogStack = [];
export function openDialog(el, { onRequestClose } = {}) {
  el.classList.remove('hidden');
  const prev = document.activeElement;
  dialogStack.push({ el, prev, onRequestClose });
  // Defer autofocus, but never steal focus if the user/script already focused inside the dialog
  // (Playwright fill can race a blind focus of the first field and type into the wrong input).
  setTimeout(() => {
    if (el.contains(document.activeElement) && document.activeElement !== el) return;
    const first = $('[autofocus]', el) || $('input:not([type=hidden]):not([readonly]):not(.hidden), select, textarea', el) || $('button.btn:not(.secondary)', el);
    first?.focus();
  }, 30);
}
export function closeDialog(el) {
  const i = dialogStack.findIndex((d) => d.el === el);
  el.classList.add('hidden');
  if (i >= 0) { const [d] = dialogStack.splice(i, 1); d.prev?.focus?.(); }
}
export function topDialog() { return dialogStack[dialogStack.length - 1]; }
document.addEventListener('keydown', (e) => {
  const top = topDialog();
  if (!top) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (top.onRequestClose) top.onRequestClose(); else closeDialog(top.el);
  }
  if (e.key === 'Tab') { // keep focus inside the dialog
    const f = $$('input:not([type=hidden]):not(.hidden):not([disabled]), select, textarea, button:not([disabled]):not([tabindex="-1"]), a[href]', top.el).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
});
document.addEventListener('mousedown', (e) => {
  const top = topDialog();
  if (top && e.target === top.el && top.el.id !== 'modal') { if (top.onRequestClose) top.onRequestClose(); else closeDialog(top.el); }
});

let modalResolve = null;
export function confirmDialog(title, body, { okText, danger = true } = {}) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    $('#modal-title').textContent = title;
    $('#modal-body').textContent = body;
    $('#modal-ok').textContent = okText || t('confirmBtn');
    $('#modal-ok').className = 'btn ' + (danger ? 'danger' : '');
    openDialog($('#modal'), { onRequestClose: () => finishModal(false) });
    setTimeout(() => $('#modal-ok').focus(), 40);
  });
}
function finishModal(v) { closeDialog($('#modal')); const r = modalResolve; modalResolve = null; r?.(v); }
$('#modal-cancel').onclick = () => finishModal(false);
$('#modal-ok').onclick = () => finishModal(true);

// ---------------- clipboard with auto-clear ----------------
export const clipboardState = { seconds: 30, timer: null, last: null };
export async function copyText(text, { secret = false } = {}) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast(t('copyFail'), 'err');
    return false;
  }
  clearTimeout(clipboardState.timer);
  const s = clipboardState.seconds;
  if (secret && s > 0) {
    clipboardState.last = text;
    toast(tf('c_copiedClears', { n: s }), 'ok');
    clipboardState.timer = setTimeout(clearClipboardNow, s * 1000);
  } else {
    toast(t('copied'), 'ok');
  }
  return true;
}
export async function clearClipboardNow() {
  const ours = clipboardState.last;
  clipboardState.last = null;
  if (ours == null) return;
  let current = null;
  try { current = await navigator.clipboard.readText(); } catch { current = ours; /* cannot read → clear to be safe */ }
  if (current === ours) {
    try { await navigator.clipboard.writeText(''); toast(t('c_clipCleared')); } catch { /* window unfocused */ }
  }
}

// ---------------- validation framework ----------------
const PATTERNS = {
  googleClientId: [/^\d{6,}-[a-z0-9]{8,}\.apps\.googleusercontent\.com$/i, 'v_googleClientId'],
  toolKey: [/^[a-z0-9_]+:[a-z0-9_]+$/, 'v_toolKey'],
  headerName: [/^[A-Za-z0-9-]{1,64}$/, 'v_headerName'],
};
/** Extra rules registered by pages: name → (value, el, form) => errorKey|string|null */
export const customRules = {};

export function parseRules(el) {
  return (el.dataset.rules || '').split('|').filter(Boolean).map((r) => {
    const i = r.indexOf(':');
    return i < 0 ? [r, ''] : [r.slice(0, i), r.slice(i + 1)];
  });
}

export function normalizeUrl(v) {
  const s = v.trim();
  if (!s) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s;
}

/** Returns an error message (already localized) or '' */
export function checkField(el) {
  const form = el.closest('form');
  const v = el.type === 'checkbox' ? el.checked : (el.value || '');
  const str = typeof v === 'string' ? v : '';
  for (const [rule, arg] of parseRules(el)) {
    if (rule === 'required' && !str.trim()) return t('v_required');
    if (rule === 'checked' && !el.checked) return t('v_ack');
    if (rule === 'requiredIfNew' && !str && !(form && $('#pw-id', form)?.value)) return t('v_required');
    if (!str) continue; // remaining rules only apply to non-empty values
    if (rule === 'minlen' && [...str].length < +arg) return tf('v_minlen', { n: arg });
    if (rule === 'maxlen' && [...str].length > +arg) return tf('v_maxlen', { n: arg });
    if (rule === 'int') {
      const [lo, hi] = arg.split('-').map(Number);
      if (!/^-?\d+$/.test(str.trim())) return t('v_int');
      const n = Number(str);
      if (n < lo || n > hi) return tf('v_range', { min: lo, max: hi });
    }
    if (rule === 'url') {
      try {
        const u = new URL(normalizeUrl(str));
        if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') && u.hostname !== 'localhost') return t('v_url');
      } catch { return t('v_url'); }
    }
    if (rule === 'httpsUrl') {
      try { const u = new URL(str); if (!/^https?:$/.test(u.protocol)) return t('v_httpsUrl'); } catch { return t('v_httpsUrl'); }
    }
    if (rule === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str)) return t('v_email');
    if (rule === 'emailIfAt' && str.includes('@') && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str)) return t('v_email');
    if (rule === 'prefix') {
      const list = arg.split(',');
      if (!list.some((p) => str.startsWith(p))) return tf('v_prefix', { p: list.join(' / ') });
    }
    if (rule === 'pattern') {
      const [re, key] = PATTERNS[arg] || [];
      if (re && !re.test(str.trim())) return t(key);
    }
    if (rule === 'match') { const other = document.getElementById(arg); if (other && other.value !== str) return t('v_match'); }
    if (rule === 'differs') { const other = document.getElementById(arg); if (other && other.value && other.value === str) return t('v_differs'); }
    if (rule === 'tags') {
      const tags = str.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      if (tags.some((x) => x.length > 30)) return t('v_tagLen');
      if (tags.length > 20) return t('v_tagCount');
    }
    if (rule === 'master') {
      const s = estimateStrength(str);
      if ([...str].length < 8) return tf('v_minlen', { n: 8 });
      if (isCommonPassword(str)) return t('v_common');
      if (s.score < 2) return t('v_tooWeak');
    }
    if (customRules[rule]) { const r = customRules[rule](str, el, form, arg); if (r) return r; }
  }
  return '';
}

function fieldOf(el) { return el.closest('.field') || el.closest('.callout') || el.parentElement; }

export function showFieldState(el, msg, { force = false } = {}) {
  const f = fieldOf(el);
  const errEl = f && $('.err', f);
  const touched = force || el.dataset.touched === '1';
  const show = touched && msg;
  el.classList.toggle('is-invalid', Boolean(show));
  el.setAttribute('aria-invalid', show ? 'true' : 'false');
  const hasFormatRule = parseRules(el).some(([r]) => !['required', 'maxlen', 'requiredIfNew', 'checked'].includes(r));
  el.classList.toggle('is-valid', Boolean(touched && !msg && el.value && hasFormatRule && el.type !== 'checkbox'));
  if (errEl) {
    if (!errEl.id) errEl.id = (el.id || 'f' + Math.random().toString(36).slice(2)) + '-err';
    errEl.innerHTML = show ? `${ICONS.alert}<span>${esc(msg)}</span>` : '';
    const help = f && $('.help', f);
    if (help && !help.id) help.id = (el.id || 'h') + '-help';
    el.setAttribute('aria-describedby', [help?.id, errEl.id].filter(Boolean).join(' '));
  }
}

export function validateForm(form, { force = true } = {}) {
  const errors = [];
  $$('[data-rules]', form).forEach((el) => {
    if (el.disabled || el.closest('.hidden')) return;
    const msg = checkField(el);
    if (force) el.dataset.touched = '1';
    showFieldState(el, msg, { force });
    if (msg) errors.push({ el, msg });
  });
  return errors;
}

export function labelFor(el) {
  const l = (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label');
  return (l?.textContent || el.getAttribute('aria-label') || el.name || el.id || '').replace(/\s*\*$/, '').trim();
}

export function renderSummary(form, errors) {
  const box = $('.form-errors', form);
  if (!box) return;
  if (!errors.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = `<strong>${ICONS.alert}${esc(tf('v_summary', { n: errors.length }))}</strong><ul>${errors.map((e, i) => `<li><a href="#" data-err-i="${i}">${esc(labelFor(e.el))}</a>: ${esc(e.msg)}</li>`).join('')}</ul>`;
  $$('[data-err-i]', box).forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); errors[+a.dataset.errI].el.focus(); }));
}

/** Live validity → submit button aria-disabled (still clickable to reveal the error summary). */
export function refreshSubmitState(form) {
  const btn = $('button[type=submit]', form);
  if (!btn) return;
  const invalid = $$('[data-rules]', form).some((el) => !el.disabled && !el.closest('.hidden') && checkField(el));
  btn.setAttribute('aria-disabled', invalid ? 'true' : 'false');
  btn.classList.toggle('is-disabled', invalid);
}

export async function withLoading(btn, fn) {
  if (!btn) return fn();
  btn.disabled = true; btn.classList.add('loading'); btn.setAttribute('aria-busy', 'true');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('loading'); btn.removeAttribute('aria-busy'); }
}

const handlers = new Map();
/** Wire a <form data-form> with validation, summary, loading state and dirty tracking. */
export function bindForm(form, onSubmit, { resetDirtyOnSuccess = true } = {}) {
  if (!form) return;
  handlers.set(form, onSubmit);
  if (form.dataset.bound) return;
  form.dataset.bound = '1';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    if (btn?.disabled) return;
    const errors = validateForm(form);
    renderSummary(form, errors);
    if (errors.length) { errors[0].el.focus(); return; }
    try {
      await withLoading(btn, () => handlers.get(form)(form));
      if (resetDirtyOnSuccess) markClean(form);
    } catch (err) {
      showServerError(form, err);
    }
  });
  form.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches?.('[data-rules]')) {
      if (el.dataset.touched === '1' || el.classList.contains('is-invalid')) showFieldState(el, checkField(el));
      // re-check dependants (confirm fields)
      $$(`[data-rules*="match:${el.id}"], [data-rules*="differs:${el.id}"]`, form).forEach((d) => { if (d.value) { d.dataset.touched = '1'; showFieldState(d, checkField(d)); } });
    }
    if (!el.matches?.('[data-noguard]')) form.dataset.dirty = '1';
    refreshSubmitState(form);
    if (!$('.form-errors', form)?.classList.contains('hidden')) renderSummary(form, validateForm(form, { force: false }).filter((x) => x.el.dataset.touched === '1'));
  });
  form.addEventListener('change', (e) => { if (!e.target.matches?.('[data-noguard]')) form.dataset.dirty = '1'; refreshSubmitState(form); });
  form.addEventListener('focusout', (e) => {
    const el = e.target;
    if (el.matches?.('[data-rules]') && (el.value || el.dataset.touched === '1' || el.type === 'checkbox')) {
      if (el.type === 'url' && el.value && !/^[a-z]+:\/\//i.test(el.value.trim())) el.value = normalizeUrl(el.value);
      el.dataset.touched = '1';
      showFieldState(el, checkField(el));
    }
  });
  refreshSubmitState(form);
}

export function showServerError(form, err) {
  const box = $('.form-errors', form);
  const msg = localizeServerError(err);
  if (box) {
    box.classList.remove('hidden');
    box.innerHTML = `<strong>${ICONS.alert}${esc(msg)}</strong>`;
  } else toast(msg, 'err');
}
export function localizeServerError(err) {
  const map = { BAD_PASSWORD: 'e_badPassword', WEAK_PASSWORD: 'v_tooWeak', VAULT_LOCKED: 'e_locked', SAME_PASSWORD: 'v_differs', RATE_LIMIT: 'e_rate', EXISTS: 'e_exists', BAD_URL: 'e_badUrl', URL_NOT_ALLOWED: 'e_urlNotAllowed', BAD_KIND: 'e_badKind', NO_BASE_URL: 'e_noBase' };
  if (err?.code && map[err.code]) return t(map[err.code]);
  if (/wrong|invalid master|bad password/i.test(err?.message || '')) return t('e_badPassword');
  return err?.message || String(err);
}

export function resetForm(form) {
  form.reset?.();
  $$('[data-rules]', form).forEach((el) => { delete el.dataset.touched; showFieldState(el, ''); });
  renderSummary(form, []);
  $$('.meter', form).forEach((m) => (m.innerHTML = ''));
  $$('.checklist', form).forEach((m) => (m.innerHTML = ''));
  $$('.match-ind', form).forEach((m) => (m.innerHTML = ''));
  $$('.warn-msg', form).forEach((m) => (m.innerHTML = ''));
  markClean(form);
  refreshSubmitState(form);
}
export function markClean(form) { delete form.dataset.dirty; }
export function isDirty(form) { return form?.dataset.dirty === '1'; }
/** Ask before discarding unsaved changes in any guarded form inside `root`. */
export async function guardLeave(root = document) {
  const dirty = $$('form[data-guard]', root).filter((f) => isDirty(f) && f.offsetParent !== null);
  if (!dirty.length) return true;
  const ok = await confirmDialog(t('u_title'), t('u_body'), { okText: t('u_discard') });
  if (ok) dirty.forEach((f) => resetForm(f));
  return ok;
}

// ---------------- password field helpers: eye, caps lock ----------------
export function wirePasswordAffordances(root = document) {
  $$('[data-eye]', root).forEach((b) => {
    if (b.dataset.eyeBound) return;
    b.dataset.eyeBound = '1';
    b.addEventListener('click', () => {
      const inp = document.getElementById(b.dataset.eye);
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.dataset.icon = show ? 'eyeOff' : 'eye';
      b.innerHTML = show ? ICONS.eyeOff : ICONS.eye; b.dataset.iconDone = b.dataset.icon;
      b.setAttribute('aria-label', t(show ? 'a_hide' : 'a_show')); b.title = b.getAttribute('aria-label');
      b.setAttribute('aria-pressed', show ? 'true' : 'false');
    });
  });
  $$('input[type=password], [data-caps-watch]', root).forEach((inp) => {
    if (inp.dataset.capsBound) return;
    inp.dataset.capsBound = '1';
    const ind = document.querySelector(`[data-caps-for="${inp.id}"]`);
    if (!ind) return;
    const upd = (e) => { if (e.getModifierState) ind.classList.toggle('hidden', !e.getModifierState('CapsLock')); };
    inp.addEventListener('keydown', upd);
    inp.addEventListener('keyup', upd);
    inp.addEventListener('blur', () => ind.classList.add('hidden'));
  });
}

// ---------------- strength meter + checklist ----------------
export const SCORE_KEYS = ['st_0', 'st_1', 'st_2', 'st_3', 'st_4'];
export function crackText(seconds) {
  const b = crackTimeBucket(seconds);
  return tf('ct_' + b.unit, { n: b.n });
}
export function renderMeter(meterEl, pw) {
  if (!meterEl) return null;
  if (!pw) { meterEl.innerHTML = ''; meterEl.removeAttribute('data-score'); return null; }
  const s = estimateStrength(pw);
  const master = meterEl.dataset.context === 'master';
  const secs = master ? s.crackSecondsSlow : s.crackSecondsOffline;
  // pattern hints only matter while the password is not yet strong
  const warn = s.score >= 3 ? '' : s.warnings.filter((w) => w !== 'empty').map((w) => t('sw_' + w)).filter(Boolean)[0] || '';
  meterEl.dataset.score = s.score;
  meterEl.innerHTML = `
    <div class="meter-bar" role="meter" aria-valuemin="0" aria-valuemax="4" aria-valuenow="${s.score}" aria-label="${esc(t('st_label'))}">${[0, 1, 2, 3].map((i) => `<span class="${i < Math.max(1, s.score) ? 'on' : ''}"></span>`).join('')}</div>
    <div class="meter-meta"><strong class="meter-label">${esc(t(SCORE_KEYS[s.score]))}</strong>
      <span class="meter-bits">≈ ${Math.round(s.bits)} ${esc(t('st_bits'))}</span>
      <span class="meter-crack">${esc(tf(master ? 'st_crackSlow' : 'st_crackFast', { t: crackText(secs) }))}</span></div>
    ${warn ? `<div class="meter-warn">${ICONS.warn}<span>${esc(warn)}</span></div>` : ''}`;
  return s;
}
export function renderChecklist(listEl, pw) {
  if (!listEl) return;
  const s = estimateStrength(pw || '');
  const items = [
    ['ck_len8', [...(pw || '')].length >= 8, true],
    ['ck_notCommon', !!pw && !isCommonPassword(pw), true],
    ['ck_fair', s.score >= 2, true],
    ['ck_len12', [...(pw || '')].length >= 12, false],
    ['ck_mix', s.classes.count >= 3 || /[\s\-_.]/.test(pw || '') && (pw || '').split(/[\s\-_.]+/).length >= 4, false],
  ];
  listEl.innerHTML = items.map(([k, ok, req]) => `<li class="${ok ? 'ok' : ''} ${req ? 'req' : 'rec'}">${ok ? ICONS.check : '<i></i>'}<span>${esc(t(k))}</span>${req ? '' : `<em>${esc(t('ck_recommended'))}</em>`}</li>`).join('');
}
export function renderMatch(indEl, a, b) {
  if (!indEl) return;
  if (!b) { indEl.innerHTML = ''; indEl.className = 'match-ind'; return; }
  const ok = a === b;
  indEl.className = 'match-ind ' + (ok ? 'ok' : 'no');
  indEl.innerHTML = (ok ? ICONS.check : ICONS.x) + `<span>${esc(t(ok ? 'm_match' : 'm_nomatch'))}</span>`;
}
/** Bind meter/checklist/match indicators declared in markup. */
export function wireStrengthUi(root = document) {
  $$('[data-meter-for]', root).forEach((m) => {
    const inp = document.getElementById(m.dataset.meterFor);
    if (!inp || inp.dataset.meterBound) return;
    inp.dataset.meterBound = '1';
    const list = document.querySelector(`[data-checklist-for="${inp.id}"]`);
    const upd = () => { renderMeter(m, inp.value); if (list) renderChecklist(list, inp.value); };
    inp.addEventListener('input', upd);
    inp._refreshMeter = upd;
  });
  $$('[data-match-for]', root).forEach((ind) => {
    const inp = document.getElementById(ind.dataset.matchFor);
    const rule = parseRules(inp).find(([r]) => r === 'match');
    const other = rule && document.getElementById(rule[1]);
    if (!inp || !other || inp.dataset.matchBound) return;
    inp.dataset.matchBound = '1';
    const upd = () => renderMatch(ind, other.value, inp.value);
    inp.addEventListener('input', upd); other.addEventListener('input', upd);
  });
}

// ---------------- avatars / site info ----------------
const siteCache = new Map();
export function hostOf(url) {
  try { return new URL(normalizeUrl(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
}
export function letterAvatar(el, text) {
  const s = (text || '?').trim();
  const ch = (s.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  let h = 0; for (const c of s.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  el.innerHTML = '';
  el.textContent = ch;
  el.style.setProperty('--av-h', String(h % 360));
  el.classList.remove('has-img');
}
export async function siteInfo(url) {
  const host = hostOf(url);
  if (!host) return null;
  if (!siteCache.has(host)) siteCache.set(host, api('/api/site-info?url=' + encodeURIComponent(normalizeUrl(url))).catch(() => null));
  return siteCache.get(host);
}
export async function avatarFor(el, url, fallbackText) {
  letterAvatar(el, fallbackText || hostOf(url));
  if (!url) return null;
  const info = await siteInfo(url);
  if (info?.icon && el.isConnected) {
    const img = new Image();
    img.alt = '';
    img.onload = () => { el.textContent = ''; el.appendChild(img); el.classList.add('has-img'); };
    img.src = info.icon;
  }
  return info;
}
