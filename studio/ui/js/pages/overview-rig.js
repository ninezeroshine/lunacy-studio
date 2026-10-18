// «Пульт телеметрии» — главный рисунок «Обзора», набор anatomy (vendor/anatomy/iso-kit.js).
// Настоящий прибор на верстаке, а не схема: две смотровые колбы (занятая RAM и видеопамять — уровень жидкости),
// два стрелочных прибора (загрузка CPU и GPU, шкала 270°), клавиша на переключателе, которая нажимается в такт
// твоей печати, и табло с числом нажатий за сегодня. Всё, что показывает рисунок, берётся из /api/stats и
// /api/status. Статика собирается один раз; живые части (стрелки, жидкость, клавиша, табло) меняют атрибуты.
import * as k from "../../vendor/anatomy/iso-kit.js";
import { reduceMotion } from "../core/dom.js";

const W = 760, H = 400;
const BENCH = { x: -158, y: -60, w: 316, d: 120, r: 8 }, BENCH_H = 10, FOOT_H = 5;
const TUBES = [{ at: [-132, -22], id: "ram" }, { at: [-106, -22], id: "vram" }];
const TUBE_R = 6, TUBE_Z0 = 6, TUBE_H = 66;
const DIALS = [{ at: [-48, 6], id: "cpu" }, { at: [30, 6], id: "gpu" }];
const DIAL_R = 31, DIAL_Z = 26, DIAL_H = 8, DIAL_TOP = DIAL_Z + DIAL_H, SWEEP = 270;
const KEY = [104, -16], KEY_Z = 9, KEY_TRAVEL = 3.4;
const LCD = { x: 88, y: 14, w: 58, d: 26, r: 2 }, LCD_H = 20;
const JBOX = { x: -26, y: -58, w: 40, d: 16, r: 2 }, JBOX_H = 12;

