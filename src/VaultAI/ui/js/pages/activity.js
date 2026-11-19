// Activity page: searchable log with outcome filter, plus daily limits.
import { $, $$, t, tf, esc, toast, api, bindForm, isDirty } from '../core.js';
import { emptyState, actionText, lang } from '../ui-common.js';

let activityRows = [];
export async function loadActivity() {
  const ok = $('#act-outcome button.on')?.dataset.ok || '';
  activityRows = (await api('/api/activity' + (ok ? `?ok=${ok}` : ''))).activity;
  renderActivity();
}
function renderActivity() {
  const el = $('#activity-list');
  const q = ($('#act-q').value || '').trim().toLowerCase();
  const rows = q ? activityRows.filter((a) => [a.appName, a.assistantName, a.action, a.reason, a.code].some((x) => String(x || '').toLowerCase().includes(q))) : activityRows;
  if (!rows.length) {
    el.innerHTML = activityRows.length || q || $('#act-outcome button.on')?.dataset.ok ? emptyState('☰', t('act_noMatch'), t('act_noMatchHint')) : emptyState('☰', t('act_none'), t('act_noneHint'));
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>${esc(t('col_when'))}</th><th>${esc(t('col_result'))}</th><th>${esc(t('col_app'))}</th><th>${esc(t('col_action'))}</th><th>${esc(t('col_ai'))}</th><th>${esc(t('col_reason'))}</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td class="mono small">${esc(new Date(a.at).toLocaleString(lang()))}</td>
      <td>${a.ok ? `<span class="badge ok">${esc(t('act_ok'))}</span>` : `<span class="badge no">${esc(t('act_refused'))}</span>`}</td>
      <td>${esc(a.appName === 'Passwords' ? t('passwordsVault') : a.appName)}</td><td class="mono">${esc(actionText(a.action))}</td><td>${esc(a.assistantName)}</td><td class="muted small">${esc(a.reason || a.code || '')}</td></tr>`).join('')}</tbody></table></div>`;
}
let actTimer = null;
$('#act-q').addEventListener('input', () => { clearTimeout(actTimer); actTimer = setTimeout(renderActivity, 150); });
$$('#act-outcome button').forEach((b) => (b.onclick = () => {
  $$('#act-outcome button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
  loadActivity();
}));

export async function loadLimits() {
  const r = await api('/api/limits');
  $('#utc-date').textContent = r.utcDate;
  if (!isDirty($('[data-form="defaultLimit"]'))) $('#default-limit').value = r.defaultDailyLimit;
  $('#limit-keys').innerHTML = [...new Set([...r.limits.map((l) => l.toolKey), ...r.suggestions])].map((k) => `<option value="${esc(k)}"></option>`).join('');
  const el = $('#limits-list');
  if (!r.limits.length) { el.innerHTML = `<div class="empty small"><strong>${esc(t('l_none'))}</strong><div>${esc(tf('l_noneHint', { n: r.defaultDailyLimit }))}</div></div>`; return; }
  el.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>${esc(t('col_tool'))}</th><th>${esc(t('col_used'))}</th><th>${esc(t('col_limit'))}</th></tr></thead><tbody>
    ${r.limits.map((l) => `<tr><td class="mono">${esc(l.toolKey)}</td><td>${l.usedCount}</td><td>${l.limit}${l.limit === 0 ? ` <span class="badge no">${esc(t('l_blocked'))}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
bindForm($('[data-form="defaultLimit"]'), async () => {
  await api('/api/settings/default-limit', { method: 'PUT', body: JSON.stringify({ defaultDailyLimit: Number($('#default-limit').value) }) });
  toast(t('saved'), 'ok');
  loadLimits();
});
bindForm($('[data-form="limit"]'), async () => {
  await api(`/api/limits/${encodeURIComponent($('#limit-key').value.trim())}`, { method: 'PUT', body: JSON.stringify({ limit: Number($('#limit-val').value) }) });
  toast(t('l_set'), 'ok');
  loadLimits();
});
