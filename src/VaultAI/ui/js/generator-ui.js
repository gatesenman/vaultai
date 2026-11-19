// Password generator component (dialog + inline in the item dialog). Advanced options live under “More options”. Uses the shared CSPRNG engine.
import { generate, normalizePrefs, LIMITS, DEFAULT_OPTIONS, GeneratorError } from '/shared/generator.js';
import { estimateStrength } from '/shared/strength.js';
import { $, $$, t, tf, esc, ICONS, api, copyText, applyIcons, SCORE_KEYS, crackText } from './core.js';

export const genState = {
  prefs: normalizePrefs({ ...DEFAULT_OPTIONS }),
  history: [], // in-memory only, max 10, cleared on lock
  listeners: new Set(),
};
let saveTimer = null;
export function loadPrefs(p) { if (p && typeof p === 'object') Object.assign(genState.prefs, normalizePrefs({ ...DEFAULT_OPTIONS, ...p })); }
function savePrefs() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api('/api/settings', { method: 'PUT', body: JSON.stringify({ generatorPrefs: genState.prefs }) }).catch(() => {}), 500);
}
export function clearHistory() { genState.history = []; genState.listeners.forEach((f) => f()); }
function pushHistory(r) {
  genState.history.unshift({ value: r.value, mode: r.mode, bits: r.entropyBits, at: Date.now() });
  genState.history = genState.history.slice(0, 10);
  genState.listeners.forEach((f) => f());
}

/** Colourise characters: digits / symbols / letters */
function colorize(v, mode) {
  if (mode === 'passphrase') return esc(v);
  return [...v].map((c) => `<span class="${/\d/.test(c) ? 'c-d' : /[A-Za-z]/.test(c) ? '' : 'c-s'}">${esc(c)}</span>`).join('');
}

