// VaultAI UI (v1.9) — app shell: lock screen, six-item navigation, settings. Pages live in ./pages/.
import {
  $, $$, t, tf, esc, ICONS, applyIcons, toast, api, setActivityHook, openDialog, closeDialog,
  clipboardState, clearClipboardNow, bindForm, resetForm, isDirty, guardLeave, refreshSubmitState,
  wirePasswordAffordances, wireStrengthUi, localizeServerError,
} from './core.js';
import { clearHistory, loadPrefs, genState } from './generator-ui.js';
import { generatePassphrase } from '/shared/generator.js';
import { nav, isElectron, lang } from './ui-common.js';
import { loadHome } from './pages/home.js';
import { loadPasswords, loadHealth, openPwDialog, openGenDialog, resetGenerator, openQuickCreate, openImportDialog } from './pages/passwords.js';
import { loadConnections } from './pages/connections.js';
import { loadAssistants, loadPerms, openAiDialog, stopVerify } from './pages/assistants.js';
import { loadActivity, loadLimits } from './pages/activity.js';

const VERSION = '1.9.0';
const TABS = ['home', 'passwords', 'connections', 'assistants', 'activity', 'settings'];

// ---------------- i18n ----------------
function applyI18n() {
  const V = window.VaultI18n;
  $$('[data-i18n]').forEach((el) => {
    const text = V.t(el.dataset.i18n);
    const ico = el.querySelector(':scope > .ico');
    if (ico) { el.innerHTML = ''; el.appendChild(ico); el.appendChild(document.createTextNode(' ' + text)); }
    else el.textContent = text;
  });
  $$('[data-i18n-ph]').forEach((el) => (el.placeholder = V.t(el.dataset.i18nPh)));
  $$('[data-i18n-title]').forEach((el) => (el.title = V.t(el.dataset.i18nTitle)));
  $('.foot').innerHTML = esc(V.t('footer')) + '<br/>v' + VERSION;
  $('#about-text').textContent = tf('about', { v: VERSION });
  $$('[data-lock-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lockLang === V.getLang()));
  setHeader($('.nav-btn.active')?.dataset.tab || 'home');
  setStatus(nav.isUnlocked());
  applyIcons();
}

// ---------------- idle lock ----------------
let idleTimer = null;
let idleMinutes = 30;
function bumpIdle() {
  clearTimeout(idleTimer);
  if (!idleMinutes || !nav.isUnlocked()) return;
  idleTimer = setTimeout(async () => {
    try { await api('/api/vault/lock', { method: 'POST', body: '{}' }); } catch { /* */ }
    toast(t('idleLocked'), 'err');
    showLock(true);
  }, idleMinutes * 60 * 1000);
}
setActivityHook(bumpIdle);
document.addEventListener('mousemove', bumpIdle);
document.addEventListener('keydown', bumpIdle);
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  if (e.code !== 'KeyN') return;
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
  if ($('#lock-screen') && !$('#lock-screen').classList.contains('hidden')) return;
  if (!$('.nav-btn[data-tab="passwords"]')?.classList.contains('active')) return;
  e.preventDefault();
  openQuickCreate();
});
function setStatus(unlocked) {
  $('#status-dot').className = 'status-dot ' + (unlocked ? 'on' : 'off');
  $('#status-text').textContent = unlocked ? t('unlocked') : t('locked');
  $('#status-pill').className = unlocked ? 'pill ok' : 'pill lock';
}

