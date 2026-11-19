// Passwords page: items list, item dialog, generator dialog, security check.
import {
  $, $$, t, tf, esc, ICONS, toast, api, openDialog, closeDialog, confirmDialog, copyText, bindForm, resetForm, markClean,
  isDirty, checkField, showFieldState, refreshSubmitState, normalizeUrl, hostOf, letterAvatar, avatarFor, localizeServerError,
} from '../core.js';
import { mountGenerator, renderHistory, clearHistory } from '../generator-ui.js';
import { emptyState, nav, lang } from '../ui-common.js';

let allPasswords = [];
let pwLoadSeq = 0;
export async function loadPasswords() {
  const seq = ++pwLoadSeq;
  const el = $('#pw-list');
  const q = ($('#pw-search').value || '').trim();
  const fav = $('#pw-fav-filter').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (fav === '1') params.set('favorite', 'true');
  const [{ passwords }, all, health, settingsR] = await Promise.all([
    api('/api/passwords?' + params), api('/api/passwords'), api('/api/password-health'),
    api('/api/settings').catch(() => ({ settings: {} })),
  ]);
  if (seq !== pwLoadSeq) return;
  allPasswords = all.passwords;
  const badge = $('#pw-db-badge');
  if (badge) {
    const on = Boolean(settingsR?.settings?.dbStorageActive);
    const offline = Boolean(settingsR?.settings?.dbStorageOffline);
    badge.classList.toggle('hidden', !(on || offline || settingsR?.settings?.dbStorage?.enabled));
    if (offline) {
      badge.textContent = t('pw_dbOffline');
      badge.classList.add('warn');
    } else if (on) {
      badge.textContent = t('pw_dbOn');
      badge.classList.remove('warn');
    } else {
      badge.classList.add('hidden');
    }
  }
  $('#pw-check-count').textContent = health.issues ? String(health.issues) : '';
  $('#pw-check-count').classList.toggle('bad', health.issues > 0);
  if (!passwords.length) {
    const filtered = q || fav;
    el.innerHTML = emptyState('◉', filtered ? t('emptySearch') : t('emptyPasswords'), filtered ? '' : t('emptyPasswordsHint'), filtered ? null : { id: 'btn-pw-first', label: t('f_newItem') });
    if ($('#btn-pw-first')) $('#btn-pw-first').onclick = () => openQuickCreate();
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table class="table pw-table"><thead><tr>
    <th></th><th>${esc(t('title'))}</th><th>${esc(t('username'))}</th><th>${esc(t('url'))}</th><th>${esc(t('tags'))}</th><th></th></tr></thead><tbody>
    ${passwords.map((p) => `<tr data-pw-row="${p.id}">
      <td class="av-cell"><span class="avatar" data-av="${p.id}"></span></td>
      <td><strong>${p.favorite ? '<span class="star">★</span> ' : ''}${esc(p.title)}</strong></td>
      <td class="mono">${esc(p.username || '')}</td>
      <td class="muted url-cell">${p.url ? esc(hostOf(p.url) || p.url) : ''}</td>
      <td>${(p.tags || []).map((x) => `<span class="chip sm">${esc(x)}</span>`).join(' ')}</td>
      <td class="row-actions">
        <span class="mono pw-revealed hidden" data-pw-val="${p.id}"></span>
        <button class="btn sm secondary" data-pw-copy-user="${p.id}" data-user="${esc(p.username || '')}" ${p.username ? '' : 'disabled'}>${esc(t('copyUser'))}</button>
        <button class="btn sm secondary" data-pw-copy="${p.id}">${esc(t('copyPw'))}</button>
        ${p.hasTotp ? `<button class="btn sm secondary" data-pw-totp="${p.id}">${esc(t('copyTotp'))}</button>` : ''}
        <button class="btn sm secondary" data-pw-reveal="${p.id}">${esc(t('reveal'))}</button>
        <button class="btn sm secondary" data-pw-edit="${p.id}">${esc(t('edit'))}</button>
      </td></tr>`).join('')}</tbody></table></div>`;
  for (const p of passwords) avatarFor($(`[data-av="${p.id}"]`), p.url, p.title);
  $$('[data-pw-copy-user]').forEach((b) => (b.onclick = () => copyText(b.dataset.user || '')));
  $$('[data-pw-reveal]').forEach((b) => (b.onclick = async () => {
    const span = $(`[data-pw-val="${b.dataset.pwReveal}"]`);
    if (!span.classList.contains('hidden')) { span.textContent = ''; span.classList.add('hidden'); b.textContent = t('reveal'); return; }
    try {
      const r = await api(`/api/passwords/${b.dataset.pwReveal}/reveal`);
      span.textContent = r.password; span.classList.remove('hidden'); b.textContent = t('hide');
      setTimeout(() => { if (!span.classList.contains('hidden') && span.isConnected) b.click(); }, 20000);
    } catch (e) { toast(localizeServerError(e), 'err'); }
  }));
  $$('[data-pw-copy]').forEach((b) => (b.onclick = async () => {
    try { const r = await api(`/api/passwords/${b.dataset.pwCopy}/reveal`); await copyText(r.password, { secret: true }); } catch (e) { toast(localizeServerError(e), 'err'); }
  }));
  $$('[data-pw-totp]').forEach((b) => (b.onclick = async () => {
    try {
      const r = await api(`/api/passwords/${b.dataset.pwTotp}/totp`);
      await copyText(r.code, { secret: true });
      toast(tf('totp_copied', { sec: r.remaining }), 'ok');
    } catch (e) { toast(localizeServerError(e), 'err'); }
  }));
  $$('[data-pw-edit]').forEach((b) => (b.onclick = () => openPwDialog(passwords.find((x) => x.id === b.dataset.pwEdit))));
}
let searchTimer = null;
$('#pw-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadPasswords, 200); });
$('#pw-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); loadPasswords(); } });
$('#pw-fav-filter').addEventListener('change', loadPasswords);

// ---- item dialog ----
const pwForm = $('#pw-editor');
const pwDialog = $('#pw-dialog');
let siteTimer = null, checkTimer = null;
function fillDatalists() {
  const count = (arr) => { const m = new Map(); arr.filter(Boolean).forEach((x) => m.set(x, (m.get(x) || 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([x]) => x); };
  $('#pw-user-list').innerHTML = count(allPasswords.map((p) => p.username)).slice(0, 30).map((u) => `<option value="${esc(u)}"></option>`).join('');
  renderTagSuggest();
}
function renderTagSuggest() {
  const cur = $('#pw-tags').value.split(/[,，]/).map((s) => s.trim());
  const partial = (cur[cur.length - 1] || '').toLowerCase();
  const have = new Set(cur.slice(0, -1).map((s) => s.toLowerCase()).concat(partial ? [] : cur.map((s) => s.toLowerCase())));
  const all = [...new Set(allPasswords.flatMap((p) => p.tags || []))];
  const sugg = all.filter((x) => !have.has(x.toLowerCase()) && (!partial || x.toLowerCase().startsWith(partial) && x.toLowerCase() !== partial)).slice(0, 8);
  $('#pw-tag-suggest').innerHTML = sugg.map((x) => `<button type="button" class="chip add" data-tag="${esc(x)}">+ ${esc(x)}</button>`).join('');
  $$('[data-tag]', $('#pw-tag-suggest')).forEach((b) => (b.onclick = () => {
    const parts = $('#pw-tags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (partial && parts.length && b.dataset.tag.toLowerCase().startsWith(parts[parts.length - 1].toLowerCase())) parts.pop();
    parts.push(b.dataset.tag);
    $('#pw-tags').value = parts.join(', ') + ', ';
    $('#pw-tags').dispatchEvent(new Event('input', { bubbles: true }));
    $('#pw-tags').focus();
  }));
}
export async function openPwDialog(meta) {
  resetForm(pwForm);
  if (!allPasswords.length) api('/api/passwords').then((r) => { allPasswords = r.passwords; fillDatalists(); }).catch(() => {});
  $('#pw-id').value = meta?.id || '';
  $('#pw-title').value = meta?.title || '';
  $('#pw-title').dataset.auto = meta ? '' : '1';
  $('#pw-user').value = meta?.username || '';
  $('#pw-pass').value = '';
  $('#pw-pass').type = 'password';
  $('#pw-pass').placeholder = meta ? t('ph_pwKeep') : '';
  $('#pw-pass-help').textContent = meta ? t('h_pwPassEdit') : t('h_pwPass');
  $('#pw-url').value = meta?.url || '';
  $('#pw-notes').value = meta?.notes || '';
  $('#pw-tags').value = (meta?.tags || []).join(', ');
  $('#pw-fav').checked = Boolean(meta?.favorite);
  $('#pw-editor-title').textContent = meta ? t('f_editItem') : t('f_newItemTitle');
  $('#btn-pw-delete').classList.toggle('hidden', !meta);
  $('#pw-dup-warn').classList.add('hidden');
  $('#pw-reuse-warn').innerHTML = '';
  $('#pw-gen-panel').classList.add('hidden');
  if ($('#pw-totp')) {
    $('#pw-totp').value = '';
    $('#pw-totp').placeholder = meta?.hasTotp ? t('totp_phKeep') : t('totp_ph');
    $('#pw-totp').dataset.clear = '';
    $('#pw-totp').dataset.had = meta?.hasTotp ? '1' : '';
    const live = $('#pw-totp-live');
    live?.classList.add('hidden');
    if (meta?.hasTotp && live) {
      live.classList.remove('hidden');
      live.textContent = t('totp_configured');
      // live code preview
      const id = meta.id;
      const tick = async () => {
        if ($('#pw-id').value !== id || live.classList.contains('hidden')) return;
        try {
          const r = await api(`/api/passwords/${id}/totp`);
          live.textContent = tf('totp_live', { code: r.code, sec: r.remaining });
        } catch { /* */ }
      };
      tick();
      clearInterval(window.__vaultTotpTimer);
      window.__vaultTotpTimer = setInterval(tick, 1000);
    } else {
      clearInterval(window.__vaultTotpTimer);
    }
  }
  $('#pw-site-host').textContent = meta?.url ? hostOf(meta.url) : '';
  avatarFor($('#pw-avatar'), meta?.url, meta?.title || '?');
  fillDatalists();
  markClean(pwForm);
  refreshSubmitState(pwForm);
  openDialog(pwDialog, { onRequestClose: closePwDialog });
  const target = meta ? $('#pw-title') : $('#pw-url');
  target.focus();
  // re-assert once the dialog transition is done, but never steal focus from a field the user already moved to
  setTimeout(() => { const a = document.activeElement; if (!a || !pwForm.contains(a) || a === target || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) target.focus(); }, 40);
}
async function closePwDialog() {
  if (isDirty(pwForm) && !(await confirmDialog(t('u_title'), t('u_body'), { okText: t('u_discard') }))) return;
  markClean(pwForm);
  closeDialog(pwDialog);
}
$$('[data-close-dialog]', pwDialog).forEach((b) => (b.onclick = closePwDialog));
$('#btn-pw-delete').onclick = async () => {
  const id = $('#pw-id').value;
  if (!id || !(await confirmDialog(t('deletePassword'), t('deletePasswordBody')))) return;
  await api(`/api/passwords/${id}`, { method: 'DELETE' });
  markClean(pwForm);
  closeDialog(pwDialog);
  toast(t('passwordDeleted'), 'ok');
  nav.reloadTab();
};
async function onUrlChanged() {
  const url = $('#pw-url').value.trim();
  const host = hostOf(url);
  $('#pw-site-host').textContent = host;
  if (!host || checkField($('#pw-url'))) { letterAvatar($('#pw-avatar'), $('#pw-title').value || '?'); return; }
  const auto = $('#pw-title').dataset.auto === '1';
  const info = await avatarFor($('#pw-avatar'), url, auto ? host : $('#pw-title').value || host);
  if (info && auto && $('#pw-title').dataset.auto === '1' && hostOf($('#pw-url').value) === host) {
    $('#pw-title').value = info.name || host;
    showFieldState($('#pw-title'), '');
    refreshSubmitState(pwForm);
    if (!info.icon) letterAvatar($('#pw-avatar'), info.name || host);
  }
  scheduleCheck();
}
$('#pw-url').addEventListener('input', () => { clearTimeout(siteTimer); siteTimer = setTimeout(onUrlChanged, 450); });
$('#pw-url').addEventListener('change', () => { clearTimeout(siteTimer); onUrlChanged(); });
$('#pw-title').addEventListener('input', () => { $('#pw-title').dataset.auto = $('#pw-title').value ? '' : '1'; if (!$('#pw-url').value) letterAvatar($('#pw-avatar'), $('#pw-title').value || '?'); });
$('#pw-user').addEventListener('input', () => scheduleCheck());
$('#pw-tags').addEventListener('input', renderTagSuggest);
$('#pw-pass').addEventListener('input', () => scheduleCheck());
$('#btn-pw-open').onclick = () => { const u = $('#pw-url').value.trim(); if (u && !checkField($('#pw-url'))) window.open(normalizeUrl(u), '_blank', 'noopener'); else $('#pw-url').focus(); };
$('#btn-pw-copy-field').onclick = () => { if ($('#pw-pass').value) copyText($('#pw-pass').value, { secret: true }); };
$('#btn-pw-totp-clear')?.addEventListener('click', () => {
  if (!$('#pw-totp')) return;
  $('#pw-totp').value = '';
  $('#pw-totp').dataset.clear = '1';
  $('#pw-totp').placeholder = t('totp_ph');
  $('#pw-totp-live')?.classList.add('hidden');
  clearInterval(window.__vaultTotpTimer);
  toast(t('totp_willClear'), 'ok');
});
$('#btn-pw-gen').onclick = () => {
  const panel = $('#pw-gen-panel');
  const show = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !show);
  if (show) {
    mountGenerator(panel, { inline: true, idPrefix: 'pwgen', onUse: (v) => {
      const inp = $('#pw-pass');
      inp.value = v; inp.type = 'text';
      inp.dataset.touched = '1';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      panel.classList.add('hidden');
      toast(t('g_used'), 'ok');
      inp.focus();
    } });
  }
};
function scheduleCheck() {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(async () => {
    const body = { id: $('#pw-id').value || undefined, url: $('#pw-url').value.trim(), username: $('#pw-user').value.trim(), password: $('#pw-pass').value || undefined };
    try {
      const r = await api('/api/passwords/check', { method: 'POST', body: JSON.stringify(body) });
      const dup = $('#pw-dup-warn');
      if (r.duplicates.length && body.url) {
        dup.classList.remove('hidden');
        dup.innerHTML = `${ICONS.warn}<span>${esc(tf('a_duplicate', { host: hostOf(body.url), user: body.username || t('a_noUser') }))}</span> ${r.duplicates.map((d) => `<a href="#" data-open-dup="${d.id}">${esc(d.title)}</a>`).join(', ')}`;
        $$('[data-open-dup]', dup).forEach((a) => (a.onclick = async (e) => {
          e.preventDefault();
          const m = (await api(`/api/passwords/${a.dataset.openDup}`)).password;
          if (isDirty(pwForm) && !(await confirmDialog(t('u_title'), t('u_body'), { okText: t('u_discard') }))) return;
          closeDialog(pwDialog); openPwDialog(m);
        }));
      } else dup.classList.add('hidden');
      $('#pw-reuse-warn').innerHTML = r.reusedBy.length ? `${ICONS.warn}<span>${esc(tf('a_reused', { n: r.reusedBy.length, items: r.reusedBy.slice(0, 3).map((x) => x.title).join(', ') }))}</span>` : '';
    } catch { /* locked etc */ }
  }, 350);
}
bindForm(pwForm, async () => {
  const id = $('#pw-id').value;
  const body = {
    title: $('#pw-title').value.trim(),
    username: $('#pw-user').value.trim(),
    url: $('#pw-url').value.trim() ? normalizeUrl($('#pw-url').value) : (id ? null : undefined),
    notes: $('#pw-notes').value || (id ? null : undefined),
    tags: $('#pw-tags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    favorite: $('#pw-fav').checked,
  };
  if ($('#pw-pass').value) body.password = $('#pw-pass').value;
  if ($('#pw-totp')) {
    if ($('#pw-totp').dataset.clear === '1') body.totp = null;
    else if ($('#pw-totp').value.trim()) body.totp = $('#pw-totp').value.trim();
  }
  if (id) await api(`/api/passwords/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  else await api('/api/passwords', { method: 'POST', body: JSON.stringify(body) });
  markClean(pwForm);
  closeDialog(pwDialog);
  toast(t('passwordSaved'), 'ok');
  nav.reloadTab();
});

