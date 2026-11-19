// AI assistants page: list, connect dialog (client → name/expiry → setup snippet → verify), access matrix.
import {
  $, $$, t, tf, esc, ICONS, applyIcons, toast, api, openDialog, closeDialog, confirmDialog, copyText, bindForm, resetForm,
  markClean, isDirty, refreshSubmitState, localizeServerError,
} from '../core.js';
import { CLIENTS, clientLabel, levelLabel, emptyState, relTime, fmtDate, asstStatus, nav } from '../ui-common.js';

let assistantsCache = [];
export async function loadAssistants() {
  const el = $('#asst-list');
  const { assistants } = await api('/api/assistants');
  assistantsCache = assistants;
  if (!assistants.length) {
    el.innerHTML = emptyState('◎', t('a_none'), t('a_noneHint'), { id: 'btn-ai-first', label: t('ai_new') });
    $('#btn-ai-first').onclick = openAiDialog;
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr>
    <th>${esc(t('col_name'))}</th><th>${esc(t('col_client'))}</th><th>${esc(t('col_status'))}</th><th>${esc(t('col_expires'))}</th><th>${esc(t('a_lastSeen'))}</th><th></th></tr></thead><tbody>
    ${assistants.map((a) => `<tr data-asst-row="${esc(a.id)}">
      <td><strong>${esc(a.name)}</strong></td>
      <td>${esc(clientLabel(a.kind))}</td>
      <td>${asstStatus(a)}</td>
      <td>${a.expiresAt ? esc(fmtDate(a.expiresAt)) : esc(t('d_never'))}</td>
      <td class="muted small" data-last-seen="${esc(a.id)}">${esc(relTime(a.lastSeenAt))}</td>
      <td class="row-actions">
        <button class="btn sm secondary" data-setup="${esc(a.id)}">${esc(t('a_setup'))}</button>
        ${a.expiresAt ? `<button class="btn sm secondary" data-renew="${esc(a.id)}">${esc(t('a_renew'))}</button>` : ''}
        <button class="btn sm secondary" data-toggle="${esc(a.id)}" data-on="${a.enabled ? '0' : '1'}">${esc(a.enabled ? t('a_disable') : t('a_enable'))}</button>
        <button class="btn sm secondary" data-rotate="${esc(a.id)}">${esc(t('a_rotate'))}</button>
        <button class="btn sm danger" data-del-asst="${esc(a.id)}">${esc(t('delete'))}</button>
      </td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-setup]').forEach((b) => (b.onclick = () => openSetup(assistants.find((a) => a.id === b.dataset.setup))));
  $$('[data-renew]').forEach((b) => (b.onclick = async () => {
    const r = await api(`/api/assistants/${b.dataset.renew}/renew`, { method: 'POST', body: JSON.stringify({ days: 7 }) });
    toast(tf('a_renewed', { date: fmtDate(r.expiresAt) }), 'ok'); nav.reloadTab();
  }));
  $$('[data-toggle]').forEach((b) => (b.onclick = async () => { await api(`/api/assistants/${b.dataset.toggle}`, { method: 'PATCH', body: JSON.stringify({ enabled: b.dataset.on === '1' }) }); nav.reloadTab(); }));
  $$('[data-rotate]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog(t('a_rotateTitle'), t('a_rotateBody')))) return;
    await api(`/api/assistants/${b.dataset.rotate}/rotate-token`, { method: 'POST', body: '{}' });
    toast(t('a_rotated'), 'ok');
    openSetup(assistants.find((a) => a.id === b.dataset.rotate));
  }));
  $$('[data-del-asst]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog(t('a_delTitle'), t('a_delBody')))) return;
    await api(`/api/assistants/${b.dataset.delAsst}`, { method: 'DELETE' });
    nav.reloadTab();
  }));
}

// ---- connect dialog ----
const aiDialog = $('#ai-dialog');
let setupFor = null;
let setupData = null;
function renderClientPicker() {
  const cur = $('#asst-kind').value;
  $('#asst-kind-picker').innerHTML = CLIENTS.map((c) => `<button type="button" role="radio" class="client ${c.kind === cur ? 'on' : ''}" aria-checked="${c.kind === cur}" data-client="${c.kind}"><strong>${esc(clientLabel(c.kind))}</strong><span class="muted small">${esc(t('clh_' + c.kind.replace('-', '_')))}</span></button>`).join('');
  $$('[data-client]').forEach((b) => (b.onclick = () => {
    const name = $('#asst-name');
    if (!name.value || name.dataset.auto === '1') { name.value = clientLabel(b.dataset.client); name.dataset.auto = '1'; name.dispatchEvent(new Event('input', { bubbles: true })); }
    $('#asst-kind').value = b.dataset.client;
    renderClientPicker();
  }));
}
export function openAiDialog() {
  resetForm($('#asst-form'));
  $('#asst-kind').value = 'claude-desktop';
  $('#asst-dur').value = '30d';
  $('#asst-name').value = clientLabel('claude-desktop');
  $('#asst-name').dataset.auto = '1';
  $('#asst-form').classList.remove('hidden');
  $('#ai-setup').classList.add('hidden');
  $('#ai-dialog-title').textContent = t('ai_title');
  renderClientPicker();
  markClean($('#asst-form'));
  refreshSubmitState($('#asst-form'));
  if (!assistantsCache.length) api('/api/assistants').then((x) => (assistantsCache = x.assistants)).catch(() => {});
  openDialog(aiDialog, { onRequestClose: closeAiDialog });
}
async function closeAiDialog() {
  const f = $('#asst-form');
  if (!f.classList.contains('hidden') && isDirty(f) && !(await confirmDialog(t('u_title'), t('u_body'), { okText: t('u_discard') }))) return;
  markClean(f);
  stopVerify();
  closeDialog(aiDialog);
  if (nav.isUnlocked()) nav.reloadTab();
}
export function closeAiDialogSilently() { stopVerify(); }
$$('[data-close-dialog]', aiDialog).forEach((b) => (b.onclick = closeAiDialog));
$('#asst-name').addEventListener('input', (e) => {
  if (e.isTrusted) e.target.dataset.auto = '';
  const v = $('#asst-name').value.trim().toLowerCase();
  const w = $('.warn-msg', $('#asst-name').closest('.field'));
  w.innerHTML = v && assistantsCache.some((a) => a.name.toLowerCase() === v) ? `${ICONS.warn}<span>${esc(t('w_asstDup'))}</span>` : '';
});
bindForm($('#asst-form'), async () => {
  const r = await api('/api/assistants', { method: 'POST', body: JSON.stringify({ name: $('#asst-name').value.trim(), kind: $('#asst-kind').value, duration: $('#asst-dur').value }) });
  markClean($('#asst-form'));
  toast(t('a_registered'), 'ok');
  assistantsCache.push(r.assistant);
  await openSetup(r.assistant);
});
const SETUP_TABS = [
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'terminal', labelKey: 'cl_terminal' },
  { id: 'http', labelKey: 'st_http' },
];
export async function openSetup(asst) {
  if (!asst) return;
  const { setup } = await api(`/api/assistants/${asst.id}/setup`);
  setupFor = { id: asst.id, since: Date.now() };
  setupData = setup;
  $('#asst-form').classList.add('hidden');
  $('#ai-setup').classList.remove('hidden');
  $('#ai-dialog-title').textContent = tf('ai_setupTitle', { name: asst.name });
  $('#token-once').value = setup.token;
  $('#token-once').type = 'password';
  $('#setup-tabs').innerHTML = SETUP_TABS.map((s) => `<button type="button" role="tab" data-setup-tab="${s.id}">${esc(s.label || t(s.labelKey))}</button>`).join('');
  $$('[data-setup-tab]').forEach((b) => (b.onclick = () => showSetupTab(b.dataset.setupTab)));
  const portable = setup.warnings.includes('portable');
  $('#setup-warn').classList.toggle('hidden', !portable);
  $('#setup-warn').textContent = portable ? t('sw_portable') : '';
  showSetupTab(setup.client === 'custom' ? 'http' : setup.client);
  stopVerify();
  setVerify('idle');
  if (aiDialog.classList.contains('hidden')) openDialog(aiDialog, { onRequestClose: closeAiDialog });
  applyIcons(aiDialog);
}
function showSetupTab(id) {
  const s = setupData;
  $$('[data-setup-tab]').forEach((b) => { const on = b.dataset.setupTab === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
  const json = (o) => JSON.stringify(o, null, 2);
  let steps, snippet;
  if (id === 'claude-desktop') { steps = [tf('ss_cd1', { file: s.claudeDesktop.file }), t('ss_cd2'), t('ss_cd3')]; snippet = json(s.claudeDesktop.json); }
  else if (id === 'cursor') { steps = [tf('ss_cu1', { file: s.cursor.file }), t('ss_cu2'), t('ss_cu3')]; snippet = json(s.cursor.json); }
  else if (id === 'claude-code') { steps = [t('ss_cc1'), t('ss_cc2')]; snippet = s.claudeCode.command; }
  else if (id === 'terminal') { steps = [t('ss_te1'), t('ss_te2')]; snippet = s.terminal.lines.join('\n'); }
  else { steps = [t('ss_ht1'), t('ss_ht2')]; snippet = `URL: ${s.mcpUrl}\nAuthorization: Bearer ${s.token}`; }
  $('#setup-steps').innerHTML = steps.map((x) => `<li>${esc(x)}</li>`).join('');
  $('#setup-snippet').textContent = snippet;
  $('#setup-snippet').dataset.tab = id;
}
$('#btn-copy-snippet').onclick = () => copyText($('#setup-snippet').textContent, { secret: true });
$('#btn-copy-token').onclick = () => copyText($('#token-once').value, { secret: true });
$('#btn-setup-perms').onclick = async () => {
  const id = setupFor?.id;
  stopVerify();
  closeDialog(aiDialog);
  await nav.switchTab('assistants', { force: true });
  const row = id && $(`[data-perm-row="${id}"]`);
  if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 2000); }
};
// Verification waits for the first request that carries this assistant's token.
let verifyTimer = null;
export function stopVerify() { clearInterval(verifyTimer); verifyTimer = null; }
function setVerify(state) {
  const el = $('#verify-status');
  el.className = 'verify-status ' + state;
  el.innerHTML = state === 'ok' ? `${ICONS.check}<span>${esc(t('v_ok'))}</span>` : state === 'waiting' ? `<span class="spinner"></span><span>${esc(t('v_waiting'))}</span>` : state === 'timeout' ? `${ICONS.warn}<span>${esc(t('v_timeout'))}</span>` : '';
  $('#btn-verify').textContent = state === 'waiting' ? t('v_stop') : t('v_wait');
}
async function checkSeen() {
  const { assistants } = await api('/api/assistants');
  const a = assistants.find((x) => x.id === setupFor?.id);
  return Boolean(a?.lastSeenAt && Date.parse(a.lastSeenAt) >= setupFor.since - 1000);
}
$('#btn-verify').onclick = () => {
  if (verifyTimer) { stopVerify(); setVerify('idle'); return; }
  setVerify('waiting');
  const started = Date.now();
  const tick = async () => {
    try { if (await checkSeen()) { stopVerify(); setVerify('ok'); return; } } catch { /* locked */ }
    if (Date.now() - started > 120000) { stopVerify(); setVerify('timeout'); }
  };
  verifyTimer = setInterval(tick, 1500);
  tick();
};

// ---- access matrix: saved immediately; the control shows the state (no toast) ----
export async function loadPerms() {
  const el = $('#perm-matrix');
  const [{ applications, assistants, passwordsKey }, lv] = await Promise.all([api('/api/permissions'), api('/api/permission-levels')]);
  $('#perm-legend').innerHTML = lv.levels.map((l) => `<span><span class="badge ${l}">${esc(levelLabel(l))}</span> ${esc(t('lvd_' + l))}</span>`).join('');
  const cols = applications.filter((a) => !((a.kind === 'gmail' || a.kind === 'gcal') && !a.meta?.connected));
  $('#perm-card').classList.toggle('hidden', !assistants.length);
  if (!assistants.length) { el.innerHTML = ''; return; }
  const colName = (a) => (a.id === passwordsKey ? t('passwordsVault') : a.name);
  let html = `<div class="table-wrap"><table class="table matrix-table"><thead><tr><th>${esc(t('col_ai'))}</th>${cols.map((a) => `<th>${esc(colName(a))}</th>`).join('')}</tr></thead><tbody>`;
  for (const asst of assistants) {
    html += `<tr data-perm-row="${esc(asst.id)}"><td><strong>${esc(asst.name)}</strong>${asst.enabled ? '' : ` <span class="badge no">${esc(t('st_off'))}</span>`}</td>`;
    for (const app of cols) {
      const cur = asst.permissions[app.id] || 'off';
      const levels = app.id === passwordsKey ? lv.passwordsLevels : lv.levels;
      html += `<td><div class="seg" role="radiogroup" aria-label="${esc(asst.name + ' · ' + colName(app))}">${levels.map((l) => `<button type="button" role="radio" aria-checked="${l === cur}" data-perm="${esc(asst.id)}" data-app="${esc(app.id)}" data-level="${l}" class="${l === cur ? 'on ' + l : ''}">${esc(levelLabel(l))}</button>`).join('')}</div></td>`;
    }
    html += '</tr>';
  }
  el.innerHTML = html + '</tbody></table></div>';
  $$('.seg button[data-perm]', el).forEach((btn) => (btn.onclick = async () => {
    const group = btn.parentElement;
    const prev = $('button.on', group);
    $$('button', group).forEach((b) => { b.className = ''; b.setAttribute('aria-checked', 'false'); });
    btn.className = 'on ' + btn.dataset.level; btn.setAttribute('aria-checked', 'true');
    try {
      await api(`/api/permissions/${btn.dataset.perm}/${btn.dataset.app}`, { method: 'PUT', body: JSON.stringify({ level: btn.dataset.level }) });
    } catch (e) {
      btn.className = ''; if (prev) prev.className = 'on ' + prev.dataset.level;
      toast(localizeServerError(e), 'err');
    }
  }));
}
