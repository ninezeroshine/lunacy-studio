// Раздел «Подсветка»: встроенные эффекты (сразу на клавиатуру), свои цвета (холст), живая подсветка сервиса.
import { $, $$, esc, on, hex, rgb, reduceMotion, keepFocus, fresh } from "../core/dom.js";
import { icon, moonPhase } from "../core/icons.js";
import { store, local, on as onTopic, blockReason } from "../core/store.js";
import { get, post } from "../core/api.js";
import { toast, act, promptDialog } from "../core/feedback.js";
import { createChart } from "../chart/real.js";
import { mirror } from "../chart/mirror.js";
import { liveEffectColor, geometry, mountMini, REACTIVE } from "../chart/effects.js";
import { keys, effectName, keyByHid, fullName } from "../core/keydata.js";

const STARS = [
  ["Полярная", [255, 255, 255]], ["Вега", [205, 220, 255]], ["Сириус", [150, 190, 255]], ["Спика", [96, 128, 255]],
  ["Капелла", [255, 232, 160]], ["Луна", [216, 189, 132]], ["Арктур", [255, 170, 80]], ["Альдебаран", [255, 120, 50]],
  ["Бетельгейзе", [255, 70, 40]], ["Антарес", [225, 30, 70]], ["Альциона", [70, 220, 200]], ["Тубан", [120, 255, 120]],
];
const SOURCES = [
  { id: null, title: "Выключена", desc: "Горит эффект самой клавиатуры", icon: "keys" },
  { id: "ambilight", title: "Ambilight", desc: "Цвета экрана переходят на клавиши", icon: "screen" },
  { id: "heatmap", title: "Тепловая карта", desc: "Чем чаще нажимаешь, тем теплее клавиша", icon: "light" },
  { id: "load", title: "Нагрузка системы", desc: "Столбики CPU, RAM и GPU на цифровом блоке", icon: "cpu" },
  { id: "solid", title: "Сплошной цвет", desc: "Ровный фон под сигналы и индикаторы", icon: "palette" },
];
const TEMPLATES = [
  { id: "fingers", title: "Зоны пальцев", desc: "для слепой печати" },
  { id: "mods", title: "Модификаторы", desc: "Ctrl, Shift, Alt, Win акцентом" },
  { id: "wasd", title: "WASD и стрелки", desc: "для игр" },
];

let v = null;

