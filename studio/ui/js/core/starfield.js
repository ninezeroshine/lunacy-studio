// Небо за интерфейсом — холодная ночь: ледяной газовый гигант в полутени, слабые индиговые сияния у горизонта,
// звёзды, редкие бледные «семена» и наземная станция внизу, нарисованная набором anatomy (core/sky-station.js).
// Бережно к ресурсам:
// - гигант рисуется один раз в свой canvas (и заново только при смене размера окна);
// - сияния — три div с радиальными градиентами, их двигает CSS-анимация transform/opacity (композитор, без JS);
// - каждый кадр рисуются только звёзды точками и семена готовыми спрайтами свечения; не чаще 30 кадров в секунду;
// - скрытая вкладка — пауза; уменьшенное движение — один статичный кадр и CSS-анимации на паузе.

import { ensureIsoCss } from "./iso-theme.js";
import { stationSvg } from "./sky-station.js";

const FPS = 30, STAR_DENSITY = 1 / 6200, SEED_DENSITY = 1 / 70000;
const STAR_COLORS = ["220,230,250", "220,230,250", "200,220,255", "180,215,255", "190,200,255", "160,190,240"];
const SEED_COLORS = [[110, 200, 255], [120, 230, 255], [140, 160, 255]];

let sky, cv, ctx, planet, stars = [], seeds = [], sprites = [], meteor = null, nextMeteor = 0, raf = 0, last = 0;
let w = 0, h = 0, dpr = 1, still = false;
const rnd = (a, b) => a + Math.random() * (b - a);

