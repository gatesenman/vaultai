/* VaultAI 1.6.1 mini picker renderer. Keys come from the main process
   (global hook while open, window never takes focus) or local keydown
   (browser harness / inline-filter mode). */
import { reduceKey, avatarFor, MINI } from './mini-core.js';

const I18N = {
  en: {
    none: 'No match', save: 'Save this login', open: 'Open VaultAI', foot: '↑↓ · Enter/Tab fill · 1–6 · Esc',
    site: '{h}', win: '{t}', confirm: 'Fill “{title}”?', filter: 'Filter…', untitled: '(untitled)',
  },
  'zh-CN': {
    none: '无匹配', save: '保存此登录', open: '打开 VaultAI', foot: '↑↓ · Enter/Tab 填入 · 1–6 · Esc',
    site: '{h}', win: '{t}', confirm: '填入「{title}」？', filter: '筛选…', untitled: '（无标题）',
  },
};

const params = new URLSearchParams(location.search);
const port = params.get('port') || '3847';
let lang = params.get('lang') === 'en' ? 'en' : 'zh-CN';
let typed = params.get('typed') || '';
let host = params.get('host') || '';
let title = params.get('title') || '';
let processName = params.get('process') || '';
const needConfirm = params.get('confirm') === '1';
const inlineFilter = params.get('inline') === '1';

const t = (k, v) => {
  let s = (I18N[lang] || I18N['zh-CN'])[k] || k;
  if (v) for (const [a, b] of Object.entries(v)) s = s.replace('{' + a + '}', b);
  return s;
};
const $ = (id) => document.getElementById(id);
const listEl = $('list');
const footEl = $('foot');
const qEl = $('q');

let matches = [];
let idx = 0;
let seq = 0;
let timer = null;

const mask = (u) => (u.length <= 3 ? '•••' : u.slice(0, 2) + '•••' + u.slice(-1));

function sourceHint() {
  if (host) { try { return new URL(host).hostname; } catch { return host; } }
  return (title || '').slice(0, 40);
}

function updateFoot() {
  const src = sourceHint();
  footEl.textContent = src ? src + ' · ' + t('foot') : t('foot');
}

function render() {
  listEl.innerHTML = '';
  if (!matches.length) {
    const make = (label, action, on) => {
      const li = document.createElement('li');
      li.className = 'row none' + (on ? ' on' : '');
      li.dataset.none = '1';
      li.dataset.action = action;
      li.innerHTML = '<span class="av">' + (action === 'save' ? '+' : 'V') + '</span>';
      const s = document.createElement('span'); s.className = 'tt'; s.style.maxWidth = '100%';
      s.textContent = label;
      li.appendChild(s);
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (action === 'save') saveLogin();
        else openApp();
      });
      listEl.appendChild(li);
    };
    make(t('save'), 'save', true);
    make(t('open'), 'open', false);
  } else {
    matches.forEach((m, i) => {
      const li = document.createElement('li');
      li.className = 'row' + (i === idx ? ' on' : '');
      li.setAttribute('role', 'option');
      li.dataset.id = m.id;
      const a = avatarFor(m.title || m.username);
      const av = document.createElement('span');
      av.className = 'av'; av.textContent = a.letter;
      av.style.background = `hsl(${a.hue} 55% 58%)`;
      const tt = document.createElement('span'); tt.className = 'tt';
      tt.textContent = m.title || m.username || t('untitled');
      const us = document.createElement('span'); us.className = 'us';
      us.textContent = mask(m.username || '');
      const kb = document.createElement('span'); kb.className = 'kb';
      kb.textContent = i < 6 ? String(i + 1) : '';
      li.append(av, tt, us, kb);
      li.addEventListener('mouseenter', () => { idx = i; highlight(); });
      // mousedown + preventDefault: never steal focus from the target app
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
      listEl.appendChild(li);
    });
  }
  updateFoot();
  const n = Math.max(1, Math.min(MINI.maxRows, matches.length || 2));
  window.VaultAutofill?.resize?.(n + (inlineFilter ? 0 : 0), inlineFilter);
  document.body.dataset.count = String(matches.length);
}

