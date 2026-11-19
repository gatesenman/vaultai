/** Mini floating quick-create sheet (1.8.0). Talks to main via VaultQuickCreate. */
const params = new URLSearchParams(location.search);
const port = params.get('port') || '3847';
const lang = (params.get('lang') || 'zh-CN').startsWith('zh') ? 'zh' : 'en';
const preUrl = params.get('url') || '';
const preTitle = params.get('title') || '';
const preHost = params.get('host') || '';
const preUser = params.get('user') || '';
const mode = params.get('mode') === 'save' ? 'save' : 'quick';

const I18N = {
  zh: {
    ttl: '快速新建', ttlSave: '保存此登录', url: '网址', title: '标题', user: '用户名', pass: '密码',
    save: '保存', another: '保存并再建', more: '更多…',
    needPass: '请填写密码', saved: '已保存', foot: 'Esc 取消 · 全局快捷键唤醒',
    footSave: 'Esc 取消 · 仅在按快捷键后读取焦点（不常驻监听键盘）',
    show: '显示', hide: '隐藏',
  },
  en: {
    ttl: 'Quick create', ttlSave: 'Save this login', url: 'Website', title: 'Title', user: 'Username', pass: 'Password',
    save: 'Save', another: 'Save & another', more: 'More…',
    needPass: 'Password required', saved: 'Saved', foot: 'Esc to cancel · global hotkey wake',
    footSave: 'Esc to cancel · reads focus only after the hotkey (no always-on keylog)',
    show: 'Show', hide: 'Hide',
  },
};
const t = I18N[lang];

const $ = (id) => document.getElementById(id);
$('ttl').textContent = mode === 'save' ? t.ttlSave : t.ttl;
$('lab-url').textContent = t.url;
$('lab-title').textContent = t.title;
$('lab-user').textContent = t.user;
$('lab-pass').textContent = t.pass;
$('btn-save').textContent = t.save;
$('btn-another').textContent = t.another;
$('btn-more').textContent = t.more;
$('foot').textContent = mode === 'save' ? t.footSave : t.foot;
$('btn-eye').title = t.show;

function hostOf(u) {
  try { return new URL(u.includes('://') ? u : 'https://' + u).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}
function normalizeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  try { return new URL(s.includes('://') ? s : 'https://' + s).href; }
  catch { return s; }
}

let titleAuto = true;
$('url').value = preUrl || (preHost ? 'https://' + preHost : '');
if (preTitle && mode === 'quick') { $('title').value = preTitle; titleAuto = false; }
else if (preHost) { $('title').value = preHost; }
else if ($('url').value) { const h = hostOf($('url').value); if (h) $('title').value = h; }
if (preUser) $('user').value = preUser;
window.VaultQuickCreate?.onPrefillSecret?.((v) => {
  if (!v) return;
  $('pass').value = v;
  // Prefer focusing empty username when password was captured from a password field
  setTimeout(() => { if (!$('user').value) $('user').focus(); else $('pass').focus(); }, 50);
});

$('url').addEventListener('input', () => {
  if (!titleAuto) return;
  const h = hostOf($('url').value);
  $('title').value = h || '';
});
$('title').addEventListener('input', () => { titleAuto = !$('title').value; });

$('btn-eye').onclick = () => {
  const p = $('pass');
  const show = p.type === 'password';
  p.type = show ? 'text' : 'password';
  $('btn-eye').title = show ? t.hide : t.show;
};
$('btn-gen').onclick = async () => {
  try {
    const r = await window.VaultQuickCreate.generate();
    if (r?.ok && r.value) {
      $('pass').value = r.value;
      $('pass').type = 'text';
      $('btn-eye').title = t.hide;
      $('pass').focus();
    }
  } catch { /* */ }
};
$('btn-x').onclick = () => window.VaultQuickCreate.dismiss();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); window.VaultQuickCreate.dismiss(); }
});

function payload() {
  const urlRaw = $('url').value.trim();
  let title = $('title').value.trim();
  const username = $('user').value.trim();
  const password = $('pass').value;
  const url = urlRaw ? normalizeUrl(urlRaw) : '';
  if (!title && url) title = hostOf(url) || url;
  if (!title) title = username || (lang === 'zh' ? '未命名登录' : 'Untitled login');
  return { title, username, password, url: url || undefined };
}

function clearForm() {
  $('url').value = '';
  $('title').value = '';
  titleAuto = true;
  $('user').value = '';
  $('pass').value = '';
  $('pass').type = 'password';
  $('btn-eye').title = t.show;
  $('err').classList.add('hidden');
  $('url').focus();
}

async function doSave(another) {
  const body = payload();
  if (!body.password) {
    $('err').textContent = t.needPass;
    $('err').classList.remove('hidden');
    $('pass').focus();
    reportHeight();
    return;
  }
  $('err').classList.add('hidden');
  const r = await window.VaultQuickCreate.save({ ...body, another: !!another });
  if (!r?.ok) {
    $('err').textContent = r?.error || 'Error';
    $('err').classList.remove('hidden');
    reportHeight();
    return;
  }
  if (another) clearForm();
}

$('form').onsubmit = (e) => { e.preventDefault(); void doSave(false); };
$('btn-another').onclick = () => { void doSave(true); };
$('btn-more').onclick = () => {
  const body = payload();
  window.VaultQuickCreate.openMore({
    title: body.title, username: body.username, url: body.url || '', password: $('pass').value,
  });
};

function reportHeight() {
  const h = Math.ceil(document.getElementById('sheet').getBoundingClientRect().height) + 12;
  window.VaultQuickCreate.resize(h);
}
window.addEventListener('load', () => {
  reportHeight();
  setTimeout(() => {
    if (mode === 'save' && preUser) $('pass').focus();
    else if (mode === 'save' && $('pass').value) $('user').focus();
    else $('url').focus();
  }, 40);
});
new ResizeObserver(reportHeight).observe(document.getElementById('sheet'));