// спрайт свечения: белая сердцевина в цветном ореоле, рисуется один раз на цвет
function sprite([r, g, b]) {
  const s = document.createElement("canvas"); s.width = s.height = 64;
  const x = s.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.12, `rgba(${r},${g},${b},.95)`);
  gr.addColorStop(0.35, `rgba(${r},${g},${b},.28)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  return s;
}

function newSeed(anywhere) {
  return {
    x: Math.random() * w, y: anywhere ? rnd(h * 0.25, h) : h + rnd(10, 60),
    r: rnd(0.9, 2.3), vy: rnd(3, 9), sway: rnd(6, 16), sp: rnd(0.10, 0.22), ph: Math.random() * 6.28,
    pulse: rnd(0.9, 1.9), pp: Math.random() * 6.28, c: (Math.random() * SEED_COLORS.length) | 0,
  };
}

function seed() {
  dpr = Math.min(1.5, devicePixelRatio || 1);
  w = innerWidth; h = innerHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  stars = Array.from({ length: Math.round(w * h * STAR_DENSITY) }, () => {
    const big = Math.random() < 0.07;
    return { x: Math.random() * w, y: Math.random() * h * 0.92, r: big ? rnd(1.1, 1.8) : rnd(0.45, 0.95), a: rnd(0.3, big ? 1 : 0.7),
      tw: rnd(0.4, 1.6), ph: Math.random() * 6.28, vx: rnd(0.03, 0.14), c: STAR_COLORS[(Math.random() * STAR_COLORS.length) | 0] };
  });
  seeds = Array.from({ length: Math.max(14, Math.round(w * h * SEED_DENSITY)) }, () => newSeed(true));
  drawPlanet();
}

// Газовый гигант: полосы облаков по широте, затемнение к краю, терминатор (свет слева снизу) и атмосферный ободок.
// Считается по пикселям один раз — около 80 мс при открытии и смене размера окна; холст до 700 px, CSS растягивает.
function drawPlanet() {
  const D = Math.round(Math.min(700, Math.max(420, Math.min(w, h) * 0.8)));
  planet.width = planet.height = D;
  const g = planet.getContext("2d"), img = g.createImageData(D, D), d = img.data, R = D / 2 - 28;   // поля под ореол
  const L = [-0.62, 0.48, 0.62];                       // направление на солнце (x вправо, y вниз, z к зрителю)
  // полосы: широкие мягкие пояса + тонкие светлые струи, края завихрены по долготе — не «мяч», а атмосфера
  const band = (lat, x) => {
    const l = lat + 0.028 * Math.sin(x * 9 + lat * 17) + 0.013 * Math.sin(x * 23 - lat * 31) + 0.006 * Math.sin(x * 57 + lat * 9);
    const k = 0.5 + 0.5 * Math.sin(l * 10 + Math.sin(l * 3.7) * 1.6);
    const jet = Math.pow(0.5 + 0.5 * Math.sin(l * 46 + 0.7), 10) * 0.45;
    const warm = Math.max(0, Math.sin(l * 4.2 - 0.6)) * 0.35;           // чуть лавандовый пояс у экватора
    return [22 + 34 * k + 60 * jet + 16 * warm, 38 + 52 * k + 74 * jet + 6 * warm, 70 + 60 * k + 80 * jet + 24 * warm];   // лёд и сталь
  };
  for (let py = 0; py < D; py++) for (let px = 0; px < D; px++) {
    const x = (px - D / 2) / R, y = (py - D / 2) / R, q = x * x + y * y;
    const i = (py * D + px) * 4;
    if (q > 1) {                                        // ободок атмосферы за краем диска, только на светлой стороне
      const rr = Math.sqrt(q), edge = Math.max(0, 1 - (rr - 1) * 18);
      const lit = Math.max(0, (x * L[0] + y * L[1]) / rr);
      const a = edge * edge * lit * 0.85;
      if (a > 0.01) { d[i] = 90; d[i + 1] = 170; d[i + 2] = 255; d[i + 3] = a * 200; }
      continue;
    }
    const z = Math.sqrt(1 - q), lat = y * 0.92 + x * 0.18;   // ось чуть наклонена
    const [r0, g0, b0] = band(lat, x);
    const dif = Math.max(0, x * L[0] + y * L[1] + z * L[2]);
    const light = Math.pow(dif, 0.8) * 0.95 + 0.03, limb = 0.55 + 0.45 * z;
    const rim = Math.pow(1 - z, 3) * Math.max(0, x * L[0] + y * L[1]) * 1.4;   // атмосфера светится по краю
    d[i] = Math.min(255, r0 * light * limb + 50 * rim);
    d[i + 1] = Math.min(255, g0 * light * limb + 200 * rim);
    d[i + 2] = Math.min(255, b0 * light * limb + 255 * rim);
    d[i + 3] = 255 * Math.min(1, 0.1 + dif * 1.6 + rim);    // ночная сторона растворяется в небе
  }
  g.putImageData(img, 0, 0);
}

function draw(t) {
  ctx.clearRect(0, 0, w, h);
  const s = t / 1000;
  for (const st of stars) {
    const x = (st.x + s * st.vx) % (w + 4) - 2;
    const a = still ? st.a : st.a * (0.62 + 0.38 * Math.sin(s * st.tw + st.ph));
    ctx.fillStyle = `rgba(${st.c},${a.toFixed(3)})`;
    ctx.fillRect(x - st.r, st.y - st.r, st.r * 2, st.r * 2);
  }
  // семена: всплывают, покачиваются, дышат светом; ушедшие вверх появляются снизу
  ctx.globalCompositeOperation = "lighter";
  for (const p of seeds) {
    if (!still) { p.y -= p.vy / FPS; if (p.y < -30) Object.assign(p, newSeed(false)); }
    const x = p.x + Math.sin(s * p.sp * 6.28 + p.ph) * p.sway, fade = Math.min(1, (h - p.y) / (h * 0.35), p.y / (h * 0.2) + 0.2);
    const a = Math.max(0, fade) * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(s * p.pulse + p.pp)));
    const size = p.r * 12;
    ctx.globalAlpha = a;
    ctx.drawImage(sprites[p.c], x - size / 2, p.y - size / 2, size, size);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  if (meteor) {
    const m = meteor, k = (t - m.t0) / m.dur;
    if (k >= 1) meteor = null;
    else {
      const x = m.x + m.dx * k, y = m.y + m.dy * k, fade = Math.sin(Math.PI * k);
      const gr = ctx.createLinearGradient(x, y, x - m.dx * 0.16, y - m.dy * 0.16);
      gr.addColorStop(0, `rgba(210,255,250,${(0.8 * fade).toFixed(3)})`); gr.addColorStop(1, "rgba(120,255,236,0)");
      ctx.strokeStyle = gr; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - m.dx * 0.16, y - m.dy * 0.16); ctx.stroke();
    }
  } else if (!still && t > nextMeteor) {
    meteor = { t0: t, dur: rnd(800, 1200), x: rnd(w * 0.2, w * 0.9), y: rnd(0, h * 0.35), dx: -rnd(260, 420), dy: rnd(110, 200) };
    nextMeteor = t + rnd(25000, 45000);
  }
}

function loop(t) {
  raf = requestAnimationFrame(loop);
  if (t - last < 1000 / FPS - 1) return;
  last = t; draw(t);
}

function reduced() {
  const m = document.documentElement.dataset.motion;
  return m === "reduce" || (m !== "full" && matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function apply() {
  cancelAnimationFrame(raf); raf = 0;
  still = reduced();
  sky.classList.toggle("still", still);
  if (still || document.hidden) { draw(performance.now()); return; }
  nextMeteor = performance.now() + rnd(6000, 15000);
  raf = requestAnimationFrame(loop);
}

export function startStarfield() {
  if (sky) return;
  sky = document.createElement("div");
  sky.className = "sky"; sky.setAttribute("aria-hidden", "true");
  sky.innerHTML = `<canvas class="sky-planet"></canvas><i class="sky-glow g1"></i><i class="sky-glow g2"></i><i class="sky-glow g3"></i><canvas class="starfield"></canvas><div class="sky-station iso iso-sky"></div>`;
  ensureIsoCss();
  try { sky.querySelector(".sky-station").innerHTML = stationSvg(); } catch (e) { console.warn("станция на фоне не нарисовалась", e); }
  document.body.prepend(sky);
  planet = sky.querySelector(".sky-planet");
  cv = sky.querySelector(".starfield"); ctx = cv.getContext("2d");
  sprites = SEED_COLORS.map(sprite);
  seed(); apply();
  let rt = 0;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { seed(); draw(performance.now()); }, 150); });
  document.addEventListener("visibilitychange", apply);
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", apply);
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
}