// ---- generator dialog ----
let genMountedLang = null;
export function resetGenerator() { genMountedLang = null; }
export function openGenDialog() {
  if (genMountedLang !== lang()) { mountGenerator($('#gen-page'), { idPrefix: 'gen' }); genMountedLang = lang(); }
  renderHistory($('#gen-history'));
  openDialog($('#gen-dialog'));
}
$$('[data-close-dialog]', $('#gen-dialog')).forEach((b) => (b.onclick = () => closeDialog($('#gen-dialog'))));
$('#btn-gen-history-clear').onclick = () => { clearHistory(); toast(t('g_historyCleared')); };

// ---- security check ----
export async function loadHealth() {
  const r = await api('/api/password-health');
  const cls = r.score >= 90 ? 'ok' : r.score >= 60 ? 'warn' : 'bad';
  $('#health-stats').innerHTML = `
    <div class="stat score ${cls}"><div class="k">${esc(t('s_score'))}</div><div class="v" id="health-score">${r.total ? r.score + '%' : '—'}</div></div>
    <div class="stat"><div class="k">${esc(t('s_total'))}</div><div class="v">${r.total}</div></div>
    <div class="stat ${r.weak.length ? 'bad' : ''}"><div class="k">${esc(t('s_weak'))}</div><div class="v" id="health-weak-n">${r.weak.length}</div></div>
    <div class="stat ${r.reusedCount ? 'bad' : ''}"><div class="k">${esc(t('s_reused'))}</div><div class="v" id="health-reused-n">${r.reusedCount}</div></div>
    <div class="stat ${r.old.length ? 'warn' : ''}"><div class="k">${esc(t('s_old'))}</div><div class="v" id="health-old-n">${r.old.length}</div></div>`;
  const item = (e, extra) => `<li><span class="avatar sm" data-hav="${e.id}"></span><div class="grow"><strong>${esc(e.title)}</strong><div class="muted small">${esc(e.username || '')}${extra ? ' · ' + extra : ''}</div></div><button class="btn sm secondary" data-fix="${e.id}">${esc(t('s_fix'))}</button></li>`;
  const empty = (k) => `<div class="empty small"><div class="empty-ico ok">✓</div>${esc(t(k))}</div>`;
  $('#health-weak').innerHTML = r.weak.length ? `<ul class="health-list">${r.weak.map((e) => item(e, esc(t('st_' + e.score)) + (e.reasons?.[0] ? ' · ' + esc(t('sw_' + e.reasons[0])) : ''))).join('')}</ul>` : empty('s_noneWeak');
  $('#health-reused').innerHTML = r.reused.length ? r.reused.map((g) => `<div class="reuse-group"><div class="muted small">${esc(tf('s_group', { n: g.entries.length }))}</div><ul class="health-list">${g.entries.map((e) => item(e)).join('')}</ul></div>`).join('') : empty('s_noneReused');
  $('#health-old').innerHTML = r.old.length ? `<ul class="health-list">${r.old.map((e) => item(e, esc(tf('s_days', { n: e.days })))).join('')}</ul>` : empty('s_noneOld');
  for (const e of [...r.weak, ...r.reused.flatMap((g) => g.entries), ...r.old]) $$(`[data-hav="${e.id}"]`).forEach((el) => avatarFor(el, e.url, e.title));
  $$('[data-fix]').forEach((b) => (b.onclick = async () => openPwDialog((await api(`/api/passwords/${b.dataset.fix}`)).password)));
}

