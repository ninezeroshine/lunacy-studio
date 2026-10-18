// Узоры для экранчика: зацикленные анимации 240×135, которые рисуются кодом. Каждый узор — функция фазы
// p ∈ [0, 1): кадр при p = 1 совпадает с кадром при p = 0, поэтому петля на клавиатуре идёт без рывка.
// Отдают тот же источник, что видео и GIF (screen-edit.js), поэтому к ним применяется весь редактор.

const W = 240, H = 135, TAU = Math.PI * 2;

export const PALETTES = [
  { id: "night", name: "Ночь", bg: "#05080f", a: "#e6ebf7", b: "#e0c48c", c: "#6f8fe6" },
  { id: "neon", name: "Неон", bg: "#07020f", a: "#ff3df2", b: "#3df2ff", c: "#f2ff3d" },
  { id: "ocean", name: "Океан", bg: "#021018", a: "#4fd1ff", b: "#2fffc0", c: "#1e6eff" },
  { id: "sunset", name: "Закат", bg: "#12060a", a: "#ff9a3d", b: "#ff3d6e", c: "#ffd23d" },
  { id: "aurora", name: "Сияние", bg: "#03100b", a: "#6bff9e", b: "#3dd6ff", c: "#b27bff" },
  { id: "mono", name: "Мел", bg: "#000000", a: "#ffffff", b: "#9aa3b5", c: "#5b6275" },
];

