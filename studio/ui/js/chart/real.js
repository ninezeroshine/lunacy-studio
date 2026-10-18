// Клавиатура «как в жизни»: Lunacy In Space 98 в продуктовом ракурсе на листе атласа.
// Камера и тела — из набора anatomy (vendor/anatomy/iso-kit.js): ортографическая проекция спереди-сверху,
// корпус и детали — его slabOf с четырьмя тонами по направлению граней. Колпачки — усечённые пирамиды на той же
// камере: верхушка меньше основания, видны верх, передняя и боковые грани, как у настоящих OEM-колпачков.
// Внешний интерфейс тот же, что у chart/keyboard.js: страницы меняют один импорт.
// Плоскость любой высоты z переводится в экран одной матрицей, поэтому подписи, дуги, созвездия и кольцо выбора
// рисуются в координатах раскладки (store.server.keys) и сами ложатся в перспективу.
import { iso, cameraOf, roundedPlan, slabOf, cylinder, knurl } from "../../vendor/anatomy/iso-kit.js";
import { keys, fullName } from "../core/keydata.js";
import { reduceMotion } from "../core/dom.js";

const NS = "http://www.w3.org/2000/svg";
const mk = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  parent?.appendChild(e);
  return e;
};

// ---------- камера ----------
// азимут 90°: ряды клавиш горизонтальны, к зрителю обращены грани с нормалью +y (передние); подъём 58°
const CAM = { azimuth: 90, elevation: 58, scale: 1 / Math.sqrt(1.6), origin: [0, 0] };
const { sinE, cosE } = cameraOf(CAM);
const P = (x, y, z) => iso([x, y, z], CAM);
const plane = (z) => `matrix(1 0 0 ${sinE.toFixed(5)} 0 ${(-z * cosE).toFixed(3)})`;
const VIEW = [0, cosE, sinE];                        // к зрителю
const LIGHT = norm([-0.5, 0.45, 0.75]);              // свет сверху-слева-спереди

const PLATE = 14;      // высота корпуса: на ней стоят колпачки
// В фирменном XML прямоугольник клавиши — зона подписи (26 при шаге 38,4). Настоящий колпачок занимает почти весь шаг.
const GROW = 4.6;
const CAP = 11;        // высота колпачка
const TOP = PLATE + CAP;
const TRAVEL = 3.2;    // ход клавиши

// ---------- цвета настоящей клавиатуры (сняты с фирменного 98t_connected.png) ----------
const COL = {
  white: { top: "url(#cap-dish-w)", sides: ["#bdbcb6", "#cbcac4", "#d8d7d2", "#e6e5e0"], line: "rgba(20,20,24,.38)" },
  dark: { top: "url(#cap-dish-d)", sides: ["#1d1e21", "#232427", "#2a2b2f", "#313236"], line: "rgba(0,0,0,.55)" },
  case: { top: "#2e2f33", sides: ["#17181a", "#1c1d20", "#222326", "#28292c"] },
};
// Подписи — shine-through: полупрозрачный пластик. Без подсветки серые на белых колпачках и белые на тёмных,
// при подсветке светятся цветом подсветки (переменная --lgd на клавише), плюс мягкий ореол и свет из-под колпачка.
const INK_WHITE = [141, 141, 137], INK_DARK = [230, 230, 226];

// тёмные колпачки — как на твоей клавиатуре
const DARK = new Set(["Esc", "F5", "F6", "F7", "F8", "Delete", "Home", "Backspace", "Tab", "|\\", "Caps Lock", "Enter", "Left Shift",
  "Right Shift", "Left Ctrl", "Left Win", "Left Alt", "Space", "Right Alt", "Fn", "Right Ctrl", "↑", "←", "↓", "→", "-", "+"]);
const RU = { Q: "й", W: "ц", E: "у", R: "к", T: "е", Y: "н", U: "г", I: "ш", O: "щ", P: "з", "{[": "х", "}}": "ъ", A: "ф", S: "ы",
  D: "в", F: "а", G: "п", H: "р", J: "о", K: "л", L: "д", ":;": "ж", "\"'": "э", Z: "я", X: "ч", C: "с", V: "м", B: "и", N: "т",
  M: "ь", ",<": "б", ".>": "ю", "/?": "." };