export function mountGenerator(root, { inline = false, onUse = null, idPrefix = 'gen' } = {}) {
  const P = idPrefix;
  root.innerHTML = `
    <div class="gen ${inline ? 'inline' : ''}" data-generator="${P}">
      <div class="gen-head">
        <div class="seg gen-mode" role="radiogroup" aria-label="${esc(t('g_mode'))}">
          <button type="button" role="radio" data-mode="password">${esc(t('g_password'))}</button>
          <button type="button" role="radio" data-mode="passphrase">${esc(t('g_passphrase'))}</button>
          <button type="button" role="radio" data-mode="pin">${esc(t('g_pin'))}</button>
        </div>
      </div>
      <div class="gen-output-wrap">
        <output class="gen-output mono" id="${P}-output" aria-live="polite"></output>
        <div class="gen-actions">
          <button type="button" class="icon-btn" data-act="regen" data-icon="refresh"></button>
          <button type="button" class="icon-btn" data-act="copy" data-icon="copy"></button>
          ${onUse ? `<button type="button" class="btn sm" data-act="use" id="${P}-use">${esc(t('g_use'))}</button>` : ''}
        </div>
      </div>
      <div class="meter gen-meter" id="${P}-meter"></div>
      <div class="err gen-err" id="${P}-err" role="alert"></div>
      <div class="gen-opts" data-for="password">
        <div class="field"><label class="field-label" for="${P}-len">${esc(t('g_length'))}</label>
          <div class="slider-row"><input type="range" id="${P}-len-range" min="${LIMITS.password.min}" max="${LIMITS.password.max}" data-noguard aria-label="${esc(t('g_length'))}" />
          <input type="number" id="${P}-len" class="num" min="${LIMITS.password.min}" max="${LIMITS.password.max}" inputmode="numeric" data-noguard /></div>
          <div class="help">${esc(tf('g_lengthHelp', { min: LIMITS.password.min, max: LIMITS.password.max }))}</div></div>
        <div class="check-grid">
          <label class="check"><input type="checkbox" data-opt="upper" data-noguard /> <span>A–Z</span></label>
          <label class="check"><input type="checkbox" data-opt="lower" data-noguard /> <span>a–z</span></label>
          <label class="check"><input type="checkbox" data-opt="digits" data-noguard /> <span>0–9</span></label>
          <label class="check"><input type="checkbox" data-opt="symbols" data-noguard /> <span>!@#$%</span></label>
        </div>
        <details class="gen-more"><summary>${esc(t('g_more'))}</summary>
        <div class="check-grid">
          <label class="check"><input type="checkbox" data-opt="excludeAmbiguous" data-noguard /> <span>${esc(t('g_ambiguous'))}</span></label>
          <label class="check"><input type="checkbox" data-opt="avoidRepeats" data-noguard /> <span>${esc(t('g_repeats'))}</span></label>
        </div>
        <div class="form-grid three">
          <div class="field"><label class="field-label" for="${P}-mind">${esc(t('g_minDigits'))}</label><input type="number" id="${P}-mind" data-opt="minDigits" min="0" max="64" class="num" data-noguard /></div>
          <div class="field"><label class="field-label" for="${P}-mins">${esc(t('g_minSymbols'))}</label><input type="number" id="${P}-mins" data-opt="minSymbols" min="0" max="64" class="num" data-noguard /></div>
          <div class="field"><label class="field-label" for="${P}-excl">${esc(t('g_exclude'))}</label><input id="${P}-excl" data-opt="exclude" spellcheck="false" autocomplete="off" placeholder="{}[]\\\`" class="mono" data-noguard /></div>
        </div>
        </details>
      </div>
      <div class="gen-opts" data-for="passphrase">
        <div class="field"><label class="field-label" for="${P}-words">${esc(t('g_words'))}</label>
          <div class="slider-row"><input type="range" id="${P}-words-range" min="${LIMITS.words.min}" max="${LIMITS.words.max}" data-noguard aria-label="${esc(t('g_words'))}" />
          <input type="number" id="${P}-words" class="num" min="${LIMITS.words.min}" max="${LIMITS.words.max}" data-noguard /></div>
          <div class="help">${esc(t('g_wordsHelp'))}</div></div>
        <details class="gen-more"><summary>${esc(t('g_more'))}</summary>
        <div class="form-grid three">
          <div class="field"><label class="field-label" for="${P}-sep">${esc(t('g_separator'))}</label>
            <select id="${P}-sep" data-opt="separator" data-noguard>
              <option value="-">- ${esc(t('g_sepHyphen'))}</option><option value=".">. ${esc(t('g_sepDot'))}</option>
              <option value="_">_ ${esc(t('g_sepUnderscore'))}</option><option value=" ">␣ ${esc(t('g_sepSpace'))}</option>
              <option value=",">, ${esc(t('g_sepComma'))}</option><option value="">${esc(t('g_sepNone'))}</option></select></div>
          <label class="check"><input type="checkbox" data-opt="capitalize" data-noguard /> <span>${esc(t('g_capitalize'))}</span></label>
          <label class="check"><input type="checkbox" data-opt="includeNumber" data-noguard /> <span>${esc(t('g_number'))}</span></label>
        </div>
        </details>
      </div>
      <div class="gen-opts" data-for="pin">
        <div class="field"><label class="field-label" for="${P}-pinlen">${esc(t('g_pinLength'))}</label>
          <div class="slider-row"><input type="range" id="${P}-pinlen-range" min="${LIMITS.pin.min}" max="${LIMITS.pin.max}" data-noguard aria-label="${esc(t('g_pinLength'))}" />
          <input type="number" id="${P}-pinlen" class="num" min="${LIMITS.pin.min}" max="${LIMITS.pin.max}" data-noguard /></div></div>
        <div class="help">${esc(t('g_pinHelp'))}</div>
        <details class="gen-more"><summary>${esc(t('g_more'))}</summary>
        <label class="check"><input type="checkbox" data-opt="avoidRepeats" data-pin="1" data-noguard /> <span>${esc(t('g_repeats'))}</span></label>
        </details>
      </div>
      <p class="muted small gen-foot">${esc(t('g_csprng'))}</p>
    </div>`;
  applyIcons(root);
  const g = $('.gen', root);
  let current = null;
  // pin length is stored separately so switching modes keeps both lengths
  const prefs = genState.prefs;

  function syncUi() {
    $$('.gen-mode button', g).forEach((b) => { const on = b.dataset.mode === prefs.mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
    $$('.gen-opts', g).forEach((o) => o.classList.toggle('hidden', o.dataset.for !== prefs.mode));
    $(`#${P}-len`, g).value = $(`#${P}-len-range`, g).value = prefs.length;
    $(`#${P}-words`, g).value = $(`#${P}-words-range`, g).value = prefs.words;
    $(`#${P}-pinlen`, g).value = $(`#${P}-pinlen-range`, g).value = prefs.pinLength;
    $$('[data-opt]', g).forEach((el) => {
      const k = el.dataset.opt;
      if (el.type === 'checkbox') el.checked = Boolean(prefs[k]);
      else el.value = prefs[k] ?? '';
    });
  }
  function options() {
    if (prefs.mode === 'pin') return { mode: 'pin', length: prefs.pinLength, avoidRepeats: prefs.avoidRepeats };
    return { ...prefs, mode: prefs.mode };
  }
  function regen(record = true) {
    const err = $(`#${P}-err`, g);
    try {
      current = generate(options());
      err.innerHTML = '';
      $(`#${P}-output`, g).innerHTML = colorize(current.value, current.mode);
      $(`#${P}-output`, g).dataset.value = current.value;
      const s = estimateStrength(current.value);
      const bits = Math.min(current.entropyBits, Math.max(s.bits, current.entropyBits)); // generation entropy is exact
      const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
      const m = $(`#${P}-meter`, g);
      m.dataset.score = score;
      m.innerHTML = `<div class="meter-bar">${[0, 1, 2, 3].map((i) => `<span class="${i < Math.max(1, score) ? 'on' : ''}"></span>`).join('')}</div>
        <div class="meter-meta"><strong class="meter-label">${esc(t(SCORE_KEYS[score]))}</strong>
        <span class="meter-bits" data-bits="${current.entropyBits}">${esc(tf('g_entropy', { n: current.entropyBits }))}</span>
        <span class="meter-crack">${esc(tf('st_crackFast', { t: crackText(Math.pow(2, current.entropyBits) / 2 / 1e10) }))}</span></div>`;
      if (record) pushHistory(current);
    } catch (e) {
      err.innerHTML = `${ICONS.alert}<span>${esc(e instanceof GeneratorError ? t('ge_' + e.code) || e.message : String(e))}</span>`;
    }
  }
  const setPref = (k, v, record = false) => { prefs[k] = v; savePrefs(); regen(record); };

  $$('.gen-mode button', g).forEach((b) => (b.onclick = () => { prefs.mode = b.dataset.mode; syncUi(); savePrefs(); regen(false); }));
  const pair = (rangeId, numId, key, lim) => {
    const r = $(`#${P}-${rangeId}`, g), n = $(`#${P}-${numId}`, g);
    r.oninput = () => { n.value = r.value; setPref(key, Number(r.value)); };
    n.onchange = () => { const v = Math.min(lim.max, Math.max(lim.min, Math.round(Number(n.value) || lim.def))); n.value = r.value = v; setPref(key, v); };
  };
  pair('len-range', 'len', 'length', LIMITS.password);
  pair('words-range', 'words', 'words', LIMITS.words);
  pair('pinlen-range', 'pinlen', 'pinLength', LIMITS.pin);
  $$('[data-opt]', g).forEach((el) => {
    const k = el.dataset.opt;
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.max(0, Math.round(Number(el.value) || 0)) : el.value;
      setPref(k, v);
      if (el.type === 'checkbox') $$(`[data-opt="${k}"]`, g).forEach((o) => (o.checked = el.checked));
    });
  });
  $('[data-act="regen"]', g).onclick = () => regen(true);
  $('[data-act="copy"]', g).onclick = () => current && copyText(current.value, { secret: true });
  const use = $('[data-act="use"]', g);
  if (use) use.onclick = () => current && onUse(current.value);
  syncUi();
  regen(!inline);
  return { regen, get value() { return current?.value; }, syncUi };
}