// Своя палитра из одного цвета: тёмный фон того же оттенка, сам цвет, светлее и дополнительный.
export function paletteFrom(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const hsl = (hh, s, l) => {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = l - c / 2;
    const [rr, gg, bb] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
    return "#" + [rr, gg, bb].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
  };
  return { id: "custom", name: "Свой", bg: hsl(h, 0.5, 0.04), a: hex, b: hsl((h + 30) % 360, 0.9, 0.75), c: hsl((h + 180) % 360, 0.8, 0.6) };
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Детерминированный генератор: один и тот же узор с теми же настройками всегда одинаков.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const dot = (g, x, y, r, col, a = 1) => { g.globalAlpha = a; g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.globalAlpha = 1; };

// ---------- узоры: draw(g, p, P, o, R) — o.density 0..1, R — заготовленные случайные числа ----------
export const PATTERNS = [
  { id: "stars", name: "Звёздный дрейф", d: "Звёзды плывут слоями, ближние быстрее",
    prep: (o, r) => Array.from({ length: Math.round(60 + o.density * 220) }, () => ({ x: r() * W, y: r() * H, z: 1 + ((r() * 3) | 0), ph: r() })),
    draw(g, p, P, o, S) {
      for (const s of S) {
        const x = (s.x - p * W * s.z + W * 3) % W, tw = 0.55 + 0.45 * Math.sin(TAU * (p * 2 + s.ph));
        dot(g, x, s.y, s.z === 3 ? 1.2 : s.z === 2 ? 0.8 : 0.55, s.z === 3 ? P.b : P.a, tw * (0.4 + s.z * 0.2));
      }
    } },
  { id: "matrix", name: "Цифровой дождь", d: "Колонки символов стекают вниз",
    prep: (o, r) => Array.from({ length: Math.ceil(W / 8) }, (_, i) => ({ x: i * 8 + 1, y0: r() * H, k: 1 + ((r() * 2) | 0), len: 6 + ((r() * (6 + o.density * 10)) | 0),
      ch: Array.from({ length: 40 }, () => String.fromCharCode(r() < 0.5 ? 0x30a0 + ((r() * 90) | 0) : 0x30 + ((r() * 10) | 0))) })),
    draw(g, p, P, o, S) {
      g.font = "8px monospace"; g.textBaseline = "top";
      const span = H + 140;
      for (const c of S) {
        const head = (c.y0 + p * span * c.k) % span - 20;
        for (let j = 0; j < c.len; j++) {
          const y = head - j * 9; if (y < -9 || y > H) continue;
          g.globalAlpha = j ? Math.max(0, 1 - j / c.len) * 0.85 : 1;
          g.fillStyle = j ? P.a : "#ffffff";
          g.fillText(c.ch[(j + ((y / 9) | 0) + 40) % 40], c.x, y);
        }
      }
      g.globalAlpha = 1;
    } },
  { id: "plasma", name: "Плазма", d: "Переливы цвета, как жидкий свет", pixel: true,
    draw(g, p, P, o) {
      const id = g.createImageData(W, H), d = id.data, t = TAU * p, k = 0.03 + o.density * 0.05;
      const A = rgb(P.a), B = rgb(P.b), C = rgb(P.c), Z = rgb(P.bg);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = Math.sin(x * k + t) + Math.sin(y * k * 1.3 - t) + Math.sin((x + y) * k * 0.7 + t) + Math.sin(Math.hypot(x - W / 2, y - H / 2) * k * 1.2 - t);
        const u = (v + 4) / 8, col = u < 0.33 ? mix(Z, A, u / 0.33) : u < 0.66 ? mix(A, B, (u - 0.33) / 0.33) : mix(B, C, (u - 0.66) / 0.34);
        const i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
      }
      g.putImageData(id, 0, 0);
    } },
  { id: "aurora", name: "Северное сияние", d: "Занавесы света колышутся над горизонтом", pixel: true,
    prep: (o, r) => Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H * 0.9, a: r() })),
    draw(g, p, P, o, S) {
      for (const s of S) dot(g, s.x, s.y, 0.5, P.a, 0.3 + s.a * 0.4);
      const id = g.getImageData(0, 0, W, H), d = id.data, t = TAU * p, A = rgb(P.a), B = rgb(P.b), C = rgb(P.c);
      for (let x = 0; x < W; x++) {
        const top = 18 + 16 * Math.sin(x * 0.03 + t) + 8 * Math.sin(x * 0.071 - 2 * t);
        const len = 40 + 25 * (0.5 + 0.5 * Math.sin(x * 0.05 - t)) * (0.6 + o.density * 0.8);
        const tint = 0.5 + 0.5 * Math.sin(x * 0.02 + t);
        for (let y = Math.max(0, top | 0); y < Math.min(H, top + len); y++) {
          const k = (y - top) / len, a = (k < 0.15 ? k / 0.15 : (1 - k)) * 0.75;
          const col = k < 0.5 ? mix(B, A, tint) : mix(A, C, (k - 0.5) * 2);
          const i = (y * W + x) * 4; for (let c = 0; c < 3; c++) d[i + c] = d[i + c] * (1 - a) + col[c] * a;
        }
      }
      g.putImageData(id, 0, 0);
      g.fillStyle = "#020306"; g.fillRect(0, H - 14, W, 14);
    } },
  { id: "rings", name: "Кольца", d: "Круги расходятся из центра",
    draw(g, p, P, o) {
      const n = 5 + Math.round(o.density * 7), R = Math.hypot(W, H) / 2, cols = [P.a, P.b, P.c];
      g.lineWidth = 2;
      for (let i = 0; i < n; i++) {
        const k = (i + p) / n; g.globalAlpha = Math.sin(Math.PI * k);
        g.strokeStyle = cols[i % 3]; g.beginPath(); g.arc(W / 2, H / 2, k * R, 0, TAU); g.stroke();
      }
      g.globalAlpha = 1;
    } },
  { id: "radar", name: "Радар", d: "Луч обходит круг и подсвечивает цели",
    prep: (o, r) => Array.from({ length: 4 + Math.round(o.density * 10) }, () => ({ a: r() * TAU, d: 0.25 + r() * 0.7 })),
    draw(g, p, P, o, S) {
      const cx = W / 2, cy = H / 2, R = 62, ang = TAU * p - Math.PI / 2;
      g.strokeStyle = P.c; g.globalAlpha = 0.45; g.lineWidth = 1;
      for (const k of [0.33, 0.66, 1]) { g.beginPath(); g.arc(cx, cy, R * k, 0, TAU); g.stroke(); }
      g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
      for (let i = 0; i < 24; i++) {
        g.globalAlpha = 0.35 * (1 - i / 24); g.fillStyle = P.a;
        g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, ang - (i + 1) * 0.045, ang - i * 0.045); g.fill();
      }
      for (const s of S) {
        const since = ((ang - s.a + Math.PI / 2) % TAU + TAU) % TAU;
        const a = Math.max(0, 1 - since / 3.5);
        if (a > 0) dot(g, cx + Math.cos(s.a - Math.PI / 2) * R * s.d, cy + Math.sin(s.a - Math.PI / 2) * R * s.d, 2.2, P.b, a);
      }
      g.globalAlpha = 1;
    } },
  { id: "snow", name: "Снегопад", d: "Хлопья падают и покачиваются",
    prep: (o, r) => Array.from({ length: Math.round(40 + o.density * 160) }, () => ({ x: r() * W, y: r() * H, k: 1 + ((r() * 2) | 0), s: 0.6 + r() * 1.4, ph: r() })),
    draw(g, p, P, o, S) {
      for (const f of S) dot(g, (f.x + 6 * Math.sin(TAU * (p + f.ph)) + W) % W, (f.y + p * H * f.k) % H, f.s, f.s > 1.4 ? P.b : P.a, 0.85);
    } },
  { id: "eq", name: "Эквалайзер", d: "Столбики прыгают под невидимую музыку",
    prep: (o, r) => Array.from({ length: 16 + Math.round(o.density * 16) }, () => ({ k: 1 + ((r() * 3) | 0), ph: r(), amp: 0.4 + r() * 0.6 })),
    draw(g, p, P, o, S) {
      const n = S.length, bw = W / n, A = rgb(P.a), C = rgb(P.c);
      S.forEach((b, i) => {
        const v = b.amp * (0.5 + 0.5 * Math.abs(Math.sin(TAU * (p * b.k + b.ph)))), hgt = v * (H - 20);
        const steps = Math.floor(hgt / 5);
        for (let s = 0; s < steps; s++) {
          const c = mix(A, C, s / 22).map((x) => x | 0); g.fillStyle = `rgb(${c})`;
          g.fillRect(i * bw + 1, H - 6 - s * 5, bw - 2, 4);
        }
        g.fillStyle = P.b; g.fillRect(i * bw + 1, H - 9 - steps * 5, bw - 2, 2);
      });
    } },
  { id: "moon", name: "Фазы луны", d: "Луна проходит все фазы — знак Lunacy",
    prep: (o, r) => Array.from({ length: Math.round(30 + o.density * 90) }, () => ({ x: r() * W, y: r() * H, a: r(), ph: r() })),
    draw(g, p, P, o, S) {
      for (const s of S) dot(g, s.x, s.y, 0.6, P.a, (0.3 + 0.5 * s.a) * (0.6 + 0.4 * Math.sin(TAU * (p * 2 + s.ph))));
      const cx = W / 2, cy = H / 2, R = 44;
      dot(g, cx, cy, R, "#1a1f2e");
      g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
      const ph = p * TAU, x = Math.cos(ph) * R;                            // терминатор — эллипс со сжатием cos(фазы)
      g.fillStyle = P.b; g.beginPath();
      if (p < 0.5) { g.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2); g.ellipse(cx, cy, Math.abs(x), R, 0, Math.PI / 2, -Math.PI / 2, x > 0); }
      else { g.arc(cx, cy, R, Math.PI / 2, -Math.PI / 2); g.ellipse(cx, cy, Math.abs(x), R, 0, -Math.PI / 2, Math.PI / 2, x > 0); }
      g.fill(); g.restore();
    } },
  { id: "waves", name: "Волны", d: "Синусоиды бегут, как на осциллографе",
    draw(g, p, P, o) {
      const n = 3 + Math.round(o.density * 4), cols = [P.a, P.b, P.c];
      g.lineWidth = 2;
      for (let i = 0; i < n; i++) {
        g.strokeStyle = cols[i % 3]; g.globalAlpha = 0.85 - i * 0.08; g.beginPath();
        for (let x = 0; x <= W; x += 2) {
          const y = H / 2 + Math.sin(x * (0.025 + i * 0.008) + TAU * p * (i % 2 ? 1 : 2) + i) * (18 + i * 6) * Math.sin(Math.PI * x / W);
          x ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
    } },
  { id: "orbits", name: "Орбиты", d: "Планеты обходят звезду",
    prep: (o, r) => Array.from({ length: 3 + Math.round(o.density * 4) }, (_, i) => ({ rx: 22 + i * 16, k: (i % 3) + 1, ph: r(), s: 2 + r() * 2.5 })),
    draw(g, p, P, o, S) {
      const cx = W / 2, cy = H / 2;
      g.strokeStyle = P.c; g.globalAlpha = 0.35; g.lineWidth = 1;
      for (const pl of S) { g.beginPath(); g.ellipse(cx, cy, pl.rx, pl.rx * 0.42, 0, 0, TAU); g.stroke(); }
      g.globalAlpha = 1; dot(g, cx, cy, 7, P.b);
      S.forEach((pl, i) => { const a = TAU * (p * pl.k + pl.ph) * (i % 2 ? -1 : 1); dot(g, cx + Math.cos(a) * pl.rx, cy + Math.sin(a) * pl.rx * 0.42, pl.s, i % 2 ? P.a : P.c); });
    } },
  { id: "tunnel", name: "Тоннель", d: "Полёт сквозь рамки",
    draw(g, p, P, o) {
      const n = 7 + Math.round(o.density * 7), cols = [P.a, P.b, P.c];
      g.lineWidth = 1.5;
      for (let i = n; i > 0; i--) {
        const k = Math.pow((i - p) / n, 2.2), w = W * k, h = H * k;
        g.strokeStyle = cols[i % 3]; g.globalAlpha = Math.min(1, k * 1.6);
        g.strokeRect(W / 2 - w / 2, H / 2 - h / 2, w, h);
      }
      g.globalAlpha = 1;
    } },
];

// Источник для редактора: n кадров на петлю seconds секунд, кадры кешируются.
export function patternSource(id, { palette, seconds = 4, frames = 40, density = 0.5, seed = 7 } = {}) {
  const pat = PATTERNS.find((x) => x.id === id) || PATTERNS[0];
  const P = palette || PALETTES[0];
  const o = { density }, S = pat.prep ? pat.prep(o, rng(seed)) : null;
  const n = Math.max(2, Math.min(69, frames | 0)), dur = seconds / n;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d", { willReadFrequently: !!pat.pixel });
  const cache = new Map();
  const render = (i) => {
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
    g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
    pat.draw(g, i / n, P, o, S);
    return createImageBitmap(cv);
  };
  return {
    kind: "anim", name: `${pat.name} · ${P.name}`, size: 0, w: W, h: H, duration: seconds, frames: n,
    starts: Array.from({ length: n }, (_, i) => i * dur), durs: Array(n).fill(dur), pattern: { id, palette: P.id, seconds, frames: n, density },
    frameAt(t) {
      const i = Math.min(n - 1, Math.max(0, Math.floor((((t % seconds) + seconds) % seconds) / dur)));
      if (!cache.has(i)) cache.set(i, render(i));
      return cache.get(i);
    },
    close() { cache.forEach((p) => p.then((b) => b.close(), () => {})); cache.clear(); },
  };
}

// Маленькая живая миниатюра узора для каталога (canvas 120×68, ~12 кадров/с).
export function thumb(cv, id, palette) {
  const pat = PATTERNS.find((x) => x.id === id), P = palette || PALETTES[0];
  const big = document.createElement("canvas"); big.width = W; big.height = H;
  const g = big.getContext("2d", { willReadFrequently: !!pat.pixel }), o = { density: 0.5 }, S = pat.prep ? pat.prep(o, rng(7)) : null;
  const t = cv.getContext("2d"); cv.width = 120; cv.height = 68;
  let raf = 0, last = 0, alive = true;
  const frame = (now) => {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (now - last < 80) return; last = now;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
    pat.draw(g, (now / 4000) % 1, P, o, S);
    t.drawImage(big, 0, 0, 120, 68);
  };
  raf = requestAnimationFrame(frame);
  return () => { alive = false; cancelAnimationFrame(raf); };
}