// ---- quick create sheet (1.7.0) ----
const qcForm = $('#pw-quick');
const qcDialog = $('#pw-quick-dialog');
let qcSiteTimer = null;
let lastCreatedId = null;

export function openQuickCreate() {
  resetForm(qcForm);
  $('#qc-url').value = '';
  $('#qc-title').value = '';
  $('#qc-title').dataset.auto = '1';
  $('#qc-user').value = '';
  $('#qc-pass').value = '';
  $('#qc-pass').type = 'password';
  $('#qc-gen-panel').classList.add('hidden');
  markClean(qcForm);
  refreshSubmitState(qcForm);
  openDialog(qcDialog, { onRequestClose: closeQuickCreate });
  setTimeout(() => $('#qc-url').focus(), 30);
}

async function closeQuickCreate() {
  if (isDirty(qcForm) && !(await confirmDialog(t('u_title'), t('u_body'), { okText: t('u_discard') }))) return;
  markClean(qcForm);
  closeDialog(qcDialog);
}
$$('[data-close-dialog]', qcDialog).forEach((b) => (b.onclick = closeQuickCreate));

async function onQcUrl() {
  const url = $('#qc-url').value.trim();
  const host = hostOf(url);
  if (!host || checkField($('#qc-url'))) return;
  if ($('#qc-title').dataset.auto !== '1') return;
  const info = await avatarFor(document.createElement('span'), url, host);
  if ($('#qc-title').dataset.auto === '1' && hostOf($('#qc-url').value) === host) {
    $('#qc-title').value = (info && info.name) || host;
    showFieldState($('#qc-title'), '');
    refreshSubmitState(qcForm);
  }
}
$('#qc-url').addEventListener('input', () => { clearTimeout(qcSiteTimer); qcSiteTimer = setTimeout(onQcUrl, 400); });
$('#qc-title').addEventListener('input', () => { $('#qc-title').dataset.auto = $('#qc-title').value ? '' : '1'; });