export default {
  id: "light", title: "Подсветка", icon: "light",

  mount(root, ctx) {
    const L = store.server.profile.lighting;
    v = {
      root, ctx, tab: ctx.params.tab || local.get("lightTab", "effects"), fx: fxFromProfile(),
      paint: local.get("paint") || Object.fromEntries(Object.entries(L.user_colors || {}).map(([k, c]) => [+k, c])),
      paintColor: local.get("paintColor", [216, 189, 132]), paintColor2: local.get("paintColor2", [96, 128, 255]),
      tool: "brush", userBright: +(L.user_brightness ?? 5), stats: null, cleanups: [],
    };
    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div><h1>Подсветка</h1><p class="lead" id="lightLead"></p></div>
          <div class="seg" role="tablist" id="lightTabs">
            <button role="tab" data-tab="effects">Эффекты</button><button role="tab" data-tab="paint">Свои цвета</button><button role="tab" data-tab="live">Живая</button>
          </div>
        </div>
        <div class="l-layout">
          <div class="stack">
            <section class="panel plate"><div id="chartHost"></div><div class="plate-foot" id="plateFoot"></div></section>
            <div id="leftExtra"></div>
          </div>
          <aside class="panel inspector"><div class="panel-body" id="lightSide"></div></aside>
        </div>
      </div>`;
    on($("#lightTabs", root), "click", "[data-tab]", (e, b) => setTab(b.dataset.tab));
    setTab(v.tab, true);
    const off = onTopic("status", (st) => { if (v?.tab === "live") renderLiveState(st); });
    return () => { flushFx(); stopAnim(); off(); v.cleanups.forEach((f) => f()); v.chart?.destroy(); v = null; };
  },
  onServer() { if (v) { v.fx = fxFromProfile(); if (v.tab !== "paint") setTab(v.tab, true); } },
};

function fxFromProfile() {
  const L = store.server.profile.lighting;
  return { mode: +L.mode, rgb: L.rgb || [255, 255, 255], colorful: +L.colorful, brightness: +L.brightness, speed: +L.speed, direction: +L.direction };
}
const BRIGHT = ["новолуние — не горит", "тонкий серп", "серп", "четверть", "почти полная", "полнолуние"];

function setTab(tab, force) {
  if (!v || (!force && tab === v.tab)) return;
  v.tab = tab; local.set("lightTab", tab);
  $$("#lightTabs [data-tab]", v.root).forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab));
  stopAnim(); v.cleanups.forEach((f) => f()); v.cleanups = [];
  ["#lightSide", "#plateFoot", "#leftExtra"].forEach((id) => fresh($(id, v.root)));
  v.chart?.destroy();
  v.chart = createChart($("#chartHost", v.root), {
    mode: tab === "paint" ? "paint" : "", interactive: tab === "paint",
    onPaint: tab === "paint" ? (k, e) => paintKey(k, e) : undefined,
    label: tab === "paint" ? "Холст: води по клавишам, чтобы раскрасить" : "Превью подсветки",
  });
  const lead = {
    effects: "Встроенные эффекты прошивки. Щелчок включает эффект на клавиатуре сразу — он сохраняется в ней самой.",
    paint: "Свой цвет на каждую клавишу. Рисуй на карте, проверь на клавиатуре и сохрани — подсветка останется и без программы.",
    live: "Подсветку рисует сервис, пока он запущен: Ambilight, тепловая карта, нагрузка. Закроешь сервис — вернётся эффект клавиатуры.",
  }[tab];
  $("#lightLead", v.root).textContent = lead;
  ({ effects: renderEffects, paint: renderPaint, live: renderLive })[tab]();
}

// ================= Эффекты =================
function renderEffects() {
  const effects = store.server.effects;
  v.chart.update({ annot: REACTIVE[v.fx.mode] ? "нажимай клавиши — превью ответит" : "превью приближённое", annotRight: effectName(v.fx.mode).toLowerCase() });
  $("#plateFoot", v.root).innerHTML = `<span class="note">Как именно рисует прошивка — видно на самой клавиатуре; здесь характер эффекта.</span>`;
  $("#leftExtra", v.root).innerHTML = `
    <div class="row between"><h2>Эффекты</h2><span class="annot">${effects.length} режимов</span></div>
    <div class="fx-grid" id="fxGrid">${effects.map((_, i) => `
      <div class="fx" data-mode="${i}" ${isActive(i) ? "data-on" : ""}>
        <button class="fx-main" data-pick="${i}" aria-pressed="${isActive(i)}">
          <canvas width="190" height="70" aria-hidden="true"></canvas>
          <span class="nm">${esc(effectName(i))}<small>режим ${i}${store.server.profile.effect_names?.[i] ? " · подписано тобой" : ""}</small></span>
        </button>
        <button class="rn" data-rename="${i}" aria-label="Переименовать эффект «${esc(effectName(i))}»" data-tip="Название не совпадает с тем, что видишь? Переименуй">${icon("edit")}</button>
      </div>`).join("")}</div>`;
  $$("#fxGrid .fx", v.root).forEach((el) => v.cleanups.push(mountMini($("canvas", el), +el.dataset.mode, () => ({ ...v.fx, brightness: 5 }))));
  const grid = $("#fxGrid", v.root);
  on(grid, "click", "[data-rename]", (e, b) => rename(+b.dataset.rename));
  on(grid, "click", "[data-pick]", (e, b) => chooseEffect(+b.dataset.pick));
  renderFxSide();
  startAnim(() => v.fx.mode, () => v.fx);
}

const isActive = (i) => store.server.profile.lighting.kind === "effect" && +store.server.profile.lighting.mode === i;

function renderFxSide() { keepFocus(() => $("#lightSide", v.root), renderFxSideNow); }
function renderFxSideNow() {
  const side = fresh($("#lightSide", v.root)), fx = v.fx;
  const custom = !STARS.some(([, c]) => c.join() === fx.rgb.join());
  side.innerHTML = `
    <div class="k-title"><h2>${esc(effectName(fx.mode))}</h2><span class="annot">режим ${fx.mode}</span></div>
    <div class="ctl-row">
      <div class="row between"><h3>Цвет</h3><label class="check"><input type="checkbox" id="fxColorful" ${fx.colorful ? "checked" : ""}> Разноцветный</label></div>
      <div class="swatches" ${fx.colorful ? 'style="opacity:.4"' : ""}>
        ${STARS.map(([n, c]) => `<button data-c="${c.join()}" style="background:${hex(c)}" data-tip="${n}" aria-label="${n}" aria-pressed="${!custom && c.join() === fx.rgb.join()}"></button>`).join("")}
        <input type="color" id="fxColor" value="${hex(fx.rgb)}" aria-label="Свой цвет" data-tip="Свой цвет">
      </div>
    </div>
    <div class="ctl-row">
      <div class="row between"><h3>Яркость</h3><span class="annot">${BRIGHT[fx.brightness]}</span></div>
      <div class="phases" role="group" aria-label="Яркость">${[0, 1, 2, 3, 4, 5].map((k) => `<button data-b="${k}" aria-pressed="${fx.brightness === k}" aria-label="Яркость ${k}: ${BRIGHT[k]}">${moonPhase(k, 6, 24)}<span>${k}</span></button>`).join("")}</div>
    </div>
    <div class="ctl-row">
      <div class="row between"><h3>Скорость</h3><span class="annot num">${fx.speed} из 5</span></div>
      <input class="range" type="range" min="0" max="5" step="1" id="fxSpeed" value="${fx.speed}" style="--p:${fx.speed * 20}%">
      <div class="ticks">${"<span></span>".repeat(6)}</div>
    </div>
    <div class="ctl-row">
      <h3>Направление</h3>
      <div class="seg" id="fxDir"><button data-d="0" aria-pressed="${!fx.direction}">${icon("right")} Вперёд</button><button data-d="1" aria-pressed="${!!fx.direction}">${icon("left")} Назад</button></div>
    </div>
    <div class="msg" id="fxMsg"></div>
    <p class="note">Изменения сразу уходят в клавиатуру и сохраняются в ней. Названия эффектов взяты из программы производителя по номерам; не все сверены на клавиатуре.</p>`;
  on(side, "click", "[data-c]", (e, b) => { v.fx.rgb = b.dataset.c.split(",").map(Number); v.fx.colorful = 0; sendFx(); });
  $("#fxColor", side).addEventListener("change", (e) => { v.fx.rgb = rgb(e.target.value); v.fx.colorful = 0; sendFx(); });
  $("#fxColorful", side).addEventListener("change", (e) => { v.fx.colorful = e.target.checked ? 1 : 0; sendFx(); });
  on(side, "click", "[data-b]", (e, b) => { v.fx.brightness = +b.dataset.b; sendFx(); });
  const sp = $("#fxSpeed", side);
  sp.addEventListener("input", () => { v.fx.speed = +sp.value; sp.style.setProperty("--p", sp.value * 20 + "%"); side.querySelector(".annot.num").textContent = `${sp.value} из 5`; });
  sp.addEventListener("change", () => sendFx());
  on(side, "click", "[data-d]", (e, b) => { v.fx.direction = +b.dataset.d; sendFx(); });
}

function markActive(mode) {
  $$("#fxGrid .fx", v?.root || document).forEach((el) => {
    const on_ = mode == null ? isActive(+el.dataset.mode) : +el.dataset.mode === mode;
    el.toggleAttribute("data-on", on_); $(".fx-main", el).setAttribute("aria-pressed", on_);
  });
}
function chooseEffect(mode) {
  v.fx.mode = mode;
  markActive(mode);
  v.chart.update({ annot: REACTIVE[mode] ? "нажимай клавиши — превью ответит" : "превью приближённое", annotRight: effectName(mode).toLowerCase() });
  sendFx(false, 700); // с задержкой: каждая запись эффекта сохраняется во флеш клавиатуры, а флеш изнашивается
}

let fxTimer = 0, fxPending = null;
function sendFx(now, delay = 280) {
  renderFxSide();
  clearTimeout(fxTimer);
  fxPending = { ...v.fx };
  if (now) flushFx(); else fxTimer = setTimeout(flushFx, delay);
}
function flushFx() {
  clearTimeout(fxTimer);
  const b = fxPending; fxPending = null;
  if (!b) return;
  const block = blockReason();
  if (block) { revertFx(`${block[0]}. ${block[1]}.`); return; }
  act(null, v && $("#fxMsg", v.root), async () => {
    await post("/api/lighting/effect", b);
    Object.assign(store.server.profile.lighting, b, { kind: "effect" });
    markActive();
    return { message: `На клавиатуре: ${effectName(b.mode)}` };
  }).then((r) => { if (!r) revertFx(); });
}
// Не применилось: панель, галерея и подпись возвращаются к тому, что реально стоит в клавиатуре.
function revertFx(why) {
  if (!v) return;
  const msg = $("#fxMsg", v.root)?.textContent;
  v.fx = fxFromProfile(); renderFxSide(); markActive();
  v.chart.update({ annotRight: effectName(v.fx.mode).toLowerCase() });
  const el = $("#fxMsg", v.root);
  if (el) setMsgSafe(el, why || msg || "Не применилось", "err"); // сообщение ставим после перерисовки, иначе оно пропадёт
}
const setMsgSafe = (el, text, kind) => { el.textContent = text; el.className = `msg ${kind}`; };

async function rename(mode) {
  const name = await promptDialog({ title: `Режим ${mode}`, label: "Как этот эффект выглядит на самом деле?", value: effectName(mode),
    hint: "Пустое поле вернёт название из программы производителя.", confirm: "Сохранить название" });
  if (name === null || !v) return;
  try {
    await post("/api/lighting/name", { mode, name });
    if (!v) return;
    const names = store.server.profile.effect_names;
    if (name) names[mode] = name; else delete names[mode];
    renderEffects();
    toast(name ? `Эффект ${mode} теперь «${name}»` : "Название по умолчанию");
  } catch (e) { toast(e.message, { kind: "err" }); }
}

// ---------- анимация превью на большой карте ----------
let animRaf = 0;
function startAnim(modeFn, paramsFn) {
  stopAnim();
  const g = geometry();
  let last = 0;
  const frame = (now) => {
    animRaf = requestAnimationFrame(frame);
    if (now - last < 50) return; last = now;
    const fills = new Map(), t = reduceMotion() ? 1.2 : now / 1000, p = paramsFn();
    for (const key of g.keys) {
      const c = liveEffectColor(modeFn(), key, t, p);
      fills.set(key.li, Math.max(c[0], c[1], c[2]) > 6 ? c.map((x) => x | 0) : null);
    }
    v?.chart.update({ fills, fillAlpha: .82 });
    if (reduceMotion() && !REACTIVE[modeFn()]) stopAnim();
  };
  animRaf = requestAnimationFrame(frame);
}
function stopAnim() { cancelAnimationFrame(animRaf); animRaf = 0; }

// ================= Свои цвета =================
function renderPaint() {
  refreshPaintChart();
  v.chart.update({ annot: "холст · свои цвета", annotRight: `${Object.keys(v.paint).length} из ${keys().length} клавиш` });
  fresh($("#plateFoot", v.root)).innerHTML = `
    <div class="tools" role="toolbar" aria-label="Инструменты">
      ${[["brush", "brush", "Кисть"], ["row", "layers", "Весь ряд"], ["gradient", "gradient", "Градиент"], ["dropper", "dropper", "Пипетка"], ["eraser", "eraser", "Ластик"]]
        .map(([id, ic, t]) => `<button data-tool="${id}" aria-pressed="${v.tool === id}">${icon(ic)}${t}</button>`).join("")}
    </div><span class="grow"></span>
    <button class="btn quiet small" data-a="fill">${icon("bucket")}Залить всё</button>
    <button class="btn quiet small" data-a="clear">${icon("trash")}Очистить</button>`;
  fresh($("#leftExtra", v.root)).innerHTML = `
    <div class="row between"><h2>Шаблоны</h2><span class="note">Шаблон заменит рисунок; вернуть — «Отменить» в уведомлении.</span></div>
    <div class="sources" style="grid-template-columns:repeat(3,1fr)">${TEMPLATES.map((t) => `<button class="source" data-tpl="${t.id}">${icon("palette")}<b>${t.title}</b><span>${t.desc}</span></button>`).join("")}</div>`;
  const foot = $("#plateFoot", v.root);
  on(foot, "click", "[data-tool]", (e, b) => { v.tool = b.dataset.tool; $$("[data-tool]", foot).forEach((x) => x.setAttribute("aria-pressed", x === b)); });
  on(foot, "click", "[data-a=fill]", () => { const prev = { ...v.paint }; keys().forEach((k) => (v.paint[k.light_index] = [...v.paintColor])); savePaintLocal(); toast("Залито текущим цветом", { undo: () => restorePaint(prev) }); });
  on(foot, "click", "[data-a=clear]", () => { const prev = { ...v.paint }; v.paint = {}; savePaintLocal(); toast("Холст очищен", { undo: () => restorePaint(prev) }); });
  on($("#leftExtra", v.root), "click", "[data-tpl]", (e, b) => applyTemplate(b.dataset.tpl));
  renderPaintSide();
}

function refreshPaintChart() {
  const fills = new Map(Object.entries(v.paint).map(([k, c]) => [+k, c]));
  v.chart.update({ fills, fillAlpha: .9, annotRight: `${fills.size} из ${keys().length} клавиш` });
}
// откат из уведомления: страница может быть уже закрыта — тогда пишем рисунок прямо в хранилище
function restorePaint(prev) {
  if (!v) { local.set("paint", prev); return; }
  v.paint = prev; savePaintLocal(); renderPaintSide();
}

function savePaintLocal() {
  local.set("paint", v.paint); refreshPaintChart();
  const st = v && $("#paintState", v.root); if (st) st.textContent = Object.keys(v.paint).length ? "есть рисунок" : "пусто";
}

function paintKey(k) {
  const li = k.light_index;
  if (v.tool === "dropper") {
    const c = v.paint[li]; if (!c) { toast("Эта клавиша ещё не раскрашена"); return; }
    v.paintColor = c; local.set("paintColor", c); v.tool = "brush"; renderPaint(); toast(`Цвет взят с ${fullName(k)}`); return;
  }
  if (v.tool === "eraser") delete v.paint[li];
  else if (v.tool === "row") keys().filter((x) => x.row === k.row).forEach((x) => (v.paint[x.light_index] = [...v.paintColor]));
  else if (v.tool === "gradient") {
    const g = geometry();
    for (const key of g.keys) {
      const t = key.nx;
      v.paint[key.li] = v.paintColor.map((a, i) => Math.round(a + (v.paintColor2[i] - a) * t));
    }
  } else v.paint[li] = [...v.paintColor];
  savePaintLocal();
}

function renderPaintSide() { keepFocus(() => $("#lightSide", v.root), renderPaintSideNow); }
function renderPaintSideNow() {
  const side = fresh($("#lightSide", v.root));
  side.innerHTML = `
    <div class="k-title"><h2>Свои цвета</h2><span class="annot" id="paintState">${Object.keys(v.paint).length ? "есть рисунок" : "пусто"}</span></div>
    <div class="ctl-row"><h3>Цвет кисти</h3>
      <div class="swatches">${STARS.map(([n, c]) => `<button data-pc="${c.join()}" style="background:${hex(c)}" data-tip="${n}" aria-label="${n}" aria-pressed="${c.join() === v.paintColor.join()}"></button>`).join("")}
        <input type="color" id="pc1" value="${hex(v.paintColor)}" aria-label="Свой цвет кисти"></div></div>
    <div class="ctl-row" ${v.tool === "gradient" ? "" : 'style="opacity:.55"'}><div class="row between"><h3>Второй цвет градиента</h3><input type="color" id="pc2" value="${hex(v.paintColor2)}" aria-label="Второй цвет градиента"></div>
      <p class="note">Градиент идёт слева направо от цвета кисти ко второму цвету.</p></div>
    <div class="ctl-row"><div class="row between"><h3>Яркость при сохранении</h3><span class="annot num">${v.userBright} из 5</span></div>
      <div class="phases">${[0, 1, 2, 3, 4, 5].map((k) => `<button data-ub="${k}" aria-pressed="${v.userBright === k}">${moonPhase(k, 6, 24)}<span>${k}</span></button>`).join("")}</div></div>
    <div class="stack tight">
      <button class="btn" data-a="preview">${icon("eye")}Показать на клавиатуре · 5 с</button>
      <button class="btn primary" data-a="save">Сохранить в клавиатуру</button>
      <span class="msg" id="paintMsg"></span>
    </div>
    <p class="note">Сохранение включает на клавиатуре режим «свои цвета». Вернуть эффект — во вкладке «Эффекты».</p>`;
  on(side, "click", "[data-pc]", (e, b) => { v.paintColor = b.dataset.pc.split(",").map(Number); local.set("paintColor", v.paintColor); renderPaintSide(); });
  $("#pc1", side).addEventListener("change", (e) => { v.paintColor = rgb(e.target.value); local.set("paintColor", v.paintColor); renderPaintSide(); });
  $("#pc2", side).addEventListener("change", (e) => { v.paintColor2 = rgb(e.target.value); local.set("paintColor2", v.paintColor2); });
  on(side, "click", "[data-ub]", (e, b) => { v.userBright = +b.dataset.ub; renderPaintSide(); });
  on(side, "click", "[data-a=preview]", (e, b) => act(b, $("#paintMsg", side), async () => {
    if (!Object.keys(v.paint).length) throw new Error("Холст пустой — раскрась хотя бы одну клавишу.");
    const block = blockReason(); if (block) throw new Error(`${block[0]}. ${block[1]}.`);
    await post("/api/lighting/preview", { colors: v.paint, seconds: 5 });
    return { message: "Горит 5 секунд, ничего не сохранено" };
  }, { busy: "Показываю…" }));
  on(side, "click", "[data-a=save]", (e, b) => act(b, $("#paintMsg", side), async () => {
    if (!Object.keys(v.paint).length) throw new Error("Холст пустой — раскрась хотя бы одну клавишу.");
    const block = blockReason(); if (block) throw new Error(`${block[0]}. ${block[1]}.`);
    const r = await post("/api/lighting/user", { colors: v.paint, brightness: v.userBright });
    Object.assign(store.server.profile.lighting, { kind: "user", user_colors: { ...v.paint }, user_brightness: v.userBright });
    return r;
  }));
}

function applyTemplate(id) {
  const prev = { ...v.paint }, P = {};
  const set = (k, c) => { if (k) P[k.light_index] = c; };
  if (id === "fingers") {
    // зоны слепой печати: мизинцы, безымянные, средние, указательные; большие пальцы — пробел
    const zone = [[255, 90, 70], [255, 170, 80], [120, 220, 140], [96, 160, 255], [96, 160, 255], [120, 220, 140], [255, 170, 80], [255, 90, 70]];
    const cols = { "`": 0, "1": 0, Q: 0, A: 0, Z: 0, Tab: 0, Caps: 0, Shift: 0, "2": 1, W: 1, S: 1, X: 1, "3": 2, E: 2, D: 2, C: 2,
      "4": 3, "5": 3, R: 3, T: 3, F: 3, G: 3, V: 3, B: 3, "6": 4, "7": 4, Y: 4, U: 4, H: 4, J: 4, N: 4, M: 4,
      "8": 5, I: 5, K: 5, ",": 5, "9": 6, O: 6, L: 6, ".": 6, "0": 7, P: 7, ";": 7, "/": 7, "-": 7, "=": 7, "[": 7, "]": 7, "'": 7, "\\": 7, Enter: 7, Backspace: 7 };
    for (const k of keys()) {
      const s = k.name.length === 2 && /^[!@#$%^&*()]\d$/.test(k.name) ? k.name[1] : ({ "~`": "`", "_-": "-", "+=": "=", "{[": "[", "}}": "]", "|\\": "\\", ":;": ";", "\"'": "'", ",<": ",", ".>": ".", "/?": "/", "Caps Lock": "Caps", "Left Shift": "Shift", "Right Shift": "Shift" })[k.name] || k.name;
      if (k.hid >= 0x59 && k.hid <= 0x63 || k.hid === 0x53 || k.hid === 0x54 || k.hid === 0x55 || k.hid === 0x56 || k.hid === 0x57 || k.hid === 0x58) continue;
      if (s in cols) set(k, zone[cols[s]]);
      if (k.name === "Space") set(k, [216, 189, 132]);
    }
  } else if (id === "mods") {
    for (const k of keys()) set(k, [24, 40, 90]);
    for (const h of [0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0x2b, 0x39]) set(keyByHid(h), [216, 189, 132]);
    set(keys().find((k) => k.name === "Fn"), [216, 189, 132]);
  } else if (id === "wasd") {
    for (const k of keys()) set(k, [16, 24, 50]);
    for (const h of [0x1a, 0x04, 0x16, 0x07, 0x4f, 0x50, 0x51, 0x52]) set(keyByHid(h), [255, 120, 50]);
    for (const h of [0x2c, 0xe1, 0xe0, 0x14, 0x08, 0x15, 0x09, 0x29]) set(keyByHid(h), [255, 200, 120]);
  }
  v.paint = P; savePaintLocal(); renderPaintSide();
  toast(`Шаблон «${TEMPLATES.find((t) => t.id === id).title}» на холсте`, { sub: "Проверь и сохрани в клавиатуру", undo: () => restorePaint(prev) });
}