const PAIR = { "~`": ["`", "~"], "!1": ["1", "!"], "@2": ["2", "@"], "#3": ["3", "#"], "$4": ["4", "$"], "%5": ["5", "%"], "^6": ["6", "^"],
  "&7": ["7", "&"], "*8": ["8", "*"], "(9": ["9", "("], ")0": ["0", ")"], "_-": ["-", "_"], "+=": ["=", "+"], "{[": ["[", "{"],
  "}}": ["]", "}"], ":;": [";", ":"], "\"'": ["'", "\""], ",<": [",", "<"], ".>": [".", ">"], "/?": ["/", "?"] };
const WORDS = { "Caps Lock": "CAPS", "Left Shift": "SHIFT", "Right Shift": "SHIFT", "Left Ctrl": "CTR", "Right Ctrl": "CTR", "Left Win": "WIN",
  "Left Alt": "ALT", "Right Alt": "ALT", Fn: "FN", Backspace: "BACK TO SPACE", "|\\": "\\ | /" };
const NUMPAD_ALT = { "8": "▲", "4": "◀", "6": "▶", "2": "▼", "0": "Ins", ".": "Del" };

// Ракета у стрелок: контуры сняты по сетке с фотографии клавиатуры и переведены в координаты
// раскладки (x = (px + 1.8) / 1.263, y = (py − 12.2) / 1.246; проверено по стрелке вверх с точностью до десятых).
const ROCKET_BODY = "M591.3 131.8C586.5 134.7 580.5 144.3 578.6 157.1C577 168.4 575.5 182.8 574.7 194.1L574.2 200.8"
  + "M591.3 131.8C596 135.3 601.1 144.3 603 157.1C604.9 170 606.8 186 608.1 198.9L608.7 201.8";
const ROCKET_FINS = "M570.4 211.7C568.3 223 564.4 231.8 554.6 240.3M571 221.3C569.1 229.4 565.2 235 560.4 239.3"
  + "M611.1 211.7C613.5 223 617.4 231.8 627.7 240.3M610.6 221.3C612.7 229.4 616.6 235 621.4 239.3";
const ROCKET_BASE = "M531.9 262.3C529.2 267.9 527.9 273.5 527.6 279.1L527.6 287.6C527.6 288.5 528.3 289.2 529.2 289.2L570.4 289.2"
  + "M650.7 262.3C653.4 267.9 654.6 273.5 654.9 279.1L654.9 287.6C654.9 288.5 654.3 289.2 653.4 289.2L611.9 289.2"
  + "M527.6 285.6H570.4M611.9 285.6H654.9M570.4 282.3V291H588.9V282.3M592.9 282.3V291H611.9V282.3";