$('#btn-qc-gen').onclick = () => {
  const panel = $('#qc-gen-panel');
  const show = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !show);
  if (show) {
    mountGenerator(panel, { inline: true, idPrefix: 'qcgen', onUse: (v) => {
      const inp = $('#qc-pass');
      inp.value = v; inp.type = 'text';
      inp.dataset.touched = '1';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      panel.classList.add('hidden');
      toast(t('g_used'), 'ok');
      inp.focus();
    } });
  }
};

$('#btn-qc-more').onclick = async () => {
  const draft = {
    title: $('#qc-title').value.trim(),
    username: $('#qc-user').value.trim(),
    url: $('#qc-url').value.trim(),
  };
  const pass = $('#qc-pass').value;
  markClean(qcForm);
  closeDialog(qcDialog);
  await openPwDialog(null);
  if (draft.url) $('#pw-url').value = draft.url;
  if (draft.title) { $('#pw-title').value = draft.title; $('#pw-title').dataset.auto = ''; }
  if (draft.username) $('#pw-user').value = draft.username;
  if (pass) { $('#pw-pass').value = pass; $('#pw-pass').dispatchEvent(new Event('input', { bubbles: true })); }
  refreshSubmitState(pwForm);
};

async function saveQuick({ another }) {
  const urlRaw = $('#qc-url').value.trim();
  let title = $('#qc-title').value.trim();
  const username = $('#qc-user').value.trim();
  const password = $('#qc-pass').value;
  if (!password) { showFieldState($('#qc-pass'), t('v_required')); $('#qc-pass').focus(); return null; }
  const url = urlRaw ? normalizeUrl(urlRaw) : undefined;
  if (!title && url) title = hostOf(url) || url;
  if (!title) title = username || t('qc_untitled');
  const body = { title, username, password, url };
  const r = await api('/api/passwords', { method: 'POST', body: JSON.stringify(body) });
  lastCreatedId = r.password?.id || null;
  markClean(qcForm);
  toast(t('passwordSaved'), 'ok');
  if (another) {
    $('#qc-url').value = '';
    $('#qc-title').value = '';
    $('#qc-title').dataset.auto = '1';
    $('#qc-user').value = '';
    $('#qc-pass').value = '';
    $('#qc-pass').type = 'password';
    $('#qc-gen-panel').classList.add('hidden');
    refreshSubmitState(qcForm);
    $('#qc-url').focus();
  } else {
    closeDialog(qcDialog);
  }
  await loadPasswords();
  if (lastCreatedId) {
    const row = $(`[data-pw-row="${lastCreatedId}"]`);
    if (row) {
      row.classList.add('flash');
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(() => row.classList.remove('flash'), 1800);
    }
  }
  return r.password;
}

