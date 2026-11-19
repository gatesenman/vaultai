/**
 * VaultAI 1.6.1 caret-following mini picker — pure logic shared by
 * Electron main (positioning, key routing), the renderer, and unit tests.
 * No DOM / Node APIs here.
 */

export const MINI = Object.freeze({
  width: 288,       // px (DIP) — within 260–320
  rowHeight: 30,    // px per row
  maxRows: 6,       // visible rows before scrolling
  footer: 18,       // one-line muted footer
  pad: 8,           // top+bottom padding inside the box
  gap: 4,           // distance between caret line and box
});

/** Height of the box for n matches (n=0 still shows one "no match" row). */
export function miniHeight(n, opts = MINI) {
  const rows = Math.max(1, Math.min(opts.maxRows, n | 0));
  return opts.pad + rows * opts.rowHeight + opts.footer;
}

function contains(r, p) {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
}

function dist2(r, p) {
  const dx = p.x < r.x ? r.x - p.x : p.x > r.x + r.width ? p.x - (r.x + r.width) : 0;
  const dy = p.y < r.y ? r.y - p.y : p.y > r.y + r.height ? p.y - (r.y + r.height) : 0;
  return dx * dx + dy * dy;
}

/**
 * Pick the display for a point (DIP). Falls back to nearest display.
 * displays: [{ id, bounds:{x,y,width,height}, workArea:{...}, scaleFactor }]
 */
export function displayForPoint(displays, p) {
  if (!displays || !displays.length) return null;
  return displays.find((d) => contains(d.bounds, p))
    || displays.slice().sort((a, b) => dist2(a.bounds, p) - dist2(b.bounds, p))[0];
}

/**
 * Convert a physical-pixel rect (Win32 / UIA coordinates) to DIP for a
 * per-monitor-DPI layout. Each display gives its DIP bounds + scaleFactor;
 * its physical origin is assumed to be bounds.x*scale, bounds.y*scale
 * (what Windows reports for side-by-side monitors). In Electron on Windows
 * prefer screen.screenToDipRect(); this is the portable fallback & test model.
 */
export function physicalToDip(rect, displays) {
  if (!displays || !displays.length) return { ...rect };
  const phys = displays.map((d) => ({
    d,
    pb: {
      x: Math.round(d.bounds.x * d.scaleFactor),
      y: Math.round(d.bounds.y * d.scaleFactor),
      width: Math.round(d.bounds.width * d.scaleFactor),
      height: Math.round(d.bounds.height * d.scaleFactor),
    },
  }));
  const p = { x: rect.x, y: rect.y };
  const hit = phys.find((q) => contains(q.pb, p))
    || phys.slice().sort((a, b) => dist2(a.pb, p) - dist2(b.pb, p))[0];
  const s = hit.d.scaleFactor || 1;
  return {
    x: hit.d.bounds.x + (rect.x - hit.pb.x) / s,
    y: hit.d.bounds.y + (rect.y - hit.pb.y) / s,
    width: rect.width / s,
    height: rect.height / s,
  };
}

/**
 * Choose the anchor rect (DIP) in priority order:
 *   caret → focused element (bottom-left, 1px tall line) → mouse cursor.
 * Rects with zero/negative size or absurd coords are rejected.
 */
export function chooseAnchor({ caret, element, mouse }) {
  const ok = (r) => r && Number.isFinite(r.x) && Number.isFinite(r.y)
    && r.height > 0 && r.height < 400 && Math.abs(r.x) < 1e5 && Math.abs(r.y) < 1e5
    && !(r.x === 0 && r.y === 0 && r.width === 0);
  if (ok(caret)) return { rect: { x: caret.x, y: caret.y, width: Math.max(1, caret.width || 1), height: caret.height }, source: 'caret' };
  if (element && element.width > 0 && element.height > 0 && ok({ ...element, height: Math.min(element.height, 399) })) {
    // Treat the element's bottom edge as the "line" so the box sits right under the field.
    return { rect: { x: element.x, y: element.y, width: 1, height: element.height }, source: 'element' };
  }
  const m = mouse || { x: 0, y: 0 };
  return { rect: { x: m.x, y: m.y, width: 1, height: 18 }, source: 'mouse' };
}