// ---------- геометрия ----------
function norm(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const path = (pts, close = true) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join("") + (close ? "Z" : "");
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const side = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length > 1 && side(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (hi.length > 1 && side(hi.at(-2), hi.at(-1), q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

// Колпачок: основание plan на высоте z0, верх — вписанный план на z0+h. Возвращает пути силуэта, граней по тонам и верха.
function capSolid(base, topPlan, z0, h) {
  const B = roundedPlan(base, 4), T = roundedPlan(topPlan, 4), n = B.length;
  const cx = base.x + base.w / 2, cy = base.y + base.d / 2;
  const buckets = [[], [], [], []];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const b0 = [...B[i], z0], b1 = [...B[j], z0], t0 = [...T[i], z0 + h];
    let nv = norm(cross([b1[0] - b0[0], b1[1] - b0[1], 0], [t0[0] - b0[0], t0[1] - b0[1], h]));
    const mid = [(B[i][0] + B[j][0]) / 2 - cx, (B[i][1] + B[j][1]) / 2 - cy];
    if (nv[0] * mid[0] + nv[1] * mid[1] < 0) nv = nv.map((v) => -v);
    if (dot(nv, VIEW) <= 1e-4) continue;
    const lit = (dot(nv, LIGHT) + 1) / 2, s = Math.max(0, Math.min(3, Math.floor(lit * 4)));
    buckets[s].push(path([P(...B[i], z0), P(...B[j], z0), P(...T[j], z0 + h), P(...T[i], z0 + h)]));
  }
  const all = [...B.map(([x, y]) => P(x, y, z0)), ...T.map(([x, y]) => P(x, y, z0 + h))];
  return { silhouette: path(hull(all)), shades: buckets.map((b) => b.join("")), top: path(T.map(([x, y]) => P(x, y, z0 + h))) };
}

function slab(parent, plan, z, h, col, bevel = 0, cls = "") {
  const s = slabOf(plan, z, h, CAM, 8, bevel);
  const g = mk("g", { class: cls }, parent);
  mk("path", { d: s.fill, fill: col.sides[0] }, g);
  s.shades.forEach((d, i) => d && mk("path", { d, fill: col.sides[i] }, g));
  mk("path", { d: s.top, fill: col.top }, g);
  if (s.bevel) mk("path", { d: s.bevel, class: "bevel" }, g);
  mk("path", { d: s.outline, class: "edge" }, g);
  return g;
}

// ---------- значки на колпачках (в плоскости верха, единицы раскладки, центр в 0,0) ----------
const ICON = {
  moon: '<path d="M1.2 -4.6A4.8 4.8 0 1 0 1.2 4.6A3.7 3.7 0 1 1 1.2 -4.6Z" class="ico-fill"/>',
  ring: (r) => `<circle r="${r}" class="ico-line"/>`,
  saturn: '<circle r="3" class="ico-line"/><ellipse rx="6" ry="1.6" transform="rotate(-18)" class="ico-line"/>',
  chevrons: '<path d="M-3 -3.2L0 -0.6L3 -3.2M-3 0.6L0 3.2L3 0.6" class="ico-line"/>',
  pause: '<path d="M-1.6 -3.4V3.4M1.6 -3.4V3.4" class="ico-line"/>',
  toggle: '<rect x="-7" y="-4" width="14" height="3" rx="1.5" class="ico-line"/><rect x="-7" y="1" width="14" height="3" rx="1.5" class="ico-line"/><circle cx="3.6" cy="-2.5" r="1.4" class="ico-fill"/><circle cx="-3.6" cy="2.5" r="1.4" class="ico-fill"/>',
  // силуэт ракеты с фирменной картинки (по строкам пикселей): острый нос, узкий корпус, крылья до плоского низа
  rocket: '<path d="M0 -6.8C1.1 -6.6 1.6 -6 1.6 -5.2V-2.8L2.2 0.4C3.7 1.5 5.2 3 5.55 4.4V6.8H-5.55V4.4C-5.2 3 -3.7 1.5 -2.2 0.4L-1.6 -2.8V-5.2C-1.6 -6 -1.1 -6.6 0 -6.8Z" class="ico-fill"/>',
  sparkle: '<path d="M0 -2.4L0.55 -0.55L2 0L0.55 0.55L0 2.4L-0.55 0.55L-2 0L-0.55 -0.55Z" class="ico-fill"/>',
  halfmoon: '<path d="M0 -3.8A3.8 3.8 0 0 1 0 3.8Z" class="ico-fill"/>',
  up: '<path d="M-3 1.6L0 -1.6L3 1.6" class="ico-line"/>', down: '<path d="M-3 -1.6L0 1.6L3 -1.6" class="ico-line"/>',
  left: '<path d="M1.6 -3L-1.6 0L1.6 3" class="ico-line"/>', right: '<path d="M-1.6 -3L1.6 0L-1.6 3" class="ico-line"/>',
};

function legendSvg(k) {
  const n = k.name, dark = DARK.has(n), cx = k.x + k.w / 2, cy = k.y + k.h / 2 - 1.8;
  const at = (s, dx = 0, dy = 0) => `<g transform="translate(${(cx + dx).toFixed(1)} ${(cy + dy).toFixed(1)}) scale(1.45)">${s}</g>`;
  const abs = (s, x, y) => `<g transform="translate(${x} ${y})">${s}</g>`;   // в координатах раскладки, без масштаба
  const word = (t, dx = 0, dy = 0, size = 6.4) => `<text x="${(cx + dx).toFixed(1)}" y="${(cy + dy).toFixed(1)}" class="lw" style="font-size:${size}px">${t}</text>`;
  if (n === "Esc") return at(ICON.moon);
  if (n === "F5") return at(ICON.ring(3.6));
  if (n === "F6") return at(ICON.saturn);
  if (n === "F7") return at(ICON.ring(3));
  if (n === "F8") return at(ICON.ring(1.8));
  if (n === "Delete") return at(ICON.chevrons);
  if (n === "Home") return at(ICON.pause);
  if (n === "Tab") return at(ICON.toggle);
  // ракеты на Caps и цифровом «+» стоят на одной высоте, как на фото; рельсы под ними — в decal ниже
  if (n === "Caps Lock") return abs(ICON.rocket, 48.5, 174.4) + word("CAPS", 8, 0.4);
  // полумесяц: круг r 8,8, срезанный правым краем колпачка
  if (n === "Enter" && k.hid === 0x28) { const r = k.x + k.w + 0.4, c = r - 4, y = cy + 3.4;
    return word("ENTER", -3.5, 1) + `<path d="M${r} ${(y - 8.8).toFixed(1)}H${c}A8.8 8.8 0 0 0 ${c} ${(y + 8.8).toFixed(1)}H${r}Z" class="ico-fill"/>`; }
  if (n === "Enter") return "";
  if (n === "+") return abs(ICON.sparkle, cx, 134.7) + abs(ICON.rocket, cx, 174.4);
  if (n === "-") return `<path d="M${cx - 5} ${cy}H${cx + 5}" class="ico-line"/>`;
  if (n === "Space") return `<rect x="${cx - 62}" y="${cy - 4.6}" width="25" height="9.2" rx="1.6" class="badge"/><text x="${cx - 49.5}" y="${cy + 0.2}" class="badge-t">LUNACY</text>` + word("IN SPACE", -12, 0.4, 5.8);
  // «BACK TO SPACE» в белой рамке, снизу — залитый клин-стрелка влево, как на фото
  if (n === "Backspace") return `<rect x="${k.x + 2}" y="${k.y + 0.5}" width="${k.w - 2.3}" height="${k.h - 1.9}" rx="3.4" class="ico-line"/>`
    + `<path d="M${k.x + 14.6} ${k.y + 24.8}L${k.x + 33.2} ${k.y + 19.8}V${k.y + 25.8}Z" class="ico-fill"/>` + word("BACK TO SPACE", 1.6, 1.4, 5.8);
  if (["↑", "↓", "←", "→"].includes(n)) return at(ICON[{ "↑": "up", "↓": "down", "←": "left", "→": "right" }[n]]);
  if (WORDS[n]) return word(WORDS[n]);
  // белые: латиница крупно, кириллица/второй знак мельче справа; цвет — по месту на клавиатуре
  const numpad = k.hid >= 0x53 && k.hid <= 0x63;
  let main = n, alt = "";
  if (PAIR[n]) [main, alt] = PAIR[n];
  if (PAIR[n] && RU[n]) return `<text x="${cx - 1.6}" y="${cy + 0.4}" class="kl" style="font-size:8.6px">${esc(main + alt)}<tspan class="alt" dx="2.2" style="font-size:7.6px">${esc(RU[n])}</tspan></text>`;
  if (RU[n]) alt = RU[n];
  if (numpad) { main = { Num: "Num", "//": "/", "*": "*", ".": "." }[n] ?? n; alt = NUMPAD_ALT[main] || ""; }
  if (/^F\d+$/.test(n)) return `<text x="${cx}" y="${cy + 0.4}" class="kl" style="font-size:7.6px">${n}</text>`;
  const big = main.length === 1 ? 11.5 : 7.2;
  if (!alt) return `<text x="${cx}" y="${cy + 0.4}" class="kl" style="font-size:${big}px">${esc(main)}</text>`;
  const small = alt.length > 1 || (numpad && /[▲◀▶▼]/.test(alt)) ? 5.2 : 7.6;   // стрелки цифрового блока на фото мелкие
  return `<text x="${cx - (alt.length > 1 ? 3.6 : 1.6)}" y="${cy + 0.4}" class="kl" style="font-size:${big}px">${esc(main)}<tspan class="alt" dx="2" style="font-size:${small}px">${esc(alt)}</tspan></text>`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- компонент ----------
export function createChart(host, opts = {}) {
  const ks = keys();
  const CASE = { x: 14, y: 17, w: 772, d: 277, r: 15 };
  const floor = { x: CASE.x - 40, y: CASE.y - 26, w: CASE.w + 80, d: CASE.d + 56 };
  const corners = [[floor.x, floor.y], [floor.x + floor.w, floor.y], [floor.x, floor.y + floor.d], [floor.x + floor.w, floor.y + floor.d]]
    .flatMap(([x, y]) => [P(x, y, 0), P(x, y, TOP + 6)]);
  const minX = Math.min(...corners.map((p) => p[0])), maxX = Math.max(...corners.map((p) => p[0]));
  const minY = Math.min(...corners.map((p) => p[1])), maxY = Math.max(...corners.map((p) => p[1]));
  const vb = { x: minX, y: minY - 4, w: maxX - minX, h: maxY - minY + 4 };

  const wrap = document.createElement("div");
  wrap.className = "chart real" + (opts.compact ? " compact" : "") + (opts.mode ? ` mode-${opts.mode}` : "");
  if (opts.persist !== false) wrap.style.viewTransitionName = "kb-chart";
  const svg = mk("svg", { viewBox: `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`, role: "group", "aria-label": opts.label || "Клавиатура" });
  wrap.appendChild(svg);

  const uid = Math.random().toString(36).slice(2, 7);
  const defs = mk("defs", {}, svg);
  defs.innerHTML = `
    <linearGradient id="cap-dish-w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbfaf7"/><stop offset=".55" stop-color="#f1f0eb"/><stop offset="1" stop-color="#e5e4de"/></linearGradient>
    <linearGradient id="cap-dish-d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4b50"/><stop offset=".55" stop-color="#3f4044"/><stop offset="1" stop-color="#36373b"/></linearGradient>
    <filter id="soft-${uid}" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="9"/></filter>
    <filter id="glow-${uid}" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter>
    <filter id="halo-${uid}" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="1.3"/></filter>
    <marker id="arw-${uid}" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M1 1.2 6.8 4 1 6.8" fill="none" stroke="var(--gold)" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></marker>`;

  // ---------- лист атласа под клавиатурой: сетка и звёзды на полу (z = 0) ----------
  const atlas = mk("g", { class: "atlas", "aria-hidden": "true", transform: plane(0) }, svg);
  for (let x = Math.ceil(floor.x / 24) * 24; x <= floor.x + floor.w; x += 24) mk("line", { x1: x, y1: floor.y, x2: x, y2: floor.y + floor.d, class: "grid" }, atlas);
  for (let y = Math.ceil(floor.y / 24) * 24; y <= floor.y + floor.d; y += 24) mk("line", { x1: floor.x, y1: y, x2: floor.x + floor.w, y2: y, class: "grid" }, atlas);
  let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 46; i++) {
    const x = floor.x + rnd() * floor.w, y = floor.y + rnd() * floor.d;
    if (x > CASE.x - 6 && x < CASE.x + CASE.w + 6 && y > CASE.y - 6 && y < CASE.y + CASE.d + 6) continue;
    mk("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: rnd() > .9 ? 1.1 : .6, class: rnd() > .9 ? "star bright" : "star" }, atlas);
  }
  const annot = mk("text", { x: vb.x + 10, y: vb.y + 12, class: "plate-label" }, svg);
  const annotR = mk("text", { x: vb.x + vb.w - 10, y: vb.y + 12, class: "plate-label end" }, svg);

  // ---------- корпус ----------
  const body = mk("g", { class: "body", "aria-hidden": "true" }, svg);
  // мягкая тень под корпусом на листе
  mk("path", { d: path(roundedPlan({ x: CASE.x + 6, y: CASE.y + 20, w: CASE.w - 12, d: CASE.d - 6, r: 18 }, 6).map(([x, y]) => P(x, y + 8, 0))),
    class: "shadow", filter: `url(#soft-${uid})` }, body);
  // колесо громкости: рифлёный диск с вертикальной осью, наполовину утоплен в левый бок (как на фирменной картинке)
  const wheel = mk("g", { class: "wheel" }, body);
  const W = cylinder(CASE.x + 7, 130.5, 17, 2.5, 9, CAM, 48, 0.6);
  mk("path", { d: W.fill, fill: "#1f2023" }, wheel);
  W.shades.forEach((d, i) => d && mk("path", { d, fill: ["#1c1d20", "#25262a", "#2f3034", "#3a3b40"][i] }, wheel));
  mk("path", { d: W.top, fill: "#36373b" }, wheel);
  mk("path", { d: knurl(CASE.x + 7, 130.5, 17, 2.5, 11.5, 56, CAM, 0.9), class: "knurl" }, wheel);
  if (W.bevel) mk("path", { d: W.bevel, class: "bevel" }, wheel);
  mk("path", { d: W.outline, class: "edge" }, wheel);
  slab(body, CASE, 0, PLATE, COL.case, 1.4, "case");
  const top = mk("g", { transform: plane(PLATE) }, body);
  // разметка на корпусе: блоки верхнего ряда, разделители, ракета вокруг стрелок
  for (const b of [[22, 25, 74], [100, 25, 160], [273, 25, 158], [444, 25, 159], [692, 25, 82]]) mk("rect", { x: b[0], y: b[1], width: b[2], height: 45, rx: 4, class: "seam" }, top);
  mk("path", { d: "M22 74H774M608.4 77V198M610.6 77V198", class: "seam" }, top);
  // ракета у стрелок, снятая с фирменной картинки 98t по сетке: на корпусе — крылья, опоры и основание с двумя соплами
  mk("path", { d: ROCKET_FINS + ROCKET_BASE, class: "rocket" }, top);
  // индикаторы у Esc и экран
  for (const y of [36, 48.6, 60.8]) mk("rect", { x: 76.6, y: y - 1.3, width: 14.3, height: 2.6, rx: 1.3, class: "led" }, top);
  slab(body, { x: 606, y: 28, w: 82, d: 40, r: 3 }, PLATE, 0.8, { top: "#0c0d0f", sides: ["#0a0a0b", "#0e0e10", "#131315", "#18181a"] }, 0, "screen");
  const scr = mk("g", { transform: plane(PLATE + 0.85) }, body);
  mk("rect", { x: 610, y: 32, width: 74, height: 32, rx: 1.5, class: "glass" }, scr);
  const scrText = mk("text", { x: 647, y: 48, class: "screen-mark" }, scr); scrText.textContent = "LUNACY";

  // ---------- слои ----------
  const gGlow = mk("g", { class: "glow", filter: `url(#glow-${uid})`, transform: plane(PLATE + 0.3), "aria-hidden": "true" }, svg);
  const gBase = mk("g", { class: "base-over", transform: plane(PLATE + 0.4), "aria-hidden": "true" }, svg);
  const gKeys = mk("g", { class: "keys" }, svg);
  const gHalo = mk("g", { class: "halo", filter: `url(#halo-${uid})`, transform: plane(TOP), "aria-hidden": "true" }, svg);
  const gArcs = mk("g", { class: "arcs", transform: plane(TOP + 5), "aria-hidden": "true" }, svg);
  const gOver = mk("g", { class: "over", transform: plane(TOP + 1), "aria-hidden": "true" }, svg);

  // ---------- клавиши: сзади вперёд ----------
  const nodes = new Map();
  const order = [...ks].sort((a, b) => (a.y + a.h) - (b.y + b.h) || a.x - b.x);
  for (const k of order) {
    const dark = DARK.has(k.name), col = dark ? COL.dark : COL.white;
    const base = { x: k.x - GROW, y: k.y - GROW, w: k.w + 2 * GROW, d: k.h + 2 * GROW, r: 3.4 };
    const tp = { x: base.x + 4.2, y: base.y + 2.6, w: base.w - 8.4, d: base.d - 8.6, r: 4.2 };
    const s = capSolid(base, tp, PLATE, CAP);
    const g = mk("g", { class: "key" + (dark ? " dark" : ""), "data-i": k.key_index, role: opts.interactive === false ? null : "button", tabindex: -1, "aria-label": fullName(k) }, gKeys);
    const cap = mk("g", { class: "cap" }, g);
    mk("path", { d: s.silhouette, fill: col.sides[0], class: "sil" }, cap);
    s.shades.forEach((d, i) => d && mk("path", { d, fill: col.sides[i] }, cap));
    const topEl = mk("path", { d: s.top, fill: col.top, class: "ctop" }, cap);
    mk("path", { d: s.silhouette, class: "outline", style: `stroke:${col.line}` }, cap);
    const face = mk("g", { transform: plane(TOP), class: "face" }, cap);
    const lg = mk("g", { class: "legend" }, face); lg.innerHTML = legendSvg(k);
    const sub = mk("text", { x: k.x + k.w / 2, y: k.y + k.h - 3.2, class: "sub" }, face);
    nodes.set(k.key_index, { k, g, cap, top: topEl, lg, sub, base, dark });
  }
  for (const n of nodes.values()) { n.halo = mk("g", { class: "halo-k", opacity: 0 }, gHalo); n.halo.innerHTML = legendSvg(n.k); }
  const firstKey = ks.reduce((a, b) => (a.y + a.x < b.y + b.x ? a : b));
  if (opts.interactive !== false) nodes.get(firstKey.key_index).g.setAttribute("tabindex", 0);
  else { wrap.classList.add("static"); for (const n of nodes.values()) n.g.removeAttribute("tabindex"); }

  // на колпачках — нос и корпус ракеты (\|/ и Enter) и двойные рельсы старта под ракетами на Caps и цифровом «+»
  const decal = mk("g", { transform: plane(TOP + 0.2), class: "decal", "aria-hidden": "true" }, svg);
  mk("path", { d: ROCKET_BODY, class: "rocket" }, decal);
  mk("path", { d: "M47.35 182.8V266M49.65 182.8V266M750.85 182.8V266M753.15 182.8V266", class: "rocket trail" }, decal);

  // ---------- взаимодействие (как в chart/keyboard.js) ----------
  let selected = null, painting = false;
  const keyOf = (target) => { const g = target.closest?.(".key"); return g ? nodes.get(+g.dataset.i) : null; };
  if (opts.interactive !== false) {
    svg.addEventListener("pointerdown", (e) => {
      const n = keyOf(e.target); if (!n) return;
      e.preventDefault(); focusKey(n.k.key_index); // щелчок переносит и место в порядке Tab
      if (opts.onPaint) { painting = true; opts.onPaint(n.k, e); } else opts.onSelect?.(n.k, e);
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
      const score = along + Math.abs(ox * dy - oy * dx) * 2.4;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    return best;
  }
  function focusKey(i) {
    for (const n of nodes.values()) n.g.setAttribute("tabindex", -1);
    const n = nodes.get(i); if (!n) return;
    n.g.setAttribute("tabindex", 0); n.g.focus({ preventScroll: true });
  }

  // ---------- нажатие: экспоненциальное следование, вниз 25 мс, вверх 70 мс (anatomy, references/motion.md) ----------
  const press = new Map(); let frame = 0, last = 0;
  const DY = TRAVEL * cosE;
  // окно потеряло фокус (Alt+Tab, Win): отпускания не будет — поднимаем всё, что «зажато» на схеме
  function releaseAll() { for (const s of press.values()) s.held = 0; run(); }
  window.addEventListener("blur", releaseAll);
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
      n.cap.setAttribute("transform", s.at ? `translate(0 ${(DY * s.at).toFixed(2)})` : "");
      n.halo?.setAttribute("transform", s.at ? `translate(0 ${(DY * s.at / sinE).toFixed(2)})` : ""); // ореол — в плоскости верха
      n.g.toggleAttribute("data-down", s.at > .6);
      busy ||= s.at !== want || (s.held > 0 && s.held < Infinity);
      if (!s.held && !s.at) press.delete(i);
    }
    frame = busy ? requestAnimationFrame(tick) : 0;
  }

  // ---------- состояние ----------
  const ringEl = mk("rect", { class: "ring", rx: 4 }, gBase);
  ringEl.style.display = "none";

  function update(st = {}) {
    if ("annot" in st) annot.textContent = st.annot || "";
    if ("annotRight" in st) annotR.textContent = st.annotRight || "";
    if ("selected" in st) {
      selected = st.selected;
      const n = selected != null && nodes.get(selected);
      for (const m of nodes.values()) { m.g.toggleAttribute("data-selected", m === n); if (m !== n) m.g.removeAttribute("aria-pressed"); }
      if (n) {
        const b = n.base;
        ringEl.style.display = "";
        ringEl.setAttribute("x", b.x - 2.2); ringEl.setAttribute("y", b.y - 2.2);
        ringEl.setAttribute("width", b.w + 4.4); ringEl.setAttribute("height", b.d + 4.4);
        n.g.setAttribute("aria-pressed", "true");
      } else ringEl.style.display = "none";
    }
    if ("subs" in st) for (const n of nodes.values()) {
      const t = st.subs?.get(n.k.key_index) || "";
      const max = Math.max(4, Math.floor((n.k.w + 2) / 3.6));
      n.sub.textContent = t.length > max ? t.slice(0, max - 1) + "…" : t;
      n.g.toggleAttribute("data-mapped", !!t);
      n.halo?.toggleAttribute("data-mapped", !!t);
    }
    if ("states" in st) for (const n of nodes.values()) {
      const s = st.states?.get(n.k.key_index);
      n.g.toggleAttribute("data-disabled", s === "disabled");
      n.g.toggleAttribute("data-held", s === "held");
      n.g.toggleAttribute("data-muted", s === "muted");
    }
    if ("fills" in st) {
      // как светит настоящая клавиатура: цвет проходит сквозь подписи (shine-through) и выбивается из-под колпачка
      const a = st.fillAlpha ?? .78;
      for (const n of nodes.values()) {
        const c = st.fills?.get(n.k.light_index), peak = c ? Math.max(c[0], c[1], c[2]) : 0;
        if (!n.glow) {
          const b = n.base;
          n.glow = mk("rect", { x: b.x - 2, y: b.y - 1.5, width: b.w + 4, height: b.d + 4, rx: 4.5, opacity: 0 }, gGlow);
        }
        if (peak > 6) {
          const k = Math.min(1, peak / 255 * 1.35) * a;                          // насколько ярко горит
          const hue = c.map((v) => Math.min(255, v * 255 / peak * .85 + 38));    // цвет света с белой серединкой
          const base = n.dark ? INK_DARK : INK_WHITE;
          const ink = base.map((v, i) => Math.round(v + (hue[i] - v) * Math.min(1, k * 1.15)));
          const col = `rgb(${c[0] | 0} ${c[1] | 0} ${c[2] | 0})`;
          n.glow.setAttribute("fill", col); n.glow.setAttribute("opacity", (a * Math.min(1, peak / 160)).toFixed(2));
          n.g.style.setProperty("--lgd", `rgb(${ink.join(" ")})`);
          n.halo.style.setProperty("--lgd", `rgb(${hue.map((v) => v | 0).join(" ")})`); n.halo.setAttribute("opacity", (k * .9).toFixed(2));
          n.g.setAttribute("data-filled", "");
        } else if (n.g.hasAttribute("data-filled")) {
          n.glow.setAttribute("opacity", 0); n.halo.setAttribute("opacity", 0);
          n.g.style.removeProperty("--lgd"); n.g.removeAttribute("data-filled");
        }
      }
    }
    if ("arcs" in st) drawArcs(st.arcs || []);
    if ("constellation" in st) drawConstellation(st.constellation || []);
  }

  const center = (k) => ({ x: k.x + k.w / 2, y: k.y + k.h / 2 });
  function drawArcs(list) {
    gArcs.replaceChildren();
    for (const a of list) {
      const from = nodes.get(a.from)?.k, to = a.to != null ? nodes.get(a.to)?.k : null;
      if (!from || !to) continue;
      const p = center(from), q = center(to), dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
      const bulge = Math.min(46, 10 + d * .22);
      const mx = (p.x + q.x) / 2 - dy / d * bulge * Math.sign(dx || 1), my = (p.y + q.y) / 2 - Math.abs(dx / d) * bulge - 4;
      const el = mk("path", { d: `M${p.x} ${p.y - 3}Q${mx} ${my} ${q.x} ${q.y - 3}`, class: "arc", "marker-end": `url(#arw-${uid})` }, gArcs);
      mk("circle", { cx: p.x, cy: p.y - 3, r: 1.8, class: "arc-dot" }, gArcs);
      drawIn(el);
    }
  }
  function drawConstellation(groups) {
    gOver.replaceChildren();
    for (const grp of groups) {
      const pts = grp.keys.map((i) => nodes.get(i)?.k).filter(Boolean).map(center).sort((a, b) => a.x - b.x);
      for (let i = 1; i < pts.length; i++) {
        const l = mk("line", { x1: pts[i - 1].x, y1: pts[i - 1].y, x2: pts[i].x, y2: pts[i].y, class: "con" }, gOver);
        l.style.stroke = grp.color;
      }
    }
  }
  function drawIn(el) {
    if (reduceMotion()) return;
    const L = el.getTotalLength();
    el.style.strokeDasharray = `${L}`; el.style.strokeDashoffset = `${L}`;
    el.getBoundingClientRect();
    el.style.transition = "stroke-dashoffset 520ms cubic-bezier(.16,1,.3,1)";
    requestAnimationFrame(() => { el.style.strokeDashoffset = "0"; });
    el.addEventListener("transitionend", () => { el.style.strokeDasharray = ""; el.style.transition = ""; }, { once: true });
  }

  function keyRect(i) { const n = nodes.get(i); return n ? n.g.getBoundingClientRect() : null; }

  host.replaceChildren(wrap);
  return {
    el: wrap, svg, update, hold, release, tap, focusKey, keyRect,
    destroy() { window.removeEventListener("pointerup", stopPaint); window.removeEventListener("blur", releaseAll); cancelAnimationFrame(frame); wrap.remove(); },
  };
}

// Подписи переназначений и дуги — та же функция, что у плоской карты
export { remapView } from "./keyboard.js";