bindForm(qcForm, async () => { await saveQuick({ another: false }); });
$('#btn-qc-save-another').onclick = async () => {
  // trigger same validation path
  const err = checkField($('#qc-pass'));
  if (err) { showFieldState($('#qc-pass'), err); $('#qc-pass').focus(); return; }
  if (checkField($('#qc-url'))) { showFieldState($('#qc-url'), checkField($('#qc-url'))); return; }
  try { await saveQuick({ another: true }); } catch (e) { toast(localizeServerError(e), 'err'); }
};

// ---- import (1.7.0) ----
let impText = '';
let impName = '';

export function openImportDialog() {
  impText = '';
  impName = '';
  $('#imp-file').value = '';
  $('#imp-preview').classList.add('hidden');
  $('#imp-summary').classList.add('hidden');
  $('#imp-warnings').classList.add('hidden');
  $('#btn-imp-go').disabled = true;
  $('#imp-mode').value = 'skip';
  openDialog($('#pw-import-dialog'));
}

$$('[data-close-dialog]', $('#pw-import-dialog')).forEach((b) => {
  b.onclick = () => { impText = ''; closeDialog($('#pw-import-dialog')); };
});

async function previewImportFile(file) {
  if (!file) return;
  const text = await file.text();
  impText = text;
  impName = file.name || 'export.csv';
  const r = await api('/api/passwords/import/preview', {
    method: 'POST',
    body: JSON.stringify({ text, filename: impName }),
  });
  $('#imp-preview').classList.remove('hidden');
  $('#imp-summary').classList.add('hidden');
  $('#imp-stats').innerHTML = `
    <div class="stat"><div class="k">${esc(t('imp_total'))}</div><div class="v">${r.total}</div></div>
    <div class="stat ${r.duplicates ? 'warn' : ''}"><div class="k">${esc(t('imp_dups'))}</div><div class="v">${r.duplicates}</div></div>
    <div class="stat"><div class="k">${esc(t('imp_withPw'))}</div><div class="v">${r.withPassword}</div></div>`;
  $('#imp-format').textContent = tf('imp_format', { format: r.formatLabel || r.format, delim: r.delimiter || '—' });
  if (r.warnings?.length) {
    $('#imp-warnings').classList.remove('hidden');
    $('#imp-warnings').textContent = r.warnings.join(' · ');
  } else $('#imp-warnings').classList.add('hidden');
  const tb = $('#imp-table tbody');
  tb.innerHTML = (r.sample || []).map((row) => `<tr>
    <td><strong>${esc(row.title)}</strong></td>
    <td class="mono">${esc(row.username || '')}</td>
    <td class="muted">${esc(row.url ? (hostOf(row.url) || row.url) : '')}</td>
    <td>${row.duplicate ? `<span class="dup">${esc(t('imp_dup'))}</span>` : (row.hasPassword ? '' : `<span class="dup">${esc(t('imp_noPw'))}</span>`)}</td>
  </tr>`).join('') || `<tr><td colspan="4" class="muted">${esc(t('imp_empty'))}</td></tr>`;
  $('#btn-imp-go').disabled = !(r.total > 0 && r.withPassword > 0);
}