function highlight() {
  [...listEl.children].forEach((li, i) => li.classList.toggle('on', i === idx));
  listEl.children[idx]?.scrollIntoView({ block: 'nearest' });
  document.body.dataset.idx = String(idx);
}

async function search(q) {
  const my = ++seq;
  try {
    const r = await fetch('http://127.0.0.1:' + port + '/api/autofill/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typed: q, host, windowTitle: title, processName }),
    });
    const j = await r.json();
    if (my !== seq) return;
    matches = j && j.ok && j.matches ? j.matches : [];
  } catch { if (my !== seq) return; matches = []; }
  idx = 0;
  render();
  document.body.dataset.ready = '1';
}

async function pick(i) {
  const m = matches[i];
  if (!m) return;
  if (needConfirm && !window.confirm(t('confirm', { title: m.title || m.username }))) return;
  document.body.dataset.picked = m.id;
  await window.VaultAutofill?.fill?.(m.id);
}
function openApp() { document.body.dataset.picked = 'open-app'; window.VaultAutofill?.openApp?.(); }
function saveLogin() { document.body.dataset.picked = 'save-login'; window.VaultAutofill?.saveLogin?.(); }
function dismiss() { document.body.dataset.dismissed = '1'; window.VaultAutofill?.dismiss?.(); }

export function handleKey(key) {
  if (!matches.length) {
    if (key === 'Escape') { dismiss(); return { action: 'dismiss' }; }
    const kids = [...listEl.children];
    const cur = Math.max(0, kids.findIndex((li) => li.classList.contains('on')));
    const activate = (i) => {
      const action = kids[i]?.dataset?.action || 'save';
      if (action === 'open') { openApp(); return { action: 'open-app' }; }
      saveLogin(); return { action: 'save-login' };
    };
    if (key === 'Enter' || key === 'Tab') return activate(cur);
    if (key === 'Down' || key === 'Up') {
      if (kids.length < 2) return { action: 'none' };
      const next = key === 'Down' ? (cur + 1) % kids.length : (cur - 1 + kids.length) % kids.length;
      kids.forEach((li, i) => li.classList.toggle('on', i === next));
      return { action: 'nav' };
    }
    if (key === '1') return activate(0);
    if (key === '2') return activate(1);
    return { action: 'none' };
  }
  const r = reduceKey({ idx, count: matches.length }, key);
  idx = r.idx;
  highlight();
  if (r.action === 'fill') pick(r.pickIndex);
  else if (r.action === 'dismiss') dismiss();
  else if (r.action === 'open-app') openApp();
  return r;
}
window.__vaultMini = { handleKey, get state() { return { idx, count: matches.length }; } };

const KEYMAP = { ArrowDown: 'Down', ArrowUp: 'Up', Enter: 'Enter', Tab: 'Tab', Escape: 'Escape', Home: 'Home', End: 'End' };
document.addEventListener('keydown', (ev) => {
  let k = KEYMAP[ev.key];
  if (!k && /^[1-6]$/.test(ev.key) && !inlineFilter) k = ev.key;
  if (!k && /^[1-6]$/.test(ev.key) && inlineFilter && ev.altKey) k = ev.key;
  if (!k) return;
  ev.preventDefault();
  handleKey(k);
});

if (inlineFilter) {
  qEl.classList.remove('hidden');
  qEl.placeholder = t('filter');
  qEl.value = typed;
  qEl.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search(qEl.value), 60); });
  setTimeout(() => qEl.focus(), 30);
}

if (window.VaultAutofill) {
  window.VaultAutofill.onContext?.((data) => {
    if (data.language) lang = data.language === 'en' ? 'en' : 'zh-CN';
    if (data.focus) {
      host = data.focus.url || host;
      title = data.focus.windowTitle || title;
      processName = data.focus.processName || processName;
    }
    if (data.typed != null) typed = data.typed;
    search(typed);
  });
  // live filter: main process streams the target field's current text
  window.VaultAutofill.onTyped?.((v) => { if (v !== typed) { typed = v; clearTimeout(timer); timer = setTimeout(() => search(typed), 40); } });
  window.VaultAutofill.onKey?.((k) => handleKey(k));
}

updateFoot();
search(typed);