export function renderHistory(listEl) {
  const draw = () => {
    if (!genState.history.length) { listEl.innerHTML = `<li class="muted">${esc(t('g_historyEmpty'))}</li>`; return; }
    listEl.innerHTML = genState.history.map((h, i) => `<li>
      <span class="mono hist-val" data-hist-val="${i}">${'•'.repeat(Math.min(16, h.value.length))}</span>
      <span class="muted small">${esc(t('g_' + h.mode))} · ${h.bits} ${esc(t('st_bits'))} · ${esc(new Date(h.at).toLocaleTimeString())}</span>
      <span class="hist-actions"><button type="button" class="icon-btn" data-hist-eye="${i}" data-icon="eye"></button>
      <button type="button" class="icon-btn" data-hist-copy="${i}" data-icon="copy"></button></span></li>`).join('');
    applyIcons(listEl);
    $$('[data-hist-copy]', listEl).forEach((b) => (b.onclick = () => copyText(genState.history[+b.dataset.histCopy].value, { secret: true })));
    $$('[data-hist-eye]', listEl).forEach((b) => (b.onclick = () => {
      const s = $(`[data-hist-val="${b.dataset.histEye}"]`, listEl);
      const h = genState.history[+b.dataset.histEye];
      s.textContent = s.dataset.shown ? '•'.repeat(Math.min(16, h.value.length)) : h.value;
      s.dataset.shown = s.dataset.shown ? '' : '1';
    }));
  };
  genState.listeners.add(draw);
  draw();
}