// ================= Живая =================
function renderLive() {
  const sm = store.server.profile.smart;
  fresh($("#plateFoot", v.root)).innerHTML = `<span class="note" id="liveNote"></span>`;
  fresh($("#leftExtra", v.root)).innerHTML = `
    <div class="row between"><h2>Источник</h2><span class="annot" id="liveNow"></span></div>
    <div class="sources" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">${SOURCES.map((s) => `
      <button class="source" data-src="${s.id ?? ""}" aria-pressed="${(sm.software || null) === s.id}">${icon(s.icon)}<b>${s.title}</b><span>${s.desc}</span></button>`).join("")}</div>`;
  on($("#leftExtra", v.root), "click", "[data-src]", (e, b) => setSmart({ software: b.dataset.src || null }, b));
  renderLiveSide();
  livePreview();
  renderLiveState(store.status);
}

function renderLiveSide() { keepFocus(() => $("#lightSide", v.root), renderLiveSideNow); }
function renderLiveSideNow() {
  const sm = store.server.profile.smart, side = fresh($("#lightSide", v.root));
  side.innerHTML = `
    <div class="k-title"><h2>Живая подсветка</h2></div>
    <div class="ctl-row"><div class="row between"><h3>Яркость живых слоёв</h3><span class="annot num" id="lbV">${Math.round(sm.brightness * 100)}%</span></div>
      <input class="range" type="range" min="10" max="100" step="5" id="liveBright" value="${Math.round(sm.brightness * 100)}" style="--p:${(sm.brightness * 100 - 10) / .9}%">
      <p class="note">Касается и сигналов: подсказок, вспышек, таймера.</p></div>
    <div class="ctl-row"><div class="row between"><h3>Цвет для «сплошного»</h3><input type="color" id="solidC" value="${hex(sm.solid_rgb)}"></div></div>
    <div class="msg" id="liveMsg"></div>
    <p class="note">Предел клавиатуры — около 10 кадров в секунду: для Ambilight и индикаторов этого хватает. Подсветка живёт, пока работает сервис; эффект самой клавиатуры при этом не меняется.</p>`;
  const r = $("#liveBright", side);
  r.addEventListener("input", () => { $("#lbV", side).textContent = r.value + "%"; r.style.setProperty("--p", (r.value - 10) / .9 + "%"); });
  r.addEventListener("change", () => setSmart({ brightness: +r.value / 100 }));
  $("#solidC", side).addEventListener("change", (e) => setSmart({ solid_rgb: rgb(e.target.value) }));
}