// ---------------- lock screen ----------------
let lockLangChosen = false;
function showLock(exists) {
  $$('[data-dialog]').forEach((d) => d.classList.add('hidden'));
  stopVerify();
  $('#lock').classList.remove('hidden');
  $('#shell').classList.add('hidden');
  $('#lock-create').classList.toggle('hidden', exists);
  $('#lock-unlock').classList.toggle('hidden', !exists);
  $('#lock-err').textContent = '';
  resetForm($('#lock-create'));
  resetForm($('#lock-unlock'));
  setStatus(false);
  clearTimeout(idleTimer);
  clearHistory();
  clearClipboardNow();
  setTimeout(() => (exists ? $('#unlock-pw') : $('#create-pw')).focus(), 50);
}
$$('[data-lock-lang]').forEach((b) => (b.onclick = () => {
  window.VaultI18n.setLang(b.dataset.lockLang);
  lockLangChosen = true;
  applyI18n();
}));
async function showApp({ tab } = {}) {
  $('#lock').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  setStatus(true);
  if (lockLangChosen) {
    lockLangChosen = false;
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ language: lang() }) }).catch(() => {});
  }
  await loadSettings();
  bumpIdle();
  switchTab(tab || 'home', { force: true });
}
async function boot() {
  try {
    const h = await api('/api/health');
    if (!h.exists) showLock(false);
    else if (!h.unlocked) showLock(true);
    else showApp();
  } catch { $('#lock-err').textContent = t('daemonDown'); }
}
bindForm($('#lock-create'), async () => {
  $('#lock-err').textContent = '';
  await api('/api/vault/create', { method: 'POST', body: JSON.stringify({ password: $('#create-pw').value }) });
  toast(t('vaultCreated'), 'ok');
  lockLangChosen = true; // keep the language picked on the lock screen
  showApp();
});
$('#btn-suggest-master').onclick = () => {
  const r = generatePassphrase({ words: 6, separator: '-', capitalize: true, includeNumber: true });
  for (const id of ['create-pw', 'create-pw2']) {
    const el = $('#' + id); el.value = r.value; el.type = 'text'; el.dataset.touched = '1';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  toast(t('f_suggested'), 'ok');
};
bindForm($('#lock-unlock'), async () => {
  $('#lock-err').textContent = '';
  try {
    await api('/api/vault/unlock', { method: 'POST', body: JSON.stringify({ password: $('#unlock-pw').value }) });
  } catch (e) {
    $('#lock-err').textContent = localizeServerError(e);
    $('#unlock-pw').select();
    return;
  }
  showApp();
});
$('#btn-lock').onclick = async () => {
  if (!(await guardLeave())) return;
  await api('/api/vault/lock', { method: 'POST', body: '{}' });
  showLock(true);
};

// ---------------- navigation ----------------
function setHeader(tab) {
  $('#page-title').textContent = t(`meta_${tab}_title`);
  $('#page-desc').textContent = t(`meta_${tab}_desc`);
  const actions = {
    passwords: `<button class="btn secondary" id="btn-pw-import">${esc(t('imp_btn'))}</button><button class="btn secondary" id="btn-open-gen">${ICONS.dice}<span>${esc(t('g_title'))}</span></button><button class="btn" id="btn-pw-quick">${esc(t('qc_btn'))}</button><button class="btn ghost" id="btn-pw-new">${esc(t('f_newItem'))}</button>`,
    assistants: `<button class="btn" id="btn-ai-new">${esc(t('ai_new'))}</button>`,
  };
  $('#page-actions').innerHTML = actions[tab] || '';
  if ($('#btn-pw-new')) $('#btn-pw-new').onclick = () => openPwDialog(null);
  if ($('#btn-pw-quick')) $('#btn-pw-quick').onclick = () => openQuickCreate();
  if ($('#btn-pw-import')) $('#btn-pw-import').onclick = () => openImportDialog();
  if ($('#btn-open-gen')) $('#btn-open-gen').onclick = openGenDialog;
  if ($('#btn-ai-new')) $('#btn-ai-new').onclick = openAiDialog;
}
const subOf = (tab) => $(`#tab-${tab} .subtabs button.on`)?.dataset.sub;
const LOADERS = {
  home: loadHome,
  passwords: () => (subOf('passwords') === 'pw-check' ? Promise.all([loadPasswords(), loadHealth()]) : loadPasswords()),
  connections: loadConnections,
  assistants: () => Promise.all([loadAssistants(), loadPerms()]),
  activity: () => Promise.all([loadActivity(), loadLimits()]),
  settings: loadSettings,
};
async function switchTab(tab, { force = false, sub } = {}) {
  if (!TABS.includes(tab)) tab = 'home';
  const current = $('.nav-btn.active')?.dataset.tab;
  if (!force && current && current !== tab && !(await guardLeave($(`#tab-${current}`)))) return;
  $$('.nav-btn[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab').forEach((s) => s.classList.add('hidden'));
  $(`#tab-${tab}`).classList.remove('hidden');
  if (sub) showSub(tab, sub);
  setHeader(tab);
  await reloadTab(tab);
}
async function reloadTab(tab = $('.nav-btn.active')?.dataset.tab) {
  try { await LOADERS[tab]?.(); } catch (e) { if (e.code === 'VAULT_LOCKED' || e.status === 423) showLock(true); else console.error(e); }
}
function showSub(tab, sub) {
  $$(`#tab-${tab} .subtabs button`).forEach((b) => { const on = b.dataset.sub === sub; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
  $$(`#tab-${tab} .subpanel`).forEach((p) => p.classList.toggle('hidden', p.id !== sub));
}
$$('.nav-btn[data-tab]').forEach((btn) => (btn.onclick = () => switchTab(btn.dataset.tab)));
$$('.subtabs button').forEach((b) => (b.onclick = async () => {
  const tab = b.closest('.tab').id.replace('tab-', '');
  if (!(await guardLeave($(`#tab-${tab} .subpanel:not(.hidden)`)))) return;
  showSub(tab, b.dataset.sub);
  if (b.dataset.sub === 'pw-check') loadHealth();
}));
Object.assign(nav, { switchTab, reloadTab, showLock, isUnlocked: () => !$('#shell').classList.contains('hidden') });
if (!isElectron) {
  window.addEventListener('beforeunload', (e) => {
    if ($$('form[data-guard]').some((f) => isDirty(f) && f.offsetParent !== null)) { e.preventDefault(); e.returnValue = ''; }
  });
}
// Electron tray actions (e.g. "Revoke all AI access") ask the page to refresh
window.vaultai?.onRefresh?.(() => { if (nav.isUnlocked()) reloadTab(); });

// ---------------- settings: General / Security / Advanced ----------------
async function loadSettings() {
  const r = await api('/api/settings');
  const s = r.settings;
  idleMinutes = s.idleLockMinutes ?? 30;
  clipboardState.seconds = s.clipboardClearSeconds ?? 30;
  if (!isDirty($('#settings-form'))) {
    $('#set-idle').value = idleMinutes;
    $('#set-clip').value = clipboardState.seconds;
    refreshSubmitState($('#settings-form'));
  }
  if (!isDirty($('#advanced-form'))) { $('#set-rate').value = s.rateLimitPerMinute ?? 120; refreshSubmitState($('#advanced-form')); }
  $('#set-icons').checked = s.fetchSiteIcons !== false;
  if ($('#autofill-form') && !isDirty($('#autofill-form'))) {
    $('#set-af-on').checked = s.autofillEnabled !== false;
    $('#set-af-trigger').value = s.autofillTextTrigger ?? 'pp';
    $('#set-af-hotkey').value = s.autofillHotkey ?? 'CommandOrControl+Shift+P';
    $('#set-af-confirm').checked = Boolean(s.autofillConfirm);
    if ($('#set-qc-hotkey')) $('#set-qc-hotkey').value = s.quickCreateHotkey ?? 'CommandOrControl+Shift+N';
    if ($('#set-save-hotkey')) $('#set-save-hotkey').value = s.saveLoginHotkey ?? 'CommandOrControl+Shift+S';
    refreshSubmitState($('#autofill-form'));
  }
  if ($('#dbstorage-form') && !isDirty($('#dbstorage-form'))) {
    const d = s.dbStorage || {};
    $('#db-enabled').checked = Boolean(d.enabled);
    $('#db-engine').value = d.engine || 'sqlite';
    $('#db-sqlite').value = d.sqlitePath || '';
    $('#db-uri').value = d.connectionUri || '';
    $('#db-host').value = d.host || '';
    $('#db-port').value = d.port || '';
    $('#db-user').value = d.user || '';
    $('#db-pass').value = '';
    $('#db-pass').placeholder = d.hasPassword ? '••••••••' : '';
    $('#db-name').value = d.database || '';
    $('#db-ssl').checked = Boolean(d.ssl);
    $('#db-plain').checked = Boolean(d.allowPlaintextStorage);
    toggleDbFields();
    const st = $('#db-status');
    if (st) {
      const recon = $('#btn-db-reconnect');
      if (s.dbStorageOffline || d.connectionState === 'offline') {
        st.textContent = t('h_dbStatusOffline') + (d.lastError ? (': ' + d.lastError) : '');
        recon?.classList.remove('hidden');
      } else if (s.dbStorageActive) {
        st.textContent = t('h_dbStatusOn');
        recon?.classList.add('hidden');
      } else if (d.lastError) {
        st.textContent = t('h_dbStatusErr') + ': ' + d.lastError;
        recon?.classList.toggle('hidden', !d.enabled);
      } else {
        st.textContent = t('h_dbStatusIdle');
        recon?.classList.add('hidden');
      }
    }
    refreshSubmitState($('#dbstorage-form'));
  }
  loadPrefs(s.generatorPrefs);
  const l = s.language || 'zh-CN';
  if (lang() !== l) { window.VaultI18n.setLang(l); resetGenerator(); }
  $('#set-lang').value = l;
  applyI18n();
  bumpIdle();
  if (!$('#tab-settings').classList.contains('hidden')) {
    const [st, h] = await Promise.all([api('/api/status'), api('/api/health')]);
    const rows = [
      [t('i_version'), h.version], [t('i_mode'), isElectron ? t('i_desktop') : t('i_browser')], [t('i_mcp'), st.mcpUrl],
      [t('i_dataDir'), h.dataDir], [t('i_uptime'), tf('i_uptimeV', { n: Math.round(h.uptimeSec / 60) })],
    ];
    $('#settings-info').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="mono">${esc(v)}</dd>`).join('');
  }
}
$('#set-lang').addEventListener('change', async () => {
  const l = $('#set-lang').value;
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ language: l }) });
  window.VaultI18n.setLang(l);
  resetGenerator();
  applyI18n();
  toast(t('languageSaved'), 'ok');
  reloadTab();
});
$('#set-icons').addEventListener('change', async () => {
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ fetchSiteIcons: $('#set-icons').checked }) });
  toast(t('settingsSaved'), 'ok');
});
bindForm($('#settings-form'), async () => {
  const body = { idleLockMinutes: Number($('#set-idle').value), clipboardClearSeconds: Number($('#set-clip').value) };
  await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
  idleMinutes = body.idleLockMinutes;
  clipboardState.seconds = body.clipboardClearSeconds;
  bumpIdle();
  toast(t('settingsSaved'), 'ok');
});
bindForm($('#autofill-form'), async () => {
  const body = {
    autofillEnabled: $('#set-af-on').checked,
    autofillTextTrigger: $('#set-af-trigger').value.trim(),
    autofillHotkey: $('#set-af-hotkey').value.trim() || 'CommandOrControl+Shift+P',
    autofillConfirm: $('#set-af-confirm').checked,
    quickCreateHotkey: ($('#set-qc-hotkey')?.value || '').trim() || 'CommandOrControl+Shift+N',
    saveLoginHotkey: ($('#set-save-hotkey')?.value || '').trim() || 'CommandOrControl+Shift+S',
  };
  await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
  toast(t('settingsSaved'), 'ok');
});

function toggleDbFields() {
  const eng = $('#db-engine')?.value || 'sqlite';
  $$('[data-db-sqlite]').forEach((el) => el.classList.toggle('hidden', eng !== 'sqlite'));
  $$('[data-db-server]').forEach((el) => el.classList.toggle('hidden', eng === 'sqlite'));
}
$('#db-engine')?.addEventListener('change', toggleDbFields);

function dbFormBody() {
  const eng = $('#db-engine').value;
  const body = {
    enabled: $('#db-enabled').checked,
    engine: eng,
    sqlitePath: $('#db-sqlite').value.trim(),
    connectionUri: $('#db-uri').value.trim(),
    host: $('#db-host').value.trim(),
    port: $('#db-port').value ? Number($('#db-port').value) : undefined,
    user: $('#db-user').value.trim(),
    database: $('#db-name').value.trim(),
    ssl: $('#db-ssl').checked,
    allowPlaintextStorage: $('#db-plain').checked,
    migrateLocal: true,
  };
  const pass = $('#db-pass').value;
  if (pass) body.password = pass;
  if (body.allowPlaintextStorage) body.confirmPlaintext = true;
  return body;
}

$('#btn-db-reconnect')?.addEventListener('click', async () => {
  try {
    const r = await api('/api/db-storage/reconnect', { method: 'POST', body: '{}' });
    toast(tf('h_dbReconnectOk', { n: r.count ?? 0 }), 'ok');
    nav.reloadTab?.();
    // refresh settings panel
    const s = (await api('/api/settings')).settings;
    const st = $('#db-status');
    if (st) st.textContent = t('h_dbStatusOn');
    $('#btn-db-reconnect')?.classList.add('hidden');
  } catch (e) {
    toast(localizeServerError(e), 'err');
  }
});
$('#btn-db-test')?.addEventListener('click', async () => {
  try {
    const body = dbFormBody();
    await api('/api/db-storage/test', { method: 'POST', body: JSON.stringify(body) });
    toast(t('dbTestOk'), 'ok');
    $('#db-status').textContent = t('h_dbStatusTestOk');
  } catch (e) {
    toast(localizeServerError(e), 'err');
  }
});

bindForm($('#dbstorage-form'), async () => {
  const body = dbFormBody();
  if (body.allowPlaintextStorage) {
    const ok = confirm(t('dbPlainConfirm'));
    if (!ok) return;
    body.confirmPlaintext = true;
  }
  const r = await api('/api/db-storage', { method: 'PUT', body: JSON.stringify(body) });
  toast(r.active ? t('dbEnabled') : t('dbDisabled'), 'ok');
  await loadSettings();
});
bindForm($('#advanced-form'), async () => {
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ rateLimitPerMinute: Number($('#set-rate').value) }) });
  toast(t('settingsSaved'), 'ok');
});
bindForm($('#changepw-form'), async () => {
  await api('/api/vault/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: $('#pw-old').value, newPassword: $('#pw-new').value }) });
  resetForm($('#changepw-form'));
  toast(t('pwChanged'), 'ok');
});
$('#btn-export').onclick = async () => {
  try {
    const r = await api('/api/vault/export');
    const blob = new Blob([JSON.stringify(r.backup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vaultai-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    toast(t('backupDone'), 'ok');
  } catch (e) { toast(localizeServerError(e), 'err'); }
};
let importBackup = null;
$('#btn-import').onclick = () => $('#import-file').click();
$('#import-file').addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  try { importBackup = JSON.parse(await file.text()); } catch { toast(t('e_badBackup'), 'err'); return; }
  if (!importBackup?.meta || !importBackup?.data) { toast(t('e_badBackup'), 'err'); return; }
  resetForm($('[data-form="import"]'));
  $('#import-file-name').textContent = file.name;
  openDialog($('#import-dialog'));
});
$$('[data-close-dialog]', $('#import-dialog')).forEach((b) => (b.onclick = () => closeDialog($('#import-dialog'))));
// The dialog itself states that it replaces the vault and has a red "Replace vault" button — one confirmation only.
bindForm($('[data-form="import"]'), async () => {
  await api('/api/vault/import', { method: 'POST', body: JSON.stringify({ backup: importBackup, password: $('#import-pw').value }) });
  closeDialog($('#import-dialog'));
  toast(t('importDone'), 'ok');
  showApp({ tab: 'home' });
});

// ---------------- init ----------------
wirePasswordAffordances();
wireStrengthUi();
applyI18n();
boot();
window.__vaultai = { version: VERSION, genState };
