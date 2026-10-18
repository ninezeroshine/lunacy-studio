// Наземная станция на краю неба — фон, нарисованный набором anatomy (изометрия, четыре тона по граням).
// Площадка с линейкой и табличкой, радиотелескоп на поворотной опоре с облучателем на треноге, малая антенна,
// две стойки аппаратуры с огнями, мачта с маяком; по кабелям бегут импульсы, от облучателя вверх уходят кольца.
// Геометрия считается один раз; движение — только CSS (поток штрихов, пульс огней, кольца), композитор и чуть
// перерисовки на трёх коротких кабелях. Цвета — тема .iso-sky в core/iso-theme.js.
import * as k from "../../vendor/anatomy/iso-kit.js";

const W = 1000, H = 620;
const PAD = { x: -170, y: -120, w: 340, d: 240, r: 12 };
const PAD_H = 7;
const DISH = [52, -18], DISH_R = 46, DISH_Z = 58;        // главная антенна: центр, радиус чаши, высота кромки
const SMALL = [-78, 74], SMALL_R = 22, SMALL_Z = 30;
const RACK_A = { x: -150, y: -96, w: 44, d: 26, r: 2 }, RACK_A_H = 40;
const RACK_B = { x: -96, y: -98, w: 30, d: 24, r: 2 }, RACK_B_H = 28;
const MAST = [146, -96], MAST_H = 96;