export function mountRig(host) {
  const P = k.fitProjection([...k.boxCorners(BENCH, -BENCH_H - FOOT_H, 0), [TUBES[0].at[0], TUBES[0].at[1], TUBE_Z0 + TUBE_H + 8],
    [DIALS[1].at[0] + DIAL_R, DIALS[1].at[1], DIAL_TOP + 2]], W, H, { pad: 14, azimuth: 56, elevation: 30 });
  const at = (p) => k.iso(p, P);
  const S = (paths, o) => k.solidSvg(paths, o);
  const L = (d, o) => k.lineSvg(d, o);
  const D = (p, o) => k.dotsSvg(p, o);
  const { sinA, cosA } = k.cameraOf(P);
  const UP = Math.atan2(-cosA, sinA);                       // угол шкалы, который на экране смотрит вверх
  const angleOf = (f) => UP - (SWEEP / 2) * Math.PI / 180 + Math.max(0, Math.min(1, f)) * SWEEP * Math.PI / 180;
  const out = [];

  // ---------- верстак: ножки, плита с фаской, паз, винты, линейка, табличка ----------
  out.push(`<path class="iso-halo" d="${k.haloOf(BENCH, -BENCH_H - FOOT_H, BENCH_H, P)}"/>`);
  const feet = k.corners(BENCH, 20).sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P));
  for (const [x, y] of feet) {
    out.push(S(k.cylinder(x, y, 7, -BENCH_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.2, -BENCH_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(BENCH, -BENCH_H, BENCH_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(BENCH, 5), 0, P), { tone: "faint" }));
  const screws = k.corners(BENCH, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.55 }));
  const strip = { x: BENCH.x + 20, y: BENCH.y + BENCH.d - 14, w: 190, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }));
  const plate = { x: 38, y: BENCH.y + BENCH.d - 26, w: 46, d: 16, r: 1.5 };
  out.push(S(k.slabOf(plate, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  out.push(k.faceTextSvg(k.topMatrix([plate.x + 5, plate.y + 7], 0.8, P, "x"), "LUNACY", { size: 4.2, tone: "mid" }));
  for (let i = 0; i < 2; i++) out.push(L(k.lineOnTop([plate.x + 5, plate.y + 10.5 + i * 3], [plate.x + plate.w - 8 - i * 10, plate.y + 10.5 + i * 3], 0.8, P), { tone: "faint", free: true }));
  out.push(D([at([plate.x + 2.2, plate.y + 2.2, 0.8]), at([plate.x + plate.w - 2.2, plate.y + plate.d - 2.2, 0.8])], { size: 0.42 }));

  // ---------- распределительная коробка сзади и кабели от неё к приборам (по ним бегут импульсы) ----------
  const glands = [-18, -6, 6];
  const wire = (pts, flow) => k.wireSvg(at(pts[0]), at(pts[pts.length - 1]), { via: pts.slice(1, -1).map(at), tone: "lo", flow, size: 1.1 });
  out.push(wire([[TUBES[0].at[0] + 6, TUBES[0].at[1] - 7, 0.3], [TUBES[0].at[0] + 6, -42, 0.3], [JBOX.x + 20 + glands[0], -42, 0.3]], true));
  out.push(wire([[DIALS[0].at[0] + 6, DIALS[0].at[1] - 15, 0.3], [DIALS[0].at[0] + 6, -38, 0.3], [JBOX.x + 20 + glands[1], -38, 0.3], [JBOX.x + 20 + glands[1], JBOX.y + JBOX.d + 0.6, 0.3]], true));
  out.push(wire([[DIALS[1].at[0] - 6, DIALS[1].at[1] - 15, 0.3], [DIALS[1].at[0] - 6, -34, 0.3], [JBOX.x + 20 + glands[2], -34, 0.3], [JBOX.x + 20 + glands[2], JBOX.y + JBOX.d + 0.6, 0.3]], true));
  out.push(wire([[KEY[0] - 12, KEY[1] - 6, 0.3], [KEY[0] - 12, -46, 0.3], [JBOX.x + JBOX.w, -46, 0.3]], true));

  // ---------- предметы сзади вперёд ----------
  const live = {};
  const items = [
    { at: [JBOX.x + JBOX.w / 2, JBOX.y + JBOX.d / 2], draw: jbox },
    ...TUBES.map((t) => ({ at: t.at, draw: () => tube(t) })),
    ...DIALS.map((d) => ({ at: d.at, draw: () => dial(d) })),
    { at: KEY, draw: keySwitch },
    { at: [LCD.x + LCD.w / 2, LCD.y + LCD.d / 2], draw: lcd },
  ].sort((a, b) => k.depthOf([...a.at, 0], P) - k.depthOf([...b.at, 0], P));
  for (const it of items) out.push(it.draw());

  function jbox() {
    const o = [S(k.slabOf(JBOX, 0, JBOX_H, P, 3, 0.6), { tone: "mid" })];
    o.push(L(k.planOutline(k.insetPlan(JBOX, 2.4), JBOX_H, P, 3), { tone: "faint" }));
    o.push(D(k.corners(JBOX, 2.6).map(([x, y]) => at([x, y, JBOX_H])), { size: 0.45 }));
    for (const g of glands) {                                       // кабельные вводы на передней стенке
      const x = JBOX.x + 20 + g, y = JBOX.y + JBOX.d;
      o.push(S(k.slabOf({ x: x - 2.2, y, w: 4.4, d: 2.4, r: 1.2 }, 1.2, 4, P, 3), { tone: "mid", crease: "none" }));
    }
    o.push(D([at([JBOX.x + 5, JBOX.y + JBOX.d, JBOX_H - 3])], { size: 0.8, tone: "hi", pulse: true }));   // огонёк питания
    return o.join("");
  }

  function tube({ at: [x, y], id }) {
    const o = [];
    o.push(S(k.cylinder(x, y, 8.4, 0, 2, P, 32, 0.4), { tone: "lo" }));                     // фланец
    o.push(k.faceTextSvg(k.topMatrix([x - 6, y + 15], 0, P, "x"), id === "ram" ? "RAM" : "VRAM", { size: 3.6, tone: "mid" }));   // гравировка на верстаке
    o.push(D(k.circleRing(x, y, 7, 6).map(([a, b]) => at([a, b, 2])), { size: 0.4 }));        // винты фланца
    o.push(S(k.cylinder(x, y, TUBE_R + 1.6, 2, TUBE_Z0 - 2, P, 32, 0.4), { tone: "mid" }));   // нижний стакан
    // жидкость — живая часть: столб, высота которого = доля занятой памяти
    o.push(`<g data-fluid="${id}"></g>`);
    // стекло: контур трубки и деления шкалы спереди; сквозь него видно жидкость
    const gl = TUBE_Z0, gh = TUBE_Z0 + TUBE_H;
    o.push(L(k.sideArc(x, y, TUBE_R, gh, P, 20) + k.ring(x, y, TUBE_R, gh, P, 32), { tone: "mid" }));
    const [vx, vy] = k.towardViewer(P), n = Math.hypot(vx, vy);
    const side = (s) => { const a = Math.atan2(vy, vx) + s * Math.PI / 2; return [x + Math.cos(a) * TUBE_R, y + Math.sin(a) * TUBE_R]; };
    for (const s of [-1, 1]) { const [a, b] = side(s); o.push(L(k.segment([a, b, gl], [a, b, gh], P), { tone: "mid" })); }
    for (let i = 1; i < 10; i++) {
      const z = gl + (TUBE_H * i) / 10, len = i % 5 === 0 ? 3.4 : 2;
      const a1 = Math.atan2(vy, vx) - len / TUBE_R / 2, a2 = Math.atan2(vy, vx) + len / TUBE_R / 2;
      o.push(L(k.segment([x + Math.cos(a1) * TUBE_R, y + Math.sin(a1) * TUBE_R, z], [x + Math.cos(a2) * TUBE_R, y + Math.sin(a2) * TUBE_R, z], P), { tone: i % 5 ? "lo" : "mid" }));
    }
    o.push(S(k.cylinder(x, y, TUBE_R + 1.6, gh, 4, P, 32, 0.4), { tone: "mid" }));          // крышка
    o.push(S(k.cylinder(x, y, 2.2, gh + 4, 2.4, P, 20), { tone: "mid" }));                  // пробка
    o.push(L(k.knurl(x, y, 2.2, gh + 4, gh + 6.4, 18, P), { tone: "lo" }));
    return o.join("");
  }

  function dial({ at: [x, y], id }) {
    const o = [];
    const foot = { x: x - 18, y: y - 16, w: 36, d: 32, r: 3 };
    o.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(foot, 2), 0, 0.1, P)}" style="filter:blur(4px)"/>`);
    o.push(S(k.slabOf(foot, 0, 6, P, 4, 0.6), { tone: "mid" }));                             // основание
    o.push(D(k.corners(foot, 3.4).map(([a, b]) => at([a, b, 6])), { size: 0.45 }));
    o.push(L(k.planOutline(k.insetPlan(foot, 6), 6, P, 3), { tone: "faint" }));
    o.push(S(k.cylinder(x, y, 4.4, 6, 3, P, 24, 0.4), { tone: "mid" }));                     // втулка
    o.push(S(k.cylinder(x, y, 3, 9, DIAL_Z - 9, P, 24), { tone: "mid", crease: "none" }));   // стойка
    o.push(L(k.sideArc(x, y, 3, 17, P, 12), { tone: "lo" }));
    o.push(S(k.cylinder(x, y, DIAL_R, DIAL_Z, DIAL_H, P, 72, 0.8), { tone: "hi", crease: "lo" }));   // корпус
    o.push(L(k.knurl(x, y, DIAL_R, DIAL_TOP - 3.4, DIAL_TOP, 96, P, 0.3), { tone: "lo" }));         // рифлёный безель
    o.push(L(k.sideArc(x, y, DIAL_R, DIAL_TOP - 3.4, P, 40), { tone: "faint" }));
    o.push(L(k.ring(x, y, DIAL_R - 2.4, DIAL_TOP, P, 72), { tone: "lo" }));
    const from = angleOf(0), span = SWEEP * Math.PI / 180;
    const t = k.radialTicks(x, y, DIAL_R - 3.4, 50, 5, DIAL_TOP, [1.4, 3.2], P, from, span);
    o.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
    // красная зона 85–100 %: дуга внутри шкалы
    const arc = [];
    for (let i = 0; i <= 12; i++) { const a = angleOf(0.85 + 0.15 * i / 12); arc.push([x + Math.sin(a) * (DIAL_R - 7.4), y - Math.cos(a) * (DIAL_R - 7.4)]); }
    o.push(L(k.onTop(arc, DIAL_TOP, P), { tone: "red" }));
    // ушко крепления к стойке (как у индикатора часового типа)
    o.push(S(k.slabOf({ x: x - 2.4, y: y + DIAL_R - 1, w: 4.8, d: 4.4, r: 1.2 }, DIAL_Z + 1.4, 5, P, 3), { tone: "mid" }));
    // гравировка на циферблате, ближе к зрителю: какой это прибор и шкала в процентах
    const [vx, vy] = k.towardViewer(P);
    o.push(k.faceTextSvg(k.topMatrix([x + vx * 9 - 6, y + vy * 9 + 1.6], DIAL_TOP, P, "x"), id.toUpperCase(), { size: 4.6, tone: "mid" }));
    o.push(k.faceTextSvg(k.topMatrix([x + vx * 15 - 2.4, y + vy * 15 + 1.2], DIAL_TOP, P, "x"), "%", { size: 3.2, tone: "lo" }));
    o.push(`<path data-needle="${id}" class="iso-line" data-tone="hi" data-free="start" style="stroke-width:1.3" d=""/>`);
    o.push(S(k.cylinder(x, y, 1.6, DIAL_TOP, 0.8, P, 16), { tone: "hi" }));                  // ось стрелки
    return o.join("");
  }

  function keySwitch() {
    const [x, y] = KEY, o = [];
    const house = { x: x - 11, y: y - 11, w: 22, d: 22, r: 2 };
    o.push(S(k.slabOf(k.insetPlan(house, -3), 0, 2.4, P, 3, 0.4), { tone: "lo" }));           // площадка
    o.push(D(k.corners(k.insetPlan(house, -3), 1.6).map(([a, b]) => at([a, b, 2.4])), { size: 0.42 }));
    o.push(S(k.slabOf(house, 2.4, KEY_Z - 2.4, P, 3, 0.6), { tone: "mid" }));                 // корпус переключателя
    o.push(D([at([house.x + 3, house.y + house.d, KEY_Z - 2.8])], { size: 0.8, tone: "lo" }));
    o.push(`<g data-led>${D([at([house.x + 3, house.y + house.d, KEY_Z - 2.8])], { size: 0.8, tone: "hi" })}</g>`);
    // колпачок — освещённая деталь рисунка: он нажимается в такт печати
    const cap = { x: x - 10, y: y - 10, w: 20, d: 20, r: 2.4 };
    const capArt = S(k.slabOf(cap, KEY_Z + KEY_TRAVEL, 7, P, 4, 1.2), { tone: "hi", lit: true })
      + L(k.planOutline(k.insetPlan(cap, 3.2), KEY_Z + KEY_TRAVEL + 7, P, 4), { tone: "lit" })
      + k.faceTextSvg(k.topMatrix([x - 4.6, y + 2.2], KEY_Z + KEY_TRAVEL + 7, P, "x"), "L", { size: 6, tone: "hi" });
    o.push(`<g data-cap>${capArt}</g>`);
    return o.join("");
  }

  function lcd() {
    const o = [S(k.slabOf(LCD, 0, LCD_H, P, 3, 0.8), { tone: "mid" })];
    o.push(D(k.corners(LCD, 2.4).map(([a, b]) => at([a, b, LCD_H])), { size: 0.45 }));
    o.push(L(k.planOutline(k.insetPlan(LCD, 3), LCD_H, P, 3), { tone: "faint" }));
    // окно табло на передней грани (+y): тёмное стекло и цифры в плоскости грани
    const fy = LCD.y + LCD.d, win = [[LCD.x + 4, fy, LCD_H - 3.5], [LCD.x + LCD.w - 4, fy, LCD_H - 3.5], [LCD.x + LCD.w - 4, fy, 4], [LCD.x + 4, fy, 4]];
    o.push(`<path class="rig-glass" d="${k.pathOf(win.map(at), true)}"/>`);
    o.push(`<g data-lcd transform="${k.sideMatrix([LCD.x + LCD.w - 6.5, fy], LCD_H - 6, P, "left")}"><text class="rig-digits" font-size="8.6" text-anchor="end" y="5.6">0</text></g>`);
    o.push(`<g transform="${k.sideMatrix([LCD.x + 7, fy], LCD_H - 6, P, "left")}"><text class="rig-label" font-size="3.4" y="3">сегодня</text></g>`);
    o.push(L(k.segment([LCD.x + 4, fy, 2.2], [LCD.x + 18, fy, 2.2], P), { tone: "faint", free: true }));
    return o.join("");
  }

  host.innerHTML = k.figureSvg({ width: W, height: H, label: "Пульт телеметрии: колбы занятой памяти, стрелочные приборы загрузки CPU и GPU, клавиша печати и табло нажатий за сегодня", body: out });
  const svg = host.querySelector("svg");
  live.needle = Object.fromEntries(DIALS.map((d) => [d.id, svg.querySelector(`[data-needle="${d.id}"]`)]));
  live.fluid = Object.fromEntries(TUBES.map((t) => [t.id, svg.querySelector(`[data-fluid="${t.id}"]`)]));
  live.cap = svg.querySelector("[data-cap]"); live.led = svg.querySelector("[data-led]"); live.lcd = svg.querySelector("[data-lcd] text");

  // ---------- живое: экспоненциальное следование к значениям, нажатия клавиши пружиной ----------
  const want = { cpu: 0, gpu: 0, ram: 0, vram: 0 }, cur = { cpu: 0, gpu: 0, ram: 0, vram: 0 };
  const press = { at: 0, rate: 0, queue: 0, next: 0 };
  let frame = 0, last = 0, visible = true, alive = true;

  const needleD = (id, f) => {
    const [x, y] = DIALS.find((d) => d.id === id).at, a = angleOf(f);
    return k.lineOnTop([x - Math.sin(a) * 4, y + Math.cos(a) * 4], [x + Math.sin(a) * (DIAL_R - 5), y - Math.cos(a) * (DIAL_R - 5)], DIAL_TOP + 0.3, P);
  };
  const fluidSvg = (id, f) => {
    const [x, y] = TUBES.find((t) => t.id === id).at, h = Math.max(0.6, TUBE_H * Math.max(0, Math.min(1, f)) - 0.4);
    return S(k.cylinder(x, y, TUBE_R - 1.1, TUBE_Z0, h, P, 28), { tone: "hi", crease: "none" })
      + L(k.ring(x, y, TUBE_R - 1.1, TUBE_Z0 + h, P, 28), { tone: "lit" });
  };
  function draw() {
    for (const d of DIALS) live.needle[d.id].setAttribute("d", needleD(d.id, cur[d.id]));
    for (const t of TUBES) live.fluid[t.id].innerHTML = fluidSvg(t.id, cur[t.id]);
    live.cap.setAttribute("transform", k.translateAlong(P, [0, 0, -KEY_TRAVEL * press.at]));
    live.led.style.opacity = String(Math.min(1, press.at * 1.4));
  }
  function tick(now) {
    if (!alive) return;
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60; last = now;
    const calm = reduceMotion();
    let moving = false;
    for (const key in cur) {
      cur[key] = calm ? want[key] : cur[key] + (want[key] - cur[key]) * (1 - Math.exp(-dt / 0.45));
      if (Math.abs(want[key] - cur[key]) < 0.0008) cur[key] = want[key]; else moving = true;
    }
    // нажатие: короткий импульс вниз (25 мс) и пружина назад (70 мс), как у клавиатуры на «Клавишах»
    if (press.queue > 0 && now >= press.next && !calm) { press.queue--; press.next = now + press.gap; press.kick = now; }
    const target = press.kick && now - press.kick < 60 ? 1 : 0;
    press.at += (target - press.at) * (1 - Math.exp(-dt / (target ? 0.025 : 0.07)));
    if (Math.abs(target - press.at) < 0.002) press.at = target;
    if (press.queue > 0 || press.at > 0) moving = true;
    draw();
    frame = moving && visible ? requestAnimationFrame(tick) : 0;
  }
  const run = () => { if (!frame && visible && alive) { last = 0; frame = requestAnimationFrame(tick); } };
  const io = new IntersectionObserver((e) => { visible = e[e.length - 1].isIntersecting; if (visible) run(); });
  io.observe(host);
  draw();

  return {
    // доли 0..1; null — данных нет (тогда стрелка на нуле)
    set(v) { for (const key in want) if (v[key] != null) want[key] = v[key]; run(); },
    // n нажатий за последнюю секунду: проигрываем их равномерно, не больше 8 в секунду
    taps(n) { if (n <= 0 || reduceMotion()) return; press.queue = Math.min(8, press.queue + n); press.gap = 1000 / Math.max(1, Math.min(8, n)); run(); },
    today(n) { const s = n.toLocaleString("ru-RU"); if (live.lcd.textContent !== s) live.lcd.textContent = s; },
    destroy() { alive = false; cancelAnimationFrame(frame); io.disconnect(); },
  };
}
