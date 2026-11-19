/** 1.6.1 mini picker: positioning (flip/clamp/multi-monitor/DPI), anchor fallbacks, keyboard, window flags. */
import { Recorder, assert, ROOT } from './lib.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export async function runUnitMiniPicker() {
  const m = await import(pathToFileURL(join(ROOT, 'ui/autofill/mini-core.js')).href);
  const rec = new Recorder('Unit-MiniPicker');
  const D1 = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
  // 4K @150% to the right: DIP 2560x1440, physical origin x=1920*1.5=2880 by our model
  const D2 = { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1392 }, scaleFactor: 1.5 };
  // monitor on the left with negative coords, taskbar on top
  const D0 = { id: 0, bounds: { x: -1280, y: 0, width: 1280, height: 1024 }, workArea: { x: -1280, y: 40, width: 1280, height: 984 }, scaleFactor: 1 };
  const displays = [D0, D1, D2];
  const W = m.MINI.width;

  await rec.run('size: width 260–320, rows 28–32, max 6 rows', () => {
    assert(W >= 260 && W <= 320 && m.MINI.rowHeight >= 28 && m.MINI.rowHeight <= 32 && m.MINI.maxRows === 6);
    assert(m.miniHeight(0) === m.miniHeight(1), 'no-match shows one row');
    assert(m.miniHeight(3) === m.MINI.pad + 3 * m.MINI.rowHeight + m.MINI.footer);
    assert(m.miniHeight(50) === m.miniHeight(6), 'scroll after 6');
  });

  await rec.run('below caret line by default', () => {
    const b = m.computeMiniBounds({ anchor: { x: 400, y: 300, width: 1, height: 20 }, displays, height: 120 });
    assert(b.x === 400 && b.y === 300 + 20 + m.MINI.gap && !b.flipped && b.displayId === 1, JSON.stringify(b));
  });

  await rec.run('flips above near work-area bottom (taskbar)', () => {
    const b = m.computeMiniBounds({ anchor: { x: 400, y: 990, width: 1, height: 20 }, displays, height: 120 });
    assert(b.flipped && b.y === 990 - m.MINI.gap - 120, JSON.stringify(b));
    assert(b.y + b.height <= 1040);
  });

  await rec.run('clamps to right edge of work area', () => {
    const b = m.computeMiniBounds({ anchor: { x: 1900, y: 300, width: 1, height: 20 }, displays: [D1], height: 120 });
    assert(b.x === 1920 - W, JSON.stringify(b));
  });

  await rec.run('clamps on secondary monitor (not primary edge)', () => {
    const b = m.computeMiniBounds({ anchor: { x: 4470, y: 1380, width: 1, height: 16 }, displays, height: 100 });
    assert(b.displayId === 2 && b.x === 1920 + 2560 - W && b.flipped && b.y + 100 <= 1392, JSON.stringify(b));
  });

  await rec.run('negative-coordinate monitor + top taskbar clamp', () => {
    const b = m.computeMiniBounds({ anchor: { x: -1290, y: 10, width: 1, height: 18 }, displays, height: 100 });
    assert(b.displayId === 0 && b.x === -1280 && b.y >= 40, JSON.stringify(b));
  });

  await rec.run('tiny work area: neither above nor below fits → pinned inside', () => {
    const d = { id: 9, bounds: { x: 0, y: 0, width: 800, height: 200 }, workArea: { x: 0, y: 0, width: 800, height: 200 }, scaleFactor: 1 };
    const b = m.computeMiniBounds({ anchor: { x: 10, y: 90, width: 1, height: 20 }, displays: [d], height: 150 });
    assert(b.y >= 0 && b.y + 150 <= 200, JSON.stringify(b));
  });

  await rec.run('DPI: physical px → DIP per monitor (100% and 150%)', () => {
    const a = m.physicalToDip({ x: 600, y: 300, width: 2, height: 24 }, displays);
    assert(a.x === 600 && a.y === 300 && a.height === 24, JSON.stringify(a));
    const b = m.physicalToDip({ x: 2880 + 300, y: 450, width: 3, height: 30 }, displays);
    assert(b.x === 1920 + 200 && b.y === 300 && b.height === 20 && b.width === 2, JSON.stringify(b));
  });

  await rec.run('anchor fallbacks: caret → element → mouse', () => {
    const c = m.chooseAnchor({ caret: { x: 5, y: 6, width: 1, height: 18 }, element: { x: 1, y: 2, width: 100, height: 30 }, mouse: { x: 9, y: 9 } });
    assert(c.source === 'caret' && c.rect.x === 5);
    const e = m.chooseAnchor({ caret: { x: 0, y: 0, width: 0, height: 0 }, element: { x: 1, y: 2, width: 100, height: 30 }, mouse: { x: 9, y: 9 } });
    assert(e.source === 'element' && e.rect.x === 1 && e.rect.y + e.rect.height === 32, 'element bottom-left ' + JSON.stringify(e));
    const u = m.chooseAnchor({ caret: null, element: null, mouse: { x: 9, y: 9 } });
    assert(u.source === 'mouse' && u.rect.x === 9);
    const bad = m.chooseAnchor({ caret: { x: NaN, y: 1, width: 1, height: 10 }, element: { x: 0, y: 0, width: 0, height: 0 }, mouse: { x: 3, y: 4 } });
    assert(bad.source === 'mouse');
  });

  await rec.run('keyboard: ↑↓ wrap, Enter/Tab fill, Esc dismiss', () => {
    let s = { idx: 0, count: 3 };
    let r = m.reduceKey(s, 'Down'); assert(r.idx === 1 && r.action === 'none');
    r = m.reduceKey({ idx: 2, count: 3 }, 'Down'); assert(r.idx === 0, 'wrap down');
    r = m.reduceKey({ idx: 0, count: 3 }, 'Up'); assert(r.idx === 2, 'wrap up');
    r = m.reduceKey({ idx: 1, count: 3 }, 'Enter'); assert(r.action === 'fill' && r.pickIndex === 1);
    r = m.reduceKey({ idx: 2, count: 3 }, 'Tab'); assert(r.action === 'fill' && r.pickIndex === 2);
    r = m.reduceKey({ idx: 1, count: 3 }, 'Escape'); assert(r.action === 'dismiss');
  });

  await rec.run('number keys 1–6 quick-pick; out of range ignored; 7 ignored', () => {
    assert(m.reduceKey({ idx: 0, count: 6 }, '6').pickIndex === 5);
    assert(m.reduceKey({ idx: 0, count: 2 }, '1').pickIndex === 0);
    assert(m.reduceKey({ idx: 0, count: 2 }, '3').action === 'none');
    assert(m.reduceKey({ idx: 0, count: 9 }, '7').action === 'none');
  });

  await rec.run('single match does not auto-fill; no match → open-app', () => {
    assert(m.reduceKey({ idx: 0, count: 1 }, 'Down').action === 'none');
    assert(m.reduceKey({ idx: 0, count: 0 }, 'Enter').action === 'open-app');
    assert(m.reduceKey({ idx: 0, count: 0 }, '1').action === 'none');
  });

  await rec.run('outside-click detection', () => {
    const b = { x: 100, y: 100, width: 288, height: 120 };
    assert(!m.isOutsideClick(b, { x: 150, y: 150 }));
    assert(m.isOutsideClick(b, { x: 99, y: 150 }));
    assert(m.isOutsideClick(b, { x: 150, y: 220 }));
  });

  await rec.run('window flags: non-activating, on top, no taskbar, no chrome', () => {
    const o = m.miniWindowOptions({ x: 1, y: 2, width: 294, height: 140 });
    assert(o.focusable === false && o.alwaysOnTop === true && o.skipTaskbar === true && o.frame === false && o.show === false);
    assert(o.resizable === false && o.transparent === true && o.width === 294);
    assert(m.PICKER_KEYS.join(',') === 'Up,Down,Enter,Tab,Escape,1,2,3,4,5,6');
  });

  await rec.run('letter avatar stable', () => {
    const a = m.avatarFor('github'), b = m.avatarFor('github');
    assert(a.letter === 'G' && a.hue === b.hue && m.avatarFor('').letter === '?' && m.avatarFor('微信').letter === '微');
  });
  return [rec];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [rec] = await runUnitMiniPicker();
  const failed = rec.cases.filter((c) => c.ok === false);
  for (const c of failed) console.log('FAIL', c.name, c.detail);
  console.log(`SUMMARY mini-unit ${rec.cases.filter((c) => c.ok).length}/${rec.cases.length}`);
  process.exitCode = failed.length ? 1 : 0;
}