export function stationSvg() {
  const pts = [...k.boxCorners(PAD, -PAD_H, 0), [DISH[0], DISH[1], DISH_Z + 46], [MAST[0], MAST[1], MAST_H + 6],
    [PAD.x - 60, PAD.y - 40, 0], [PAD.x + PAD.w + 60, PAD.y + PAD.d + 40, 0]];
  const P = k.fitProjection(pts, W, H, { pad: 16, azimuth: 45, elevation: 30 });
  const at = (p) => k.iso(p, P);
  const S = (paths, o) => k.solidSvg(paths, o);
  const L = (d, o) => k.lineSvg(d, o);
  const D = (p, o) => k.dotsSvg(p, o);
  const out = [];

  // поле точек вокруг площадки: гаснет к краям, как сетка на тёмной земле
  const grid = [];
  for (let gx = PAD.x - 60; gx <= PAD.x + PAD.w + 60; gx += 12) for (let gy = PAD.y - 40; gy <= PAD.y + PAD.d + 40; gy += 12) {
    if (gx > PAD.x - 4 && gx < PAD.x + PAD.w + 4 && gy > PAD.y - 4 && gy < PAD.y + PAD.d + 4) continue;
    const ex = Math.max(0, Math.max(PAD.x - gx, gx - PAD.x - PAD.w)) / 60, ey = Math.max(0, Math.max(PAD.y - gy, gy - PAD.y - PAD.d)) / 40;
    const a = 1 - Math.min(1, Math.hypot(ex, ey));
    if (a > 0.05) grid.push([...at([gx, gy, 0]), a]);
  }
  out.push(D(grid, { size: 0.6, tone: "lo" }));

  // площадка: бетонная плита с фаской, шов по периметру, винты по углам, линейка и табличка
  out.push(`<path class="iso-halo" d="${k.haloOf(PAD, -PAD_H, PAD_H, P)}"/>`);
  out.push(S(k.slabOf(PAD, -PAD_H, PAD_H, P, 8, 1.4), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PAD, 6), 0, P), { tone: "faint" }));
  const screws = k.corners(PAD, 12);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.55, tone: "mid" }));
  const strip = { x: PAD.x + 18, y: PAD.y + PAD.d - 16, w: 200, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
  out.push(L(ticks.minor, { tone: "faint" }), L(ticks.major, { tone: "lo" }));
  const plate = { x: PAD.x + PAD.w - 64, y: PAD.y + PAD.d - 30, w: 44, d: 18, r: 1.5 };
  out.push(S(k.slabOf(plate, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  for (let i = 0; i < 3; i++) out.push(L(k.lineOnTop([plate.x + 5, plate.y + 5 + i * 4], [plate.x + plate.w - 5 - i * 8, plate.y + 5 + i * 4], 0.8, P), { tone: "faint", free: true }));
  out.push(D([at([plate.x + 2.4, plate.y + 2.4, 0.8]), at([plate.x + plate.w - 2.4, plate.y + plate.d - 2.4, 0.8])], { size: 0.45 }));

  // кабели по плите: от стоек к опорам антенн и к мачте, по ним бегут импульсы (поток штрихов)
  const cable = (pts3, flow) => `<g class="sky-cable">${k.wireSvg(at(pts3[0]), at(pts3[pts3.length - 1]), { via: pts3.slice(1, -1).map(at), tone: "lo", flow, size: 1.1 })}</g>`;
  out.push(cable([[RACK_A.x + 30, RACK_A.y + RACK_A.d, 0.3], [RACK_A.x + 30, 8, 0.3], [DISH[0] - 22, 8, 0.3], [DISH[0] - 16, DISH[1] + 2, 0.3]], true));
  out.push(cable([[RACK_B.x + 15, RACK_B.y + RACK_B.d, 0.3], [RACK_B.x + 15, 40, 0.3], [SMALL[0] + 4, 40, 0.3], [SMALL[0] + 4, SMALL[1] - 9, 0.3]], true));
  out.push(cable([[DISH[0] + 18, DISH[1] - 6, 0.3], [MAST[0] - 4, DISH[1] - 6, 0.3], [MAST[0] - 4, MAST[1] + 6, 0.3]], true));

  // предметы — сзади вперёд по глубине основания
  const items = [
    { at: [RACK_A.x + RACK_A.w / 2, RACK_A.y + RACK_A.d / 2], draw: () => rack(RACK_A, RACK_A_H, 5) },
    { at: [RACK_B.x + RACK_B.w / 2, RACK_B.y + RACK_B.d / 2], draw: () => rack(RACK_B, RACK_B_H, 3) },
    { at: DISH, draw: () => dish(DISH, DISH_R, DISH_Z, true) },
    { at: SMALL, draw: () => dish(SMALL, SMALL_R, SMALL_Z, false) },
    { at: MAST, draw: mast },
  ].sort((a, b) => k.depthOf([...a.at, 0], P) - k.depthOf([...b.at, 0], P));
  for (const it of items) out.push(it.draw());

  function rack(plan, h, rows) {
    const o = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(plan, -2), 0, 0.1, P)}" style="filter:blur(5px)"/>`];
    o.push(S(k.slabOf(plan, 0, 3, P, 3, 0.4), { tone: "lo" }));                                   // цоколь
    o.push(S(k.slabOf(k.insetPlan(plan, 1.2), 3, h - 3, P, 3, 0.6), { tone: "mid" }));           // корпус
    o.push(L(k.planOutline(k.insetPlan(plan, 4), h, P, 3), { tone: "faint" }));                  // крышка
    const fy = plan.y + plan.d - 1.2;                                                           // фасад смотрит на нас
    for (let r = 0; r < rows; r++) {
      const z = h - 7 - r * ((h - 10) / rows);
      o.push(L(k.segment([plan.x + 2, fy, z - 2.6], [plan.x + plan.w - 2, fy, z - 2.6], P), { tone: "faint" }));   // шов блока
      o.push(D([at([plan.x + 6, fy, z]), at([plan.x + 9.5, fy, z])], { size: 0.7, tone: "hi", pulse: true }));       // огни
      for (let s = 0; s < 4; s++) o.push(L(k.segment([plan.x + 16 + s * 4, fy, z + 1], [plan.x + 16 + s * 4, fy, z - 1], P), { tone: "lo" }));  // решётка
    }
    o.push(D(k.corners(k.insetPlan(plan, 1.2), 2).map(([x, y]) => at([x, y, h])), { size: 0.45 }));
    return `<g>${o.join("")}</g>`;
  }

  function dish([x, y], R, zr, big) {
    const o = [];
    const base = big ? 16 : 9;
    o.push(`<path class="iso-halo" d="${k.haloOf({ x: x - base - 4, y: y - base - 4, w: 2 * base + 8, d: 2 * base + 8, r: base }, 0, 0.1, P)}" style="filter:blur(6px)"/>`);
    o.push(S(k.cylinder(x, y, base + 3, 0, 2.4, P, 40, 0.5), { tone: "lo" }));                         // фланец
    o.push(D(k.circleRing(x, y, base + 1.4, 8).map(([a, b]) => at([a, b, 2.4])), { size: 0.4 }));        // болты
    o.push(S(k.cylinder(x, y, base, 2.4, big ? 20 : 12, P, 40, 0.6), { tone: "mid" }));                   // опора
    o.push(L(k.sideArc(x, y, base, big ? 10 : 7, P, 24), { tone: "faint" }));
    const turn = 2.4 + (big ? 20 : 12);
    o.push(S(k.cylinder(x, y, base + 2, turn, 3, P, 40, 0.5), { tone: "mid" }));                          // поворотный круг
    o.push(L(k.knurl(x, y, base + 2, turn, turn + 3, 48, P), { tone: "faint" }));
    o.push(S(k.cylinder(x, y, big ? 5 : 3, turn + 3, zr - turn - 3 - (big ? 12 : 6), P, 24), { tone: "mid", crease: "none" }));   // шток
    const shell = zr - (big ? 12 : 6);
    o.push(S(k.cylinder(x, y, R * 0.42, shell, 4, P, 48, 0.5), { tone: "lo" }));                        // спинка чаши ступенями
    o.push(S(k.cylinder(x, y, R * 0.7, shell + 4, 4, P, 56, 0.5), { tone: "lo" }));
    o.push(S(k.cylinder(x, y, R, zr - 4, 4, P, 72, 0.8), { tone: "hi", crease: "lo" }));                  // кромка
    for (const f of [0.82, 0.62, 0.42, 0.22]) o.push(L(k.ring(x, y, R * f, zr, P, 64), { tone: f > 0.5 ? "lo" : "faint" }));   // зоны отражателя
    const rib = k.radialTicks(x, y, R - 1.5, 12, 3, zr, [R * 0.55, R * 0.75], P);
    o.push(L(rib.minor, { tone: "faint" }), L(rib.major, { tone: "lo" }));
    // тренога облучателя: три ноги с кромки к вершине, сам облучатель — освещённая деталь у большой антенны
    const apex = zr + (big ? 34 : 18);
    const legs = [0, 2.094, 4.189].map((a) => [x + Math.cos(a + 0.6) * R * 0.9, y + Math.sin(a + 0.6) * R * 0.9]);
    o.push(L(legs.map(([a, b]) => k.segment([a, b, zr], [x, y, apex - 2], P)).join(""), { tone: "mid" }));
    o.push(D(legs.map(([a, b]) => at([a, b, zr])), { size: 0.5, tone: "mid" }));
    o.push(S(k.cylinder(x, y, big ? 3.4 : 2, apex - 2, big ? 7 : 4, P, 20, 0.4), { tone: "hi", lit: big }));
    if (big) o.push(D([at([x, y, apex + 5.4])], { size: 1, tone: "hi", pulse: true }));
    return `<g>${o.join("")}</g>`;
  }

  function mast() {
    const [x, y] = MAST, o = [];
    o.push(S(k.cylinder(x, y, 5, 0, 2, P, 24, 0.4), { tone: "lo" }));
    o.push(S(k.cylinder(x, y, 1.6, 2, MAST_H - 2, P, 16), { tone: "mid", crease: "none" }));
    for (const z of [30, 60]) o.push(S(k.cylinder(x, y, 2.6, z, 1.6, P, 16), { tone: "mid" }));          // хомуты
    const anchors = [[x - 26, y - 4], [x + 6, y - 28], [x + 10, y + 22]];                                 // растяжки
    o.push(L(anchors.map(([a, b]) => k.segment([a, b, 0.5], [x, y, 61], P)).join(""), { tone: "lo" }));
    o.push(D(anchors.map(([a, b]) => at([a, b, 0.5])), { size: 0.5 }));
    o.push(S(k.cylinder(x, y, 2.4, MAST_H, 3, P, 16), { tone: "hi" }));
    o.push(`<g class="sky-beacon">${D([at([x, y, MAST_H + 4.5])], { size: 1.4, tone: "hi", pulse: true })}</g>`);
    return `<g>${o.join("")}</g>`;
  }

  // кольца сигнала: эллипс в плоскости над облучателем, уходят вверх и гаснут (только CSS transform/opacity)
  const [fx, fy] = at([DISH[0], DISH[1], DISH_Z + 40]);
  const wave = L(k.ring(DISH[0], DISH[1], 10, DISH_Z + 40, P, 48), { tone: "lit" });
  out.push(`<g class="sky-waves" style="transform-origin:${fx.toFixed(1)}px ${fy.toFixed(1)}px">${[0, 1, 2].map((i) => `<g class="sky-wave" style="animation-delay:${i * -2.2}s;transform-origin:${fx.toFixed(1)}px ${fy.toFixed(1)}px">${wave}</g>`).join("")}</g>`);

  return k.figureSvg({ width: W, height: H, label: "", className: "sky-station-svg", body: out });
}