$('#imp-file').addEventListener('change', async () => {
  try {
    await previewImportFile($('#imp-file').files?.[0]);
  } catch (e) { toast(localizeServerError(e), 'err'); }
});

$('#btn-imp-go').onclick = async () => {
  if (!impText) return;
  const mode = $('#imp-mode').value || 'skip';
  if (mode === 'update' && !(await confirmDialog(t('imp_confirmUpdateTitle'), t('imp_confirmUpdateBody'), { okText: t('imp_go') }))) return;
  $('#btn-imp-go').disabled = true;
  try {
    const r = await api('/api/passwords/import', {
      method: 'POST',
      body: JSON.stringify({ text: impText, filename: impName, mode }),
    });
    // Drop plaintext from memory ASAP
    impText = '';
    $('#imp-file').value = '';
    $('#imp-summary').classList.remove('hidden');
    $('#imp-summary').textContent = tf('imp_done', {
      imported: r.imported, updated: r.updated, skipped: r.skipped, failed: r.failed,
    });
    toast(tf('imp_done', { imported: r.imported, updated: r.updated, skipped: r.skipped, failed: r.failed }), 'ok');
    await loadPasswords();
  } catch (e) {
    toast(localizeServerError(e), 'err');
    $('#btn-imp-go').disabled = false;
  }
};

$('#btn-imp-docs').onclick = () => {
  const w = $('#imp-warnings');
  w.classList.remove('hidden');
  w.textContent = t('imp_docsToast');
};