async function setSmart(patch, btn) {
  const msg = $("#liveMsg", v.root) || $("#lightSide .msg", v.root);
  const r = await act(null, msg, async () => {
    await post("/api/smart", patch);
    Object.assign(store.server.profile.smart, patch);
    return { message: "software" in patch ? (patch.software ? `Источник: ${SOURCES.find((s) => s.id === patch.software).title}` : "Живая подсветка выключена") : "Сохранено" };
  });
  if (r && v) { $$("[data-src]", v.root).forEach((b) => b.setAttribute("aria-pressed", (b.dataset.src || null) === (store.server.profile.smart.software || null))); livePreview(); }
}

let statsTimer = 0;
// «Живая»: на карте зеркало — настоящий кадр сервиса (или эффект клавиатуры, когда источник выключен).
// Здесь — только подписи и пояснения к выбранному источнику.
function livePreview() {
  stopAnim(); clearInterval(statsTimer);
  if (!v.stopMirror) { v.stopMirror = mirror(v.chart, { alpha: .8 }); v.cleanups.push(() => { v.stopMirror?.(); v.stopMirror = null; }); }
  const src = store.server.profile.smart.software;
  const note = $("#liveNote", v.root);
  if (src === "heatmap") {
    const heat = store.status?.heatmap || store.server.heatmap || {};
    v.chart.update({ annot: "тепловая карта", annotRight: `${Object.values(heat).reduce((a, b) => a + b, 0).toLocaleString("ru-RU")} нажатий` });
    note.textContent = store.server.profile.smart.heatmap_count ? "Карта копится, пока включён подсчёт в «Сигналах»." : "Подсчёт нажатий выключен — включи его в разделе «Сигналы», и карта начнёт наполняться.";
  } else if (src === "load") {
    const draw = async () => {
      let s; try { s = await get("/api/stats"); } catch { return; }
      if (!v) return; v.stats = s;
      v.chart.update({ annot: "нагрузка системы", annotRight: `CPU ${Math.round(s.cpu)}% · RAM ${Math.round(s.ram)}%${s.gpu != null ? ` · GPU ${Math.round(s.gpu)}%` : ""}` });
    };
    draw(); statsTimer = setInterval(draw, 1500);
    v.cleanups.push(() => clearInterval(statsTimer));
    note.textContent = "Столбики на цифровом блоке: CPU — левый, RAM — средний, GPU — правый (если видеокарта NVIDIA).";
  } else if (src === "solid") {
    v.chart.update({ annot: "сплошной цвет", annotRight: hex(store.server.profile.smart.solid_rgb) });
    note.textContent = "Ровный фон, поверх которого видны сигналы: подсказки, язык ввода, Claude.";
  } else if (src === "ambilight") {
    v.chart.update({ annot: "ambilight", annotRight: "цвета с экрана" });
    note.textContent = "Рабочий стол сжимается до сетки 19×6 и переходит на клавиши, около 10 раз в секунду.";
  } else {
    v.chart.update({ annot: "живая подсветка выключена", annotRight: effectName(store.server.profile.lighting.mode).toLowerCase() });
    note.textContent = "Сейчас горит то, что сохранено в клавиатуре. Сигналы (подсказки, язык ввода, Claude) всё равно вспыхивают поверх.";
  }
  if (!store.status?.connected) note.textContent = "Клавиатура не подключена — карте нечего показывать. " + note.textContent;
}
function renderLiveState(st) {
  const el = v && $("#liveNow", v.root); if (!el) return;
  el.textContent = st?.live?.overlay ? `сейчас: ${st.live.overlay}` : "";
}