/**
 * Place the box below the anchor line; flip above when it would overflow the
 * work area bottom; clamp horizontally/vertically into the work area of the
 * monitor that contains the anchor.
 */
export function computeMiniBounds({ anchor, displays, width = MINI.width, height, gap = MINI.gap }) {
  const p = { x: anchor.x, y: anchor.y + anchor.height / 2 };
  const d = displayForPoint(displays, p);
  const wa = d ? d.workArea : { x: 0, y: 0, width: 1e5, height: 1e5 };
  const h = height ?? miniHeight(1);
  let x = Math.round(anchor.x);
  let y = Math.round(anchor.y + anchor.height + gap);
  let flipped = false;
  if (y + h > wa.y + wa.height) {
    const above = Math.round(anchor.y - gap - h);
    if (above >= wa.y) { y = above; flipped = true; }
    else y = wa.y + wa.height - h; // neither fits fully — pin to bottom edge
  }
  if (x + width > wa.x + wa.width) x = wa.x + wa.width - width;
  if (x < wa.x) x = wa.x;
  if (y < wa.y) y = wa.y;
  return { x, y, width, height: h, flipped, displayId: d ? d.id : null };
}

/** True when a mouse-down at point p (DIP) is outside the box → dismiss. */
export function isOutsideClick(bounds, p) {
  return !contains(bounds, p);
}

/**
 * Keyboard reducer for the open picker. Keys are normalized names:
 * 'Up','Down','Enter','Tab','Escape','1'..'6','PageUp','PageDown','Home','End'.
 * Returns { idx, action: 'none'|'fill'|'dismiss', pickIndex? }.
 */
export function reduceKey(state, key) {
  const n = state.count | 0;
  let idx = Math.min(Math.max(0, state.idx | 0), Math.max(0, n - 1));
  switch (key) {
    case 'Down': return { idx: n ? (idx + 1) % n : 0, action: 'none' };
    case 'Up': return { idx: n ? (idx - 1 + n) % n : 0, action: 'none' };
    case 'Home': return { idx: 0, action: 'none' };
    case 'End': return { idx: Math.max(0, n - 1), action: 'none' };
    case 'Escape': return { idx, action: 'dismiss' };
    case 'Enter':
    case 'Tab':
      return n ? { idx, action: 'fill', pickIndex: idx } : { idx, action: 'open-app' };
    default:
      if (/^[1-6]$/.test(key)) {
        const k = Number(key) - 1;
        if (k < n) return { idx: k, action: 'fill', pickIndex: k };
      }
      return { idx, action: 'none' };
  }
}

/** Keys the main process grabs globally while the box is open. */
export const PICKER_KEYS = ['Up', 'Down', 'Enter', 'Tab', 'Escape', '1', '2', '3', '4', '5', '6'];

/** BrowserWindow options for a non-activating, chrome-less always-on-top box. */
export function miniWindowOptions(bounds) {
  return {
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    frame: false,
    transparent: true,
    hasShadow: false, // CSS shadow inside the transparent window
    resizable: false, movable: false, maximizable: false, minimizable: false, fullscreenable: false,
    focusable: false, // WS_EX_NOACTIVATE on Windows — target app keeps focus & caret
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    thickFrame: false,
    roundedCorners: true,
    type: typeof process !== 'undefined' && process.platform === 'linux' ? 'toolbar' : undefined,
    backgroundColor: '#00000000',
  };
}

/** Letter avatar: first alnum char + stable hue from the title. */
export function avatarFor(title) {
  const s = String(title || '?');
  const ch = (s.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  let h = 0;
  for (const c of s) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return { letter: ch, hue: h % 360 };
}
