// Home: migration notices, onboarding checklist, "what AI can access now" with the kill switch, today, password health.
import { $, $$, t, tf, esc, toast, api, confirmDialog } from '../core.js';
import { clientLabel, levelLabel, emptyState, relTime, fmtDate, asstStatus, actionText, nav } from '../ui-common.js';
import { openAiDialog, openSetup } from './assistants.js';
import { openPwDialog } from './passwords.js';

export async function killSwitch() {
  if (!(await confirmDialog(t('ks_title'), t('ks_body'), { okText: t('ks_ok') }))) return;
  const r = await api('/api/assistants/revoke-all', { method: 'POST', body: '{}' });
  toast(tf('ks_done', { n: r.count }), 'ok');
  nav.reloadTab();
}
$('#btn-killswitch').onclick = killSwitch;
$('#btn-killswitch-home').onclick = killSwitch;

const PRESET_NAMES = { linear: 'Linear', sentry: 'Sentry', slack: 'Slack' };
function noticeText(n) {
  const p = { ...(n.params || {}) };
  if (p.from) p.from = PRESET_NAMES[p.from] || p.from;
  return tf(n.code.replace('.', '_'), p);
}
export async function loadHome() {
  const o = await api('/api/overview');
  const notices = o.notices || [];
  $('#home-notices').innerHTML = notices.length ? `<div class="card notices" id="mig-notices">
    <div class="card-head"><h3>${esc(t('mig_title'))}</h3><span class="spacer"></span><button class="btn sm ghost" id="btn-notices-all">${esc(t('mig_dismissAll'))}</button></div>
    <ul class="notice-list">${notices.map((n) => `<li data-notice="${esc(n.code)}"><span class="grow">${esc(noticeText(n))}</span><button class="btn sm ghost" data-dismiss="${esc(n.id)}">${esc(t('mig_dismiss'))}</button></li>`).join('')}</ul></div>` : '';
  $$('[data-dismiss]').forEach((b) => (b.onclick = async () => { await api(`/api/migrations/${encodeURIComponent(b.dataset.dismiss)}/dismiss`, { method: 'POST', body: '{}' }); loadHome(); }));
  if ($('#btn-notices-all')) $('#btn-notices-all').onclick = async () => { await api('/api/migrations/all/dismiss', { method: 'POST', body: '{}' }); loadHome(); };

  const ob = o.onboarding;
  const steps = [['ob-step-vault', ob.vault], ['ob-step-cred', ob.credential], ['ob-step-ai', ob.assistant], ['ob-step-verify', ob.connected]];
  const done = steps.filter(([, d]) => d).length;
  $('#onboarding').classList.toggle('hidden', ob.dismissed || done === steps.length);
  $('#ob-progress').textContent = tf('ob_progress', { n: done, total: steps.length });
  let currentSet = false;
  for (const [id, d] of steps) {
    const li = $('#' + id);
    li.classList.toggle('done', d);
    const cur = !d && !currentSet; if (cur) currentSet = true;
    li.classList.toggle('current', cur);
  }
  $('#btn-ob-verify').disabled = !ob.assistant;

  const list = $('#home-access-list');
  const active = o.assistants.filter((a) => a.enabled && !a.expired);
  $('#btn-killswitch-home').classList.toggle('hidden', !active.length);
  if (!o.assistants.length) {
    list.innerHTML = emptyState('◎', t('a_none'), t('a_noneHint'), { id: 'btn-home-ai', label: t('ai_new') });
    $('#btn-home-ai').onclick = openAiDialog;
  } else {
    list.innerHTML = `<ul class="access-list">${o.assistants.map((a) => {
      const live = a.enabled && !a.expired;
      return `<li data-access="${esc(a.id)}">
      <div class="access-head"><strong>${esc(a.name)}</strong> <span class="muted small">${esc(clientLabel(a.kind))}</span> ${asstStatus(a)}
        <span class="spacer"></span><span class="muted small">${esc(t('col_expires'))}: ${esc(a.expiresAt ? fmtDate(a.expiresAt) : t('d_never'))} · ${esc(t('a_lastSeen'))}: ${esc(relTime(a.lastSeenAt))}</span></div>
      <div class="chips">${live && a.access.length
        ? a.access.map((x) => `<span class="chip lvl-${x.level}">${esc(x.kind === 'passwords' ? t('passwordsVault') : x.name)} · ${esc(levelLabel(x.level))}</span>`).join('')
        : `<span class="muted small">${esc(live ? t('h_noAccess') : t('h_noAccessOff'))}</span>`}</div></li>`;
    }).join('')}</ul>`;
  }
  $('#home-today-stats').innerHTML = `
    <div class="stat"><div class="k">${esc(t('act_ok'))}</div><div class="v" id="today-ok">${o.today.ok}</div></div>
    <div class="stat ${o.today.refused ? 'bad' : ''}"><div class="k">${esc(t('act_refused'))}</div><div class="v" id="today-refused">${o.today.refused}</div></div>`;
  $('#home-today-list').innerHTML = o.today.recent.length
    ? `<ul class="recent-list">${o.today.recent.map((r) => `<li>${r.ok ? `<span class="badge ok">${esc(t('act_ok'))}</span>` : `<span class="badge no">${esc(t('act_refused'))}</span>`} <span class="mono">${esc(actionText(r.action))}</span> <span class="muted small">${esc(r.assistantName)} · ${esc(new Date(r.at).toLocaleTimeString())}</span></li>`).join('')}</ul>`
    : `<div class="muted small">${esc(t('h_todayEmpty'))}</div>`;
  const h = o.health;
  $('#home-health-body').innerHTML = h.total
    ? `<div class="stat-row"><div class="stat score ${h.score >= 90 ? 'ok' : h.score >= 60 ? 'warn' : 'bad'}"><div class="k">${esc(t('s_score'))}</div><div class="v" id="home-score">${h.score}%</div></div>
       <div class="stat"><div class="k">${esc(t('s_total'))}</div><div class="v">${h.total}</div></div>
       <div class="stat ${h.issues ? 'bad' : ''}"><div class="k">${esc(t('s_issues'))}</div><div class="v" id="home-issues">${h.issues}</div></div></div>`
    : emptyState('◉', t('emptyPasswords'), t('emptyPasswordsHint'), { id: 'btn-home-pw', label: t('f_newItem') });
  if ($('#btn-home-pw')) $('#btn-home-pw').onclick = () => openPwDialog(null);
}
$('#btn-ob-hide').onclick = async () => { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ onboardingDismissed: true }) }); loadHome(); };
$('#btn-ob-conn').onclick = () => nav.switchTab('connections');
$('#btn-ob-pw').onclick = () => openPwDialog(null);
$('#btn-ob-ai').onclick = openAiDialog;
$('#btn-ob-verify').onclick = async () => {
  const { assistants } = await api('/api/assistants');
  if (assistants.length) openSetup(assistants[assistants.length - 1]);
};
$('#lnk-home-activity').onclick = (e) => { e.preventDefault(); nav.switchTab('activity'); };
$('#lnk-home-health').onclick = (e) => { e.preventDefault(); nav.switchTab('passwords', { sub: 'pw-check' }); };
