// Карта клавиатуры как лист звёздного атласа. Один компонент на все разделы:
// выбор клавиши, дуги переназначений, рисование цветом, тепловая карта, созвездия горячих клавиш.
// Геометрия — из XML производителя (store.server.keys), всё рисуется в SVG.
import { keys, short, fullName, actionText } from "../core/keydata.js";
import { reduceMotion } from "../core/dom.js";

const NS = "http://www.w3.org/2000/svg";
const PAD = { l: 46, r: 30, t: 42, b: 46 };
const mk = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  parent?.appendChild(e);
  return e;
};

// детерминированный «случайный» генератор, чтобы звёзды не прыгали между перерисовками
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export function createChart(host, opts = {}) {
  const ks = keys();
  const minX = Math.min(...ks.map((k) => k.x)), minY = Math.min(...ks.map((k) => k.y));
  const maxX = Math.max(...ks.map((k) => k.x + k.w)), maxY = Math.max(...ks.map((k) => k.y + k.h));
  const vb = { x: minX - PAD.l, y: minY - PAD.t, w: maxX - minX + PAD.l + PAD.r, h: maxY - minY + PAD.t + PAD.b };

  const wrap = document.createElement("div");
  wrap.className = "chart" + (opts.compact ? " compact" : "") + (opts.mode ? ` mode-${opts.mode}` : "");
  if (opts.persist !== false) wrap.style.viewTransitionName = "kb-chart";
  const svg = mk("svg", { viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`, role: "group", "aria-label": opts.label || "Карта клавиатуры" });
  wrap.appendChild(svg);

  // ---------- defs ----------
  const defs = mk("defs", {}, svg);
  const arrow = mk("marker", { id: "arw-" + uid(), viewBox: "0 0 8 8", refX: 6.5, refY: 4, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
  mk("path", { d: "M1 1.2 6.8 4 1 6.8", fill: "none", stroke: "var(--gold)", "stroke-width": 1.1, "stroke-linecap": "round", "stroke-linejoin": "round" }, arrow);

  // ---------- атлас: сетка, большие круги, звёзды, шкалы ----------
  const atlas = mk("g", { class: "atlas", "aria-hidden": "true" }, svg);
  const cx = minX + (maxX - minX) / 2, cy = minY + (maxY - minY) / 2;
  for (let x = Math.ceil(vb.x / 24) * 24; x < vb.x + vb.w; x += 24) mk("line", { x1: x, y1: vb.y + 14, x2: x, y2: vb.y + vb.h - 14, class: "grid" }, atlas);
  for (let y = Math.ceil(vb.y / 24) * 24; y < vb.y + vb.h; y += 24) mk("line", { x1: vb.x + 14, y1: y, x2: vb.x + vb.w - 14, y2: y, class: "grid" }, atlas);
  mk("circle", { cx, cy: cy + vb.h * 1.15, r: vb.h * 1.55, class: "circle" }, atlas);
  mk("circle", { cx: cx - vb.w * .18, cy: cy - vb.h * 1.5, r: vb.h * 1.9, class: "circle" }, atlas);
  mk("ellipse", { cx, cy, rx: vb.w * .47, ry: vb.h * .43, class: "circle faint" }, atlas);
  const rand = rng(7);
  for (let i = 0; i < 70; i++) {
    const x = vb.x + rand() * vb.w, y = vb.y + rand() * vb.h, big = rand() > .92;
    mk("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: big ? 1.1 : .55 + rand() * .35, class: big ? "star bright" : "star" }, atlas);
  }
  // рамка листа: двойная линия и засечки
  const fr = { x: vb.x + 8, y: vb.y + 8, w: vb.w - 16, h: vb.h - 16 };
  mk("rect", { ...fr, width: fr.w, height: fr.h, class: "frame" }, atlas);
  mk("rect", { x: fr.x + 3.5, y: fr.y + 3.5, width: fr.w - 7, height: fr.h - 7, class: "frame inner" }, atlas);
  for (const [x, y] of [[fr.x, fr.y], [fr.x + fr.w, fr.y], [fr.x, fr.y + fr.h], [fr.x + fr.w, fr.y + fr.h]]) {
    mk("path", { d: `M${x - 5} ${y}h10M${x} ${y - 5}v10`, class: "tick" }, atlas);
  }
  // шкалы координат: низ 10…100, лево по рядам
  const sx = mk("g", { class: "scale" }, atlas);
  for (let i = 0; i <= 20; i++) {
    const x = minX + (maxX - minX) * i / 20;
    mk("line", { x1: x, y1: maxY + 14, x2: x, y2: maxY + (i % 2 ? 17 : 20), class: "tick" }, sx);
    if (i % 4 === 0 && i) { const t = mk("text", { x, y: maxY + 30, class: "scale-label" }, sx); t.textContent = i * 5; }
  }
  for (let r = 0; r < 6; r++) {
    const row = ks.filter((k) => k.row === r); if (!row.length) continue;
    const y = row[0].y + row[0].h / 2;
    mk("line", { x1: minX - 18, y1: y, x2: minX - 13, y2: y, class: "tick" }, sx);
    const t = mk("text", { x: minX - 22, y: y + 3, class: "scale-label end" }, sx); t.textContent = ["F", "1", "2", "3", "4", "5"][r];
  }
  const annot = mk("text", { x: fr.x + 12, y: fr.y + 18, class: "plate-label" }, atlas);
  const annotR = mk("text", { x: fr.x + fr.w - 12, y: fr.y + 18, class: "plate-label end" }, atlas);

  // ---------- клавиши ----------
  const gKeys = mk("g", { class: "keys" }, svg);
  const gArcs = mk("g", { class: "arcs", "aria-hidden": "true" }, svg);
  const gOver = mk("g", { class: "over", "aria-hidden": "true" }, svg);
  const nodes = new Map(); // key_index → {g, cap, top, lg, sub, star}
  for (const k of ks) {
    const g = mk("g", { class: "key", "data-i": k.key_index, role: opts.interactive === false ? null : "button", tabindex: -1, "aria-label": fullName(k) }, gKeys);
    mk("rect", { x: k.x + .6, y: k.y + 2.2, width: k.w - 1.2, height: k.h - 1.2, rx: 4, class: "skirt" }, g);
    const cap = mk("g", { class: "cap" }, g);
    const top = mk("rect", { x: k.x + .6, y: k.y + .6, width: k.w - 1.2, height: k.h - 2.4, rx: 4, class: "top" }, cap);
    const lg = mk("text", { x: k.x + k.w / 2, y: k.y + k.h / 2 + (k.h > 30 ? 0 : -.5), class: "lg" + (short(k.name).length > 4 ? " long" : "") }, cap);
    lg.textContent = short(k.name);
    const sub = mk("text", { x: k.x + k.w / 2, y: k.y + k.h - 5.2, class: "sub" }, cap);
    const star = mk("circle", { cx: k.x + k.w / 2, cy: k.y + 5.5, r: .9, class: "kstar" }, cap);
    nodes.set(k.key_index, { k, g, cap, top, lg, sub, star });
  }
  const firstKey = ks.reduce((a, b) => (a.y + a.x < b.y + b.x ? a : b));
  nodes.get(firstKey.key_index).g.setAttribute("tabindex", 0);

  // ---------- взаимодействие ----------
  let selected = null, painting = false;
  const keyOf = (target) => { const g = target.closest?.(".key"); return g ? nodes.get(+g.dataset.i) : null; };
  if (opts.interactive !== false) {
    svg.addEventListener("pointerdown", (e) => {
      const n = keyOf(e.target); if (!n) return;
      e.preventDefault(); n.g.focus({ preventScroll: true });
      if (opts.onPaint) { painting = true; opts.onPaint(n.k, e); }
      else opts.onSelect?.(n.k, e);
      tap(n.k.key_index);
    });
    svg.addEventListener("pointerover", (e) => {
      const n = keyOf(e.target); if (!n) return;
      if (painting && e.buttons) opts.onPaint?.(n.k, e);
      opts.onHover?.(n.k);
    });
    svg.addEventListener("pointerleave", () => opts.onHover?.(null));
    window.addEventListener("pointerup", stopPaint);
    svg.addEventListener("keydown", (e) => {
      const n = keyOf(e.target); if (!n) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (opts.onPaint || opts.onSelect)?.(n.k, e); tap(n.k.key_index); return; }
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!dir) return;
      e.preventDefault();
      const next = neighbour(n.k, dir);
      if (next) { focusKey(next.key_index); opts.onFocusMove?.(next); }
    });
  }
  function stopPaint() { painting = false; }

  function neighbour(k, [dx, dy]) {
    const c = { x: k.x + k.w / 2, y: k.y + k.h / 2 };
    let best = null, bestScore = Infinity;
    for (const o of ks) {
      if (o === k) continue;
      const ox = o.x + o.w / 2 - c.x, oy = o.y + o.h / 2 - c.y;
      const along = ox * dx + oy * dy; if (along <= 2) continue;
      const across = Math.abs(ox * dy - oy * dx);
      const score = along + across * 2.4;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    return best;
  }
  function focusKey(i) {
    for (const n of nodes.values()) n.g.setAttribute("tabindex", -1);
    const n = nodes.get(i); if (!n) return;
    n.g.setAttribute("tabindex", 0); n.g.focus({ preventScroll: true });
  }

  // ---------- нажатие: экспоненциальное следование (вниз 25 мс, вверх 70 мс) ----------
  const press = new Map(); let frame = 0, last = 0;
  function hold(i, seconds = Infinity) { const s = press.get(i) || { at: 0, held: 0 }; s.held = seconds; press.set(i, s); run(); }
  function release(i) { const s = press.get(i); if (s) { s.held = 0; run(); } }
  function tap(i) { hold(i, .09); }
  function run() { if (!frame) { last = 0; frame = requestAnimationFrame(tick); } }
  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60; last = now;
    let busy = false;
    for (const [i, s] of press) {
      const n = nodes.get(i); if (!n) { press.delete(i); continue; }
      s.held = Math.max(0, s.held - dt);
      const want = s.held > 0 ? 1 : 0;
      s.at = reduceMotion() ? want : s.at + (want - s.at) * (1 - Math.exp(-dt / (want ? .025 : .07)));
      if (Math.abs(want - s.at) < .01) s.at = want;
      n.cap.setAttribute("transform", s.at ? `translate(0 ${(1.6 * s.at).toFixed(2)})` : "");
      n.g.toggleAttribute("data-down", s.at > .6);
      busy ||= s.at !== want || (s.held > 0 && s.held < Infinity);
      if (!s.held && !s.at) press.delete(i);
    }
    frame = busy ? requestAnimationFrame(tick) : 0;
  }

  // ---------- состояние ----------
  const ringEl = mk("rect", { class: "ring", rx: 6 }, gOver);
  ringEl.style.display = "none";

  function update(st = {}) {
    if ("annot" in st) annot.textContent = st.annot || "";
    if ("annotRight" in st) annotR.textContent = st.annotRight || "";
    if ("selected" in st) {
      selected = st.selected;
      const n = selected != null && nodes.get(selected);
      for (const m of nodes.values()) { m.g.toggleAttribute("data-selected", m === n); if (m !== n) m.g.removeAttribute("aria-pressed"); }
      if (n) {
        const k = n.k;
        Object.assign(ringEl.style, { display: "" });
        ringEl.setAttribute("x", k.x - 3); ringEl.setAttribute("y", k.y - 3);
        ringEl.setAttribute("width", k.w + 6); ringEl.setAttribute("height", k.h + 6);
        n.g.setAttribute("aria-pressed", "true");
      } else ringEl.style.display = "none";
    }
    if ("subs" in st) for (const n of nodes.values()) {
      const t = st.subs?.get(n.k.key_index) || "";
      const max = Math.max(2, Math.floor((n.k.w - 3) / 3.6));
      n.sub.textContent = t.length > max ? t.slice(0, max - 1) + "…" : t;
      n.g.toggleAttribute("data-mapped", !!t);
    }
    if ("states" in st) for (const n of nodes.values()) {
      const s = st.states?.get(n.k.key_index);
      n.g.toggleAttribute("data-disabled", s === "disabled");
      n.g.toggleAttribute("data-held", s === "held");
      n.g.toggleAttribute("data-muted", s === "muted");
    }
    if ("fills" in st) for (const n of nodes.values()) {
      const c = st.fills?.get(n.k.light_index);
      if (c) {
        n.top.style.fill = `rgb(${c[0]} ${c[1]} ${c[2]} / ${st.fillAlpha ?? .78})`;
        n.g.toggleAttribute("data-lightfill", lum(c) > .55);
        n.g.setAttribute("data-filled", "");
      } else { n.top.style.fill = ""; n.g.removeAttribute("data-filled"); n.g.removeAttribute("data-lightfill"); }
    }
    if ("arcs" in st) drawArcs(st.arcs || []);
    if ("constellation" in st) drawConstellation(st.constellation || []);
  }

  function center(k) { return { x: k.x + k.w / 2, y: k.y + k.h / 2 }; }
  function drawArcs(list) {
    gArcs.replaceChildren();
    for (const a of list) {
      const from = nodes.get(a.from)?.k, to = a.to != null ? nodes.get(a.to)?.k : null;
      if (!from) continue;
      const p = center(from);
      if (to) {
        const q = center(to), dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
        const bulge = Math.min(46, 10 + d * .22);
        const mx = (p.x + q.x) / 2 - dy / d * bulge * Math.sign(dx || 1), my = (p.y + q.y) / 2 - Math.abs(dx / d) * bulge - 4;
        const path = mk("path", { d: `M${p.x} ${p.y - 4}Q${mx} ${my} ${q.x} ${q.y - 4}`, class: "arc", "marker-end": `url(#${arrow.id})` }, gArcs);
        mk("circle", { cx: p.x, cy: p.y - 4, r: 1.6, class: "arc-dot" }, gArcs);
        drawIn(path);
      }
    }
  }
  function drawConstellation(groups) {
    gOver.querySelectorAll(".con").forEach((e) => e.remove());
    for (const grp of groups) {
      const pts = grp.keys.map((i) => nodes.get(i)?.k).filter(Boolean).map(center).sort((a, b) => a.x - b.x);
      for (let i = 1; i < pts.length; i++) {
        const l = mk("line", { x1: pts[i - 1].x, y1: pts[i - 1].y, x2: pts[i].x, y2: pts[i].y, class: "con" }, gOver);
        l.style.stroke = grp.color;
      }
    }
  }
  function drawIn(path) {
    if (reduceMotion()) return;
    const L = path.getTotalLength();
    path.style.strokeDasharray = `${L}`; path.style.strokeDashoffset = `${L}`;
    path.getBoundingClientRect();
    path.style.transition = "stroke-dashoffset 520ms cubic-bezier(.16,1,.3,1)";
    requestAnimationFrame(() => { path.style.strokeDashoffset = "0"; });
    path.addEventListener("transitionend", () => { path.style.strokeDasharray = ""; path.style.transition = ""; }, { once: true });
  }

  function keyRect(i) { const n = nodes.get(i); return n ? n.g.getBoundingClientRect() : null; }

  host.replaceChildren(wrap);
  return {
    el: wrap, svg, update, hold, release, tap, focusKey, keyRect,
    destroy() { window.removeEventListener("pointerup", stopPaint); cancelAnimationFrame(frame); wrap.remove(); },
  };
}

let _uid = 0;
const uid = () => (++_uid).toString(36);

// Подписи переназначений для карты из слоя раскладки
export function remapView(layer) {
  const subs = new Map(), arcs = [];
  for (const [idx, a] of Object.entries(layer || {})) {
    if (!a || a.type === "default") continue;
    subs.set(+idx, actionText(a));
    if (a.type === "key" && !a.mods) {
      const to = keys().find((k) => k.hid === a.hid && k.name !== "Fn");
      if (to && to.key_index !== +idx) arcs.push({ from: +idx, to: to.key_index });
    }
  }
  return { subs, arcs };
}
