// Раздел «Экран»: превью экранчика 240×135 в рамке, режим показа и слот; источник — файл, узор, рисунок или готовый фон; правка и заливка.
import { $, $$, esc, on, fmt, hex, rgb, reduceMotion } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { store, on as subscribe, blockReason } from "../core/store.js";
import { get, post, postRaw, humanError } from "../core/api.js";
import { toast, act, setMsg, confirmDialog } from "../core/feedback.js";
import * as ED from "./screen-edit.js";
import * as PT from "./screen-patterns.js";

const W = 240, H = 135;
const ARC = +(2 * Math.PI * 193).toFixed(1);   // длина кольца прогресса в единицах viewBox
const MAX_FRAMES = ED.MAX_FRAMES;  // больше прошивка не принимает
const SEC_PER_FRAME = 2.4;         // замер заливки: ~16 блоков по 4 КБ на кадр
const STYLES = [{ id: "silver", label: "Серебро" }, { id: "gold", label: "Золото" }, { id: "atlas", label: "Атлас" }];
// Набор графики во флеш клавиатуры (04 38): картинки по адресам SPI, превью из tools/build_pack.py.
// Экран статуса: фон — картинка с адреса 0, общая для обоих слотов; значки — по координатам прошивки
// (таблица выводов картинок из прошивки). Дату, проценты и время прошивка пишет своим шрифтом — в превью они примерные.
const GFX_BG = "000000";
const STRIP = [["0115bc", 35, 18], ["01f4f8", 35, 18], ["01aa98", 94, 28], ["016ce8", 94, 28], ["02199c", 29, 28],
  ["01eea0", 29, 28], ["02003c", 29, 28], ["02264c", 29, 28], ["32510a", 49, 29]];

let bgCache = null;   // список готовых фонов не меняется, пока работает сервис
let v = null;

export default {
  id: "screen", title: "Экран", icon: "screen",

  mount(root, ctx) {
    v = {
      root, ctx, slot: scr().slot === 1 ? 1 : 2,
      src: null, origin: null, e: null, etab: "frame", srcTab: "file", preview: false, thumbs: [],
      pat: { id: null, palette: "night", custom: "#e0c48c", seconds: 4, frames: 40, density: 0.5 },
      lib: { items: null, err: "", busy: "", renaming: null, hover: null },
      paint: { cv: null, used: false, tool: "brush", size: 2, color: "#e0c48c", hist: [] },
      plan: null, out: [], gen: 0, rt: null, prep: "", play: { on: true, i: 0, t: null }, strip: null, rend: ED.renderer(),
      bgs: bgCache, bgErr: "", job: store.status?.job || store.server.job || null,
      sending: false, waitSince: 0, doneAt: null, frames: 1, sig: "", offs: [], timers: [],
      gfxSending: false, gfxWait: 0, gfxDoneAt: null, gfxSig: "",
    };
    root.innerHTML = `
      <div class="page screen-page">
        <div class="page-head">
          <div><h1>Экран</h1>
            <p class="lead">Экранчик клавиатуры 240×135. Собери картинку из видео, GIF, живого узора или своего рисунка — экран ниже показывает её пиксель в пиксель, как на клавиатуре.</p></div>
        </div>
        <section class="panel s-now" aria-labelledby="hShow"><div class="panel-body">
          <div class="s-now-grid">
            <div class="stack tight"><h2 id="hShow">Сейчас на клавиатуре</h2><div class="choices" id="modes"></div></div>
            <div class="stack tight"><h3>Слоты</h3><div class="slots" id="slots"></div></div>
          </div>
          <div class="row between wrap s-now-foot">
            <span class="note">Режим и слот переключаются сразу и ничего не стирают — можно пробовать.${scr().auto_time ? " Время сервис ставит сам при каждом подключении." : ""}</span>
            <span class="row"><span class="msg" id="showMsg"></span><span class="msg" id="timeMsg"></span>
              <button class="btn quiet small" id="timeBtn">${icon("clock")}Синхронизировать время</button></span>
          </div>
        </div></section>
        <section class="panel s-lib" aria-labelledby="hLib"><div class="panel-body stack">
          <div class="row between wrap"><h2 id="hLib">Мои видео</h2><span class="note" id="libNote"></span></div>
          <div id="libBody"></div>
          <div class="msg" id="libMsg" aria-live="polite"></div>
        </div></section>
        <div class="s-studio">
          <div class="s-left">
            <section class="s-stage" aria-label="Экран клавиатуры">
              <div class="bezel"><div class="bezel-glass"><div class="lcd" id="lcd" role="img"></div></div>
                <div class="bezel-prog" aria-hidden="true"><i id="prog"></i></div></div>
              <div class="eye-cap" id="eyeCap"></div><span class="sr-only" id="eyeLive" aria-live="polite"></span>
            </section>
            <section class="panel" aria-labelledby="hSrc"><div class="panel-body stack">
              <h2 id="hSrc">Из чего сделать</h2>
              <div class="src-tabs" id="srcTabs" role="group" aria-label="Источник"></div>
              <div id="srcBody"></div>
              <div class="msg" id="srcMsg" aria-live="polite"></div>
            </div></section>
          </div>
          <aside class="s-right">
            <section class="panel" aria-labelledby="hEd"><div class="panel-body stack">
              <h2 id="hEd">Правка</h2>
              <p class="note" id="edEmpty">Выбери, из чего сделать картинку: файл, узор, рисунок или готовый фон. Здесь появятся отрезок, кадр, движение, цвет, текст и кисть.</p>
              <div class="stack ed" id="edBody" hidden>
                <div class="seg ed-tabs" role="tablist" aria-label="Правка" id="edTabs"></div>
                <div id="edPane" role="tabpanel"></div>
              </div>
              <div class="divider"></div>
              <p class="ed-sum" id="edSum" hidden></p>
              <div class="up-row">
                <button class="btn primary" id="upBtn"></button>
                <button class="btn" id="libSave">${icon("download")}В библиотеку</button>
                <span class="msg" id="upMsg" aria-live="polite"></span>
              </div>
              <p class="note" id="upWhy" hidden></p>
              <p class="note">Правки в клавиатуру не пишутся — пробуй сколько угодно. Пишет только «Залить»: каждая заливка расходует ресурс флеш-памяти, поэтому не перезаливай слот чаще раза в несколько минут.</p>
            </div></section>
            <section class="panel" aria-labelledby="hGfx" ${store.server.experimental ? "" : "hidden"}><div class="panel-body stack">
              <h2 id="hGfx">Графика экрана</h2>
              <p class="note">Фон экрана статуса, значки батареи, связи, Caps и Num, анимации поиска, громкость и яркость. Лежат во флеш клавиатуры отдельно от слотов, одни на оба слота.</p>
              <div class="gfx-strip" id="gfxStrip" role="img" aria-label="Значки из набора графики"></div>
              <p class="gfx-state" id="gfxState"></p>
              <div class="up-row">
                <button class="btn" id="gfxBtn"></button>
                <span class="msg" id="gfxMsg" aria-live="polite"></span>
              </div>
              <p class="note" id="gfxWhy" hidden></p>
            </div></section>
          </aside>
        </div>
      </div>`;

    const r = root;
    v.offs.push(
      on($("#modes", r), "click", "[data-mode]", (e, b) => setShow(b.dataset.mode, v.slot, b)),
      on($("#slots", r), "click", "[data-slot]", (e, b) => pickSlot(+b.dataset.slot, b)),
      subscribe("status", onStatus),
    );
    $("#timeBtn", r).onclick = syncTime;
    $("#upBtn", r).onclick = upload;
    $("#gfxBtn", r).onclick = gfxWrite;
    bindEditor(); bindLib();

    renderShow(); renderSource(); renderEditor(); renderLcd(); renderUpload(); renderCaption(); renderGfx(); renderLib(); loadLib();
    if (v.job?.status === "running" && isScreenJob(v.job)) progress(v.job);
    v.timers.push(setInterval(tickClock, 1000));   // прошивка показывает секунды
    if (!v.bgs) loadBgs();

    return () => {
      v.offs.forEach((f) => f()); v.timers.forEach((t) => clearInterval(t));
      stopPlay(); clearTimeout(v.rt); clearTimeout(v.patT); v.thumbs.forEach((f) => f()); libHoverStop();
      v.src?.close(); v.strip?.forEach((b) => b.close());
      v = null;
    };
  },

  onServer() {
    if (!v) return;
    if (!v.sending && !isRunningUpload()) v.slot = scr().slot === 1 ? 1 : 2;
    renderShow(); renderLcd(); renderUpload(); renderCaption(); renderGfx();
  },
};

// ---------- данные ----------
const scr = () => store.server.profile.screen;
const slotInfo = (n) => store.server.slots?.[String(n)] || null;
const connected = () => (store.status ? !!store.status.connected : !!store.server.connected);
const isUpload = (job) => /^Заливка/.test(job?.name || "");
const isGfx = (job) => job?.kind === "gfx";
const isScreenJob = (job) => isUpload(job) || isGfx(job);
const isRunningUpload = () => v?.job?.status === "running" && isUpload(v.job);
// Пока пишется слот или графика, режим и слот не переключаем: клавиатура ответит «занята».
const screenBusy = () => v.sending || v.gfxSending || (v.job?.status === "running" && isScreenJob(v.job));
const gfx = () => store.server.graphics || null;
const wireless = () => !!(store.status ? store.status.wireless : store.server.wireless);
const packUrl = (a) => `/api/screen/pack/${a}.png?v=${encodeURIComponent((gfx()?.pack?.sha256 || "").slice(0, 12))}`;
const thumbUrl = (s) => `${s.thumb}?v=${encodeURIComponent(s.uploaded_at || "")}`;
const framesText = (n) => `${n} ${fmt.plural(n, "кадр", "кадра", "кадров")}`;
const mb = (b) => (b < 1048576 ? `${Math.max(1, Math.ceil(b / 1024))} КБ` : `${(b / 1048576).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`);

function estimate(frames) {
  const s = Math.ceil(Math.min(frames, MAX_FRAMES) * SEC_PER_FRAME);
  return s < 60 ? `≈ ${s} с` : `≈ ${Math.round(s / 60)} мин`;
}

// Что сейчас выбрано во вкладке источника: {kind, name, frames} или null.
function source() {
  if (!v.src) return null;
  return { name: v.src.name, frames: v.plan?.length || ED.plan(v.src, v.e).length };
}

// ---------- экран в рамке ----------
function renderLcd() {
  const lcd = $("#lcd", v.root); if (!lcd) return;
  const src = v.preview ? source() : null;
  const live = !src && scr().display === "live";
  const clock = !src && (scr().display === "clock" || live);   // источник показываем как в «Анимации»: в слоте он виден только там
  if (src) {   // редактор: холст 240×135 с кадрами в цветах экрана
    if (!$("#edCv", lcd)) lcd.innerHTML = `<canvas id="edCv" width="${W}" height="${H}"></canvas>`;
    lcd.classList.add("editing"); lcd.classList.toggle("painting", v.etab === "paint");
    lcd.setAttribute("aria-label", `Превью: ${src.name}. Тащи мышью или стрелками, колесо и плюс-минус — масштаб`);
    paintPreview();
    return;
  }
  lcd.classList.remove("editing", "painting");
  let base;
  if (clock) base = statusScreen(live);
  else {
    const s = slotInfo(v.slot);
    base = s?.thumb ? `<img src="${esc(thumbUrl(s))}" alt="">`
      : `<div class="empty">${v.slot === 1 ? "Заводская анимация<br>её превью у нас нет" : "В слот 2 отсюда ещё не заливали"}</div>`;
  }
  lcd.innerHTML = base;
  lcd.setAttribute("aria-label", src ? `Превью: ${src.name}` : live ? "Живой экран: загрузка GPU и CPU, видеопамять и RAM вместо даты и времени"
    : clock ? "Экран статуса: дата, время, заряд и значки на фоне из набора графики"
    : `Слот ${v.slot}: ${slotInfo(v.slot)?.name || (v.slot === 1 ? "заводская анимация" : "пусто")}`);
  tickClock();
}

// Экран статуса как его собирает прошивка: фон и значки — картинки набора, текст — шрифт прошивки.
function statusScreen(live = false) {
  const tiles = new Set(gfx()?.pack?.tiles || []);
  if (live && !tiles.has("_live")) return `<div class="empty">Фона живого экрана нет в установленной программе<br>переустанови Lunacy Studio</div>`;
  if (!tiles.has(GFX_BG)) return `<div class="empty">Набора графики нет — превью экрана статуса не из чего собрать.<br>Его собирает tools/build_pack.py в репозитории</div>`;
  const lockWin = !!store.server.profile.settings?.disable_win;
  const at = [
    ["0115bc", 197, 6, 35, 18],                          // батарея, полная
    [wireless() ? "016ce8" : "01aa98", 40, 100, 94, 28], // связь: USB или 2.4G
    ["02199c", 8, 100, 29, 28],                          // ОС: WIN
    [lockWin ? "02264c" : "021ff4", 138, 100, 29, 28],   // блокировка Win
    ["01e848", 171, 100, 29, 28],                        // Caps, выключен
    ["01f9e4", 204, 100, 29, 28],                        // Num, выключен
  ].filter(([a]) => tiles.has(a));
  const pos = (x, y, w, h) => `left:${(x / W * 100).toFixed(3)}%;top:${(y / H * 100).toFixed(3)}%;width:${(w / W * 100).toFixed(3)}%;height:${(h / H * 100).toFixed(3)}%`;
  return `<img src="${esc(packUrl(live ? "_live" : GFX_BG))}" alt="">`
    + at.map(([a, x, y, w, h]) => `<img class="spr" src="${esc(packUrl(a))}" alt="" style="${pos(x, y, w, h)}">`).join("")
    + `<span class="w date"></span><span class="w pct">100%</span><span class="w time"></span>`;
}

function tickClock() {
  const lcd = v && $("#lcd", v.root); if (!lcd) return;
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  const t = $(".w.time", lcd), dt = $(".w.date", lcd);
  if (scr().display === "live" && !(v.preview && source())) {
    const sh = store.status?.screen_live?.shown;    // то, что сервис отправил на клавиатуру в последнюю секунду
    if (t) t.textContent = sh ? sh.time : "--:--:--";
    if (dt) dt.textContent = sh ? sh.date : "----/--/--";
    return;
  }
  if (t) t.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  if (dt) dt.textContent = `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

function renderCaption(job) {
  const cap = $("#eyeCap", v.root); if (!cap) return;
  if (job) {
    const pct = job.total ? Math.min(100, Math.floor(job.progress / job.total * 100)) : 0;
    const el = Date.now() / 1000 - (job.started || Date.now() / 1000);
    const guess = isGfx(job) ? gfx()?.seconds || 280 : v.frames * SEC_PER_FRAME;
    const left = job.progress > 0 && job.total ? el * (job.total - job.progress) / job.progress : Math.max(1, guess - el);
    const html = `<span class="pct num">${pct}%</span><span>${esc(job.name)}<br><span class="muted">осталось ≈ ${esc(fmt.left(left))} · отмены нет</span></span>`;
    if (cap.innerHTML !== html) cap.innerHTML = html;
    say(`${job.name}: ${Math.floor(pct / 25) * 25}%`);
    return;
  }
  const src = v.preview ? source() : null;
  const clock = scr().display === "clock", liveNums = scr().display === "live";
  const live = connected() && scr().slot === v.slot;
  const sl = (store.status || store.server).screen_live;
  const g = gfx();
  if (src) {   // редактор: прогресс подготовки кадров не зачитываем каждый раз — только имя превью
    const html = editorCaption(clock);
    if (cap.innerHTML !== html) cap.innerHTML = html;
    say(`Превью: ${src.name}`);
    return;
  }
  const html = liveNums
      ? `<span class="tag ${connected() && sl?.shown ? "ok" : ""}">Живые числа</span><span>${!connected() ? "Клавиатура не подключена" : sl?.error ? `Фон не сменился: ${esc(sl.error)}` : sl?.shown ? "Обновляются раз в секунду" : "Жду первых чисел…"}<br><span class="muted">год — GPU %, день — RAM ГБ, часы — VRAM ГБ, минуты — CPU % (до 79), секунды — пульс</span></span>`
    : clock
      ? `<span class="tag ${connected() ? "ok" : ""}">Часы</span><span>${connected() ? "Экран статуса, один на оба слота" : "Клавиатура не подключена"}<br><span class="muted">${g?.matches ? "фон и значки — залитый набор графики" : "фон и значки — набор графики, в клавиатуре может быть другой"} · дата и время нарисованы примерно</span></span>`
      : `<span class="tag ${live ? "ok" : ""}">Слот ${v.slot}</span><span>${live ? "Сейчас на клавиатуре" : connected() ? "Не показывается — выбери слот, чтобы показать" : "Клавиатура не подключена"}<br><span class="muted">режим «анимация»</span></span>`;
  if (cap.innerHTML !== html) { cap.innerHTML = html; say(cap.textContent); }
}
function say(text) { const el = v && $("#eyeLive", v.root); if (el && el.textContent !== text) el.textContent = text; }

function progress(job) {
  const bar = $("#prog", v.root); if (!bar) return;
  const pct = job.total ? Math.min(100, job.progress / job.total * 100) : 0;
  bar.parentElement.classList.add("on"); bar.style.width = `${Math.max(2, pct)}%`;
  renderCaption(job);
}
function progressOff() {
  const bar = $("#prog", v.root); if (!bar) return;
  bar.parentElement.classList.remove("on"); bar.style.width = "0";
}

// ---------- режим и слот ----------
function renderShow() {
  const s = scr(), lock = screenBusy();
  // У каждого режима — миниатюра того, что окажется на экранчике: так выбор виден, а не описан.
  const tiles = new Set(gfx()?.pack?.tiles || []), sl = slotInfo(v.slot);
  const now = new Date(), hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const thumb = {
    clock: tiles.has(GFX_BG) ? `<img src="${esc(packUrl(GFX_BG))}" alt=""><span class="mt-time">${hm}</span>` : `<span class="mt-empty">${icon("clock")}</span>`,
    gif: sl?.thumb ? `<img src="${esc(thumbUrl(sl))}" alt="">` : `<span class="mt-empty">${icon("play")}<small>${v.slot === 1 ? "заводская" : "слот " + v.slot}</small></span>`,
    live: tiles.has("_live") ? `<img src="${esc(packUrl("_live"))}" alt=""><span class="mt-time">36:12</span>` : `<span class="mt-empty">${icon("cpu")}</span>`,
  };
  // «Живые числа» — экспериментальная функция (перезаписывает фон экрана статуса); уже включённую можно выключить
  const exp = store.server.experimental || s.display === "live";
  $("#modes", v.root).innerHTML = [
    { id: "clock", t: "Часы и статус", d: "время, дата, заряд и значки" },
    { id: "gif", t: "Анимация", d: `картинка слота ${v.slot} во весь экран` },
    ...(exp ? [{ id: "live", t: "Живые числа", d: "нагрузка вместо часов · эксперимент" }] : []),
  ].map((m) => `<button class="mode-card" data-mode="${m.id}" aria-pressed="${s.display === m.id}" ${lock ? 'aria-disabled="true"' : ""}>
    <span class="mode-th" aria-hidden="true">${thumb[m.id]}</span><span class="mode-tx"><b>${m.t}</b><small>${m.d}</small></span></button>`).join("");
  $("#slots", v.root).innerHTML = [1, 2].map((n) => {
    const m = slotInfo(n);
    const name = m ? m.name : n === 1 ? "Заводская анимация" : "Неизвестно";
    const meta = m ? `${framesText(m.frames)} · ${fmt.dateTime(m.uploaded_at)}` : n === 1 ? "из прошивки" : "отсюда не заливали";
    return `<button class="slot" data-slot="${n}" aria-pressed="${v.slot === n}" ${lock ? 'aria-disabled="true"' : ""} >
      <span class="th" ${m?.thumb ? `style="background-image:url(&quot;${esc(thumbUrl(m))}&quot;)"` : ""}>${m?.thumb ? "" : "превью нет"}</span>
      <span class="nm"><b>Слот ${n}</b><span title="${esc(name)}">${esc(name)}</span></span>
      <span class="sm">${esc(meta)}${connected() && s.slot === n ? ` · <span class="ok">на экране</span>` : ""}</span></button>`;
  }).join("");
  const tb = $("#timeBtn", v.root);
  const bl = blockReason(), live = s.display === "live";
  tb.setAttribute("aria-disabled", String(!!bl || live));
  tb.dataset.tip = bl ? bl[0] : live ? "Сейчас на часах живые числа — время вернётся, когда выключишь их" : "Поставить на клавиатуре время компьютера";
}

async function setShow(display, slot, btn) {
  const msg = $("#showMsg", v.root);
  if (btn?.getAttribute("aria-disabled") === "true") { setMsg(msg, "Идёт запись экрана — переключить можно после неё.", "info"); return; }
  if (!connected()) { setMsg(msg, "Клавиатура не подключена — переключить нечего. Подключи кабель, ползунок в центр.", "err"); return; }
  if (display === scr().display && slot === scr().slot) { v.preview = false; renderLcd(); renderCaption(); return; }
  const bg = display === "live" || scr().display === "live";   // вход и выход меняют фон во флеш
  const r = await act(btn, msg, () => post("/api/screen/display", { display, slot }), {
    busy: bg ? "Меняю фон экрана, ≈3 с…" : "Переключаю…", keepText: true,
    ok: display === "gif" ? `На экране анимация слота ${slot}` : display === "live"
      ? "На экране живые числа: GPU % в годе, RAM в дне, VRAM и CPU % на часах" : "На экране часы и статус",
  });
  if (!r || !v) return;
  Object.assign(scr(), { display, slot, live_bg: display === "live" });
  v.slot = slot;
  renderShow(); renderSource(); renderLcd(); renderUpload(); renderCaption();
}

function pickSlot(n, btn) {
  if (btn.getAttribute("aria-disabled") === "true") { setMsg($("#showMsg", v.root), "Идёт запись экрана — переключить можно после неё.", "info"); return; }
  if (!connected()) {   // превью и выбор цели работают и без клавиатуры
    v.slot = n;
    renderShow(); renderSource(); renderLcd(); renderUpload(); renderCaption();
    setMsg($("#showMsg", v.root), "Клавиатура не подключена: слот выбран здесь, на экране клавиатуры он не переключён.", "info");
    return;
  }
  setShow(scr().display, n, btn);
}

async function syncTime(e) {
  const bl = blockReason();
  if (bl) { setMsg($("#timeMsg", v.root), `${bl[0]}. ${bl[1]}.`, "err"); return; }
  if (scr().display === "live") { setMsg($("#timeMsg", v.root), "Сейчас на часах живые числа. Выбери «Часы и статус» — время вернётся само.", "info"); return; }
  await act(e.currentTarget, $("#timeMsg", v.root), () => post("/api/screen/time", {}), { busy: "Ставлю время…", ok: "Время обновлено" });
}

// ---------- источник ----------
const secs = (x) => `${(+x).toLocaleString("ru-RU", { maximumFractionDigits: x < 10 ? 1 : 0 })} с`;
const tc = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, "0")}`; };

function describe(s) {
  const size = s.size ? `${mb(s.size)} · ` : "";
  if (s.kind === "video") return `${size}${s.w}×${s.h} · видео ${secs(s.duration)}`;
  if (s.kind === "anim") return `${size}${s.w}×${s.h} · ${framesText(s.frames)} · ${secs(s.duration)}`;
  return `${size}${s.w}×${s.h} · картинка`;
}

// Четыре способа: файл, узор, рисунок на холсте, готовое. Все ведут в один редактор справа.
const SRC_TABS = [
  { id: "file", ic: "upload", t: "Из файла", d: "видео, GIF, картинка" },
  { id: "patterns", ic: "sparkle", t: "Узоры", d: "живые анимации кодом" },
  { id: "paint", ic: "brush", t: "Рисунок", d: "холст и кисть" },
  { id: "ready", ic: "telescope", t: "Готовое", d: "фоны и карточки" },
];
const CANVAS_BG = [["#000000", "Чёрный"], ["#05080f", "Ночь"], ["#0f1628", "Сумерки"], ["#ffffff", "Белый"]];

function renderSource() {
  const body = $("#srcBody", v.root), s = v.src;
  $("#srcTabs", v.root).innerHTML = SRC_TABS.map((t) => `<button class="src-tab" data-stab="${t.id}" aria-pressed="${v.srcTab === t.id}">${icon(t.ic)}<b>${t.t}</b><small>${t.d}</small></button>`).join("");
  v.thumbs.forEach((f) => f()); v.thumbs = [];
  const back = s && !v.preview ? `<div><button class="btn quiet small" data-a="backToEdit">${icon("eye")}Вернуться к превью</button></div>` : "";
  if (v.srcTab === "file") {
    const fromFile = s && v.origin === "file";
    body.innerHTML = `<div class="stack">
      <label class="drop" id="drop">
        <input type="file" id="fileIn" class="sr-only" accept="${ED.ACCEPT}">
        ${icon("upload")}
        ${fromFile ? `<b class="fname">${esc(s.name)}</b><span>${esc(describe(s))}</span><span class="note">Другой файл — перетащи сюда или щёлкни</span>`
          : `<b>Перетащи видео, GIF или картинку</b><span>или щёлкни, чтобы выбрать · MP4, WebM, MOV, GIF, WebP, PNG, JPG</span>`}
      </label>
      ${fromFile && s.note ? `<p class="note warn">${esc(s.note)}</p>` : ""}${back}</div>`;
    return;
  }
  if (v.srcTab === "patterns") {
    const P = patPalette();
    body.innerHTML = `<div class="stack">
      <div class="pat-grid" role="group" aria-label="Узоры">${PT.PATTERNS.map((x) => `<button class="pat" data-pat="${x.id}" aria-pressed="${v.pat.id === x.id}">
        <canvas aria-hidden="true"></canvas><b>${x.name}</b><small>${x.d}</small></button>`).join("")}</div>
      <div class="pat-ctl">
        <div class="field"><span class="label">Палитра</span><div class="pal-row" role="group" aria-label="Палитра">
          ${PT.PALETTES.map((pl) => `<button class="pal" data-pal="${pl.id}" aria-pressed="${v.pat.palette === pl.id}" aria-label="${pl.name}" data-tip="${pl.name}">${[pl.bg, pl.a, pl.b, pl.c].map((c) => `<i style="background:${c}"></i>`).join("")}</button>`).join("")}
          <label class="pal custom" data-tip="Свой цвет" aria-pressed="${v.pat.palette === "custom"}"><input type="color" id="palCustom" value="${v.pat.custom}" aria-label="Свой цвет палитры"><i style="background:${v.pat.custom}"></i><span>свой</span></label>
        </div></div>
        <div class="pat-ranges">
          ${patRange("pseconds", "Длина петли", 2, 10, 0.5, v.pat.seconds, " с")}
          ${patRange("pframes", "Кадров", 12, 69, 1, v.pat.frames, "")}
          ${patRange("pdensity", "Плотность", 0, 100, 5, Math.round(v.pat.density * 100), "%")}
        </div>
        <p class="note">${v.pat.id ? "Узор уже в превью: меняй палитру и параметры — экран обновится. Текст, цвет и рисунок поверх — в «Правке» справа." : "Выбери узор — он сразу появится на экране. Петля бесшовная: последний кадр переходит в первый без рывка."}</p>
      </div>${back}</div>`;
    $$(".pat", body).forEach((b) => v.thumbs.push(PT.thumb($("canvas", b), b.dataset.pat, P)));
    return;
  }
  if (v.srcTab === "paint") {
    body.innerHTML = `<div class="stack">
      <p class="note">Начни с чистого холста — или рисуй поверх любой картинки, видео или узора: вкладка «Рисунок» в «Правке» работает с любым источником. Рисуешь прямо на экране выше.</p>
      <div class="canvas-row" role="group" aria-label="Чистый холст">${CANVAS_BG.map(([c, t]) => `<button class="canvas-bg" data-canvas="${c}"><i style="background:${c}"></i><span>${t}</span></button>`).join("")}
        <label class="canvas-bg"><input type="color" id="canvasCustom" value="#1e2a48" aria-label="Свой цвет холста"><i class="cc"></i><span>Свой</span></label></div>${back}</div>`;
    return;
  }
  body.innerHTML = `<div class="stack"><h3>Готовые фоны</h3>${bgPicker()}<h3>Фон под текст</h3>${blankPicker()}${back}</div>`;
  drawBlankMinis();
  if (!v.bgs && !v.bgErr) loadBgs();
}

function patRange(k, label, min, max, step, val, unit) {
  return `<div class="field ed-range"><div class="row between"><label for="r-${k}">${label}</label><span class="muted num" id="v-${k}">${String(val).replace(".", ",")}${unit}</span></div>
    <input class="range" type="range" id="r-${k}" data-pk="${k}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${val}" style="--p:${((val - min) / (max - min)) * 100}%"></div>`;
}

function patPalette() { return v.pat.palette === "custom" ? PT.paletteFrom(v.pat.custom) : PT.PALETTES.find((x) => x.id === v.pat.palette) || PT.PALETTES[0]; }

// Узор как источник; параметры меняются — источник пересобирается, правки (текст, цвет, рисунок) остаются.
function applyPattern() {
  if (!v.pat.id) return;
  const src = PT.patternSource(v.pat.id, { palette: patPalette(), seconds: v.pat.seconds, frames: v.pat.frames, density: v.pat.density });
  setSource(src, "pattern");
}
function syncPatternUi() {
  $$("[data-pat]", v.root).forEach((b) => b.setAttribute("aria-pressed", b.dataset.pat === v.pat.id));
}

async function takeCanvas(color) {
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, W, H);
  const cur = v, src = await ED.fromCanvas(cv, "Холст");
  if (v !== cur) { src.close(); return; }
  setSource(src, "paint");
  v.etab = "paint"; renderEditor(); renderLcd();
}

function bgPicker() {
  if (!v.bgs && !v.bgErr) return `<div class="bgs">${"<span class=\"bg sk\"></span>".repeat(5)}</div>`;
  if (v.bgErr) return `<div class="row"><span class="msg err">Не удалось получить список фонов: ${esc(v.bgErr)}</span><button class="btn small" data-a="bgRetry">${icon("refresh")}Повторить</button></div>`;
  if (!v.bgs.length) return `<p class="note">Готовых фонов нет: папка ui/assets/backgrounds пуста.</p>`;
  return `<div class="bgs" role="group" aria-label="Готовые фоны">${v.bgs.map((b) => `<button class="bg" data-bg="${esc(b.id)}" aria-label="${esc(b.label)}" data-tip="${esc(b.label)}"><img src="${esc(b.url)}" alt="" loading="lazy"></button>`).join("")}</div>`;
}

function blankPicker() {
  return `<div class="card-styles" role="group" aria-label="Фон под текст">${STYLES.map((s) => `<button class="cstyle" data-style="${s.id}"><canvas width="${W}" height="${H}"></canvas><span>${s.label}</span></button>`).join("")}</div>`;
}
function drawBlankMinis() { $$(".cstyle", v.root).forEach((b) => drawCard($("canvas", b), { style: b.dataset.style, l1: "", l2: "" })); }

async function takeFile(f) {
  if (!f || !v) return;
  const msg = $("#srcMsg", v.root), cur = v;
  setMsg(msg, ED.kindOf(f) === "video" ? "Открываю видео…" : "Открываю файл…", "info");
  try {
    const src = await ED.open(f);
    if (v !== cur) { src.close(); return; }
    setMsg(msg, "", "");
    setSource(src, "file");
  } catch (e) { if (v === cur) setMsg(msg, e.message, "err"); }
}

async function takeBg(id) {
  const b = v.bgs?.find((x) => x.id === id); if (!b) return;
  const msg = $("#srcMsg", v.root), cur = v;
  try {
    const r = await fetch(b.url);                    // не img.decode(): в фоновой вкладке Chrome его откладывает
    if (!r.ok) throw new Error(String(r.status));
    const bmp = await createImageBitmap(await r.blob());
    const src = await ED.fromCanvas(bmp, b.label);
    bmp.close();
    if (v !== cur) { src.close(); return; }
    setSource(src, "bg");
  } catch { if (v === cur) setMsg(msg, `Фон «${b.label}» не открылся. Обнови страницу и попробуй ещё раз.`, "err"); }
}

async function takeBlank(style) {
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  drawCard(cv, { style, l1: "", l2: "" });
  const cur = v, src = await ED.fromCanvas(cv, `Карточка «${STYLES.find((s) => s.id === style)?.label || style}»`);
  if (v !== cur) { src.close(); return; }
  setSource(src, "card");
  v.etab = "text"; renderEditor();
  $("#edText", v.root)?.focus();
}

function setSource(src, origin) {
  stopPlay();
  v.src?.close(); v.strip?.forEach((b) => b.close()); v.strip = null;
  // новый источник — чистый слой рисунка; смена палитры или параметров узора рисунок не трогает
  if (!(origin === "pattern" && v.origin === "pattern" && v.src?.pattern?.id === src.pattern?.id)) { v.paint.used = false; v.paint.hist = []; v.paint.cv?.getContext("2d").clearRect(0, 0, W, H); }
  v.src = src; v.origin = origin;
  v.e = ED.initFor(src, v.e);
  if (origin === "card" && !v.e.text.s) v.e.text = { ...v.e.text, pos: "center", size: "L", style: "light", band: false };
  v.play.i = 0; v.preview = true;
  if (origin === "pattern" && v.srcTab === "patterns" && $(".pat-grid", v.root)) syncPatternUi(); else renderSource();
  renderEditor();
  rerender(0);
  if (src.kind !== "image") {
    ED.filmstrip(src, 12).then((b) => { if (v?.src === src) { v.strip = b; drawStrip(); } else b.forEach((x) => x.close()); }).catch(() => {});
  }
}

// ---------- редактор ----------
const ETABS = [{ id: "time", label: "Отрезок" }, { id: "frame", label: "Кадр" }, { id: "motion", label: "Движение" },
  { id: "color", label: "Цвет" }, { id: "text", label: "Текст" }, { id: "paint", label: "Рисунок" }];
const PAINT_COLORS = ["#ffffff", "#9ea9c6", "#05080f", "#e0c48c", "#ffd23d", "#ff9a3d", "#ff3d6e", "#e2877a",
  "#ff3df2", "#b27bff", "#6f8fe6", "#3df2ff", "#4fd1ff", "#2fffc0", "#6bff9e", "#8fd3b5"];
const PAINT_TOOLS = [["brush", "brush", "Кисть"], ["eraser", "eraser", "Ластик"], ["fill", "bucket", "Заливка"], ["picker", "dropper", "Пипетка"]];
const SPEEDS = [0.5, 1, 1.5, 2, 3];

function editorTabs() { return ETABS.filter((t) => v.src.kind !== "image" || (t.id !== "time" && t.id !== "motion")); }

function renderEditor() {
  const box = $("#edBody", v.root);
  box.hidden = !v.src;
  const empty = $("#edEmpty", v.root); if (empty) empty.hidden = !!v.src;
  if (!v.src) { renderSummary(); return; }
  const tabs = editorTabs();
  if (!tabs.some((t) => t.id === v.etab)) v.etab = tabs[0].id;
  $("#edTabs", v.root).innerHTML = tabs.map((t) => `<button role="tab" id="et-${t.id}" data-et="${t.id}" aria-selected="${t.id === v.etab}" aria-controls="edPane" tabindex="${t.id === v.etab ? 0 : -1}">${t.label}</button>`).join("");
  const pane = $("#edPane", v.root);
  pane.setAttribute("aria-labelledby", `et-${v.etab}`);
  pane.innerHTML = PANES[v.etab]();
  if (v.etab === "time") { layoutTl(); drawStrip(); }
  renderSummary();
}

function rangeField(k, label, min, max, step, val, unit = "") {
  return `<div class="field ed-range"><div class="row between"><label for="r-${k}">${label}</label><span class="muted num" id="v-${k}">${fmtVal(k, val)}${unit}</span></div>
    <input class="range" type="range" id="r-${k}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}" style="--p:${((val - min) / (max - min)) * 100}%"></div>`;
}
const fmtVal = (k, x) => (["bright", "contrast", "satur"].includes(k) && x > 0 ? `+${x}` : `${x}`);
const segBtns = (attr, items, cur) => items.map(([id, l]) => `<button ${attr}="${id}" aria-pressed="${String(id) === String(cur)}">${l}</button>`).join("");

const PANES = {
  time() {
    const e = v.e, s = v.src;
    const modes = [
      s.kind === "anim" && { id: "orig", ic: "layers", t: "Как в файле", d: "кадры и задержки оригинала" },
      { id: "fragment", ic: "play", t: "Плавный фрагмент", d: `до ${secs(ED.maxSpan(e))} при ${e.fps} к/с` },
      { id: "whole", ic: "next", t: "Весь отрезок, ускоренно", d: `${ED.budget(e)} кадров на весь отрезок` },
    ].filter(Boolean);
    return `<div class="stack">
      <div class="tl" id="tl">
        <canvas class="tl-strip" id="tlStrip" aria-hidden="true"></canvas>
        <div class="tl-sel" id="tlSel" data-tip="Тащи, чтобы сдвинуть отрезок"></div>
        <button class="tl-h" id="tlIn" role="slider" aria-label="Начало отрезка"></button>
        <button class="tl-h" id="tlOut" role="slider" aria-label="Конец отрезка"></button>
        <div class="tl-head" id="tlHead" aria-hidden="true"></div>
      </div>
      <div class="row between tl-nums"><span>Начало <b class="num" id="tlInT"></b></span><span>Длина <b class="num" id="tlLen"></b></span><span>Конец <b class="num" id="tlOutT"></b></span></div>
      <div class="choices" id="edModes">${modes.map((m) => `<button class="choice" data-emode="${m.id}" aria-pressed="${e.mode === m.id}">${icon(m.ic)}<span><b>${m.t}</b><small>${m.d}</small></span></button>`).join("")}</div>
      <p class="note" id="tlNote"></p>
    </div>`;
  },
  frame() {
    const e = v.e;
    return `<div class="stack">
      <div class="seg" role="group" aria-label="Как вписать">${segBtns("data-fit", [["cover", "Заполнить экран"], ["contain", "Целиком, с полями"]], e.fit)}</div>
      ${rangeField("zoom", "Масштаб", 100, 400, 5, Math.round(e.zoom * 100), "%")}
      <div class="row wrap ed-tools">
        <button class="btn quiet small" data-tool="rotL" data-tip="Повернуть влево">${icon("undo")}90°</button>
        <button class="btn quiet small" data-tool="rotR" data-tip="Повернуть вправо">${icon("refresh")}90°</button>
        <button class="btn quiet small" data-tool="flipH" aria-pressed="${e.flipH}">${icon("arrows")}Отразить</button>
        <button class="btn quiet small" data-tool="flipV" aria-pressed="${e.flipV}">${icon("arrows")}Вверх ногами</button>
        <button class="btn quiet small" data-tool="center">${icon("reset")}По центру</button>
      </div>
      ${e.fit === "contain" ? `<div class="field"><span class="label" id="bgcL">Цвет полей</span><div class="seg" role="group" aria-labelledby="bgcL">${segBtns("data-bgc", [["#000000", "Чёрный"], ["#0a1020", "Ночной"], ["#ffffff", "Белый"]], e.bg)}</div></div>` : ""}
      <p class="note">Тащи картинку на экране мышью, колесо — масштаб. С клавиатуры: стрелки двигают, + и − меняют масштаб.</p>
    </div>`;
  },
  motion() {
    const e = v.e;
    return `<div class="stack">
      ${e.mode === "fragment" ? rangeField("fps", "Кадров в секунду", ED.FPS_MIN, ED.FPS_MAX, 1, e.fps) : `<p class="note">${e.mode === "orig" ? "Частота — как в файле." : "Частоту подбирает режим «весь отрезок»: кадры равномерно по отрезку."}</p>`}
      <div class="field"><span class="label" id="spdL">Скорость</span>
        <div class="seg" role="group" aria-labelledby="spdL">${segBtns("data-speed", SPEEDS.map((x) => [x, `${String(x).replace(".", ",")}×`]), e.speed)}</div></div>
      <label class="check"><input type="checkbox" id="edRev" ${e.reverse ? "checked" : ""}> Задом наперёд</label>
      <label class="check"><input type="checkbox" id="edPing" ${e.pingpong ? "checked" : ""}> Туда и обратно — бесшовная петля, своих кадров вдвое меньше</label>
    </div>`;
  },
  color() {
    const e = v.e;
    return `<div class="stack">
      ${rangeField("bright", "Яркость", -100, 100, 5, e.bright)}
      ${rangeField("contrast", "Контраст", -100, 100, 5, e.contrast)}
      ${rangeField("satur", "Насыщенность", -100, 100, 5, e.satur)}
      ${rangeField("sharp", "Резкость", 0, 100, 5, e.sharp)}
      <label class="check"><input type="checkbox" id="edDither" ${e.dither ? "checked" : ""}> Сглаживать полосы</label>
      <p class="note">Экран показывает 65 тысяч цветов, и плавные переходы — небо, тени — без сглаживания идут ступеньками. На экране слева видно ровно то, что покажет клавиатура.</p>
      <div><button class="btn quiet small" data-a="colorReset">${icon("reset")}Сбросить цвет</button></div>
    </div>`;
  },
  text() {
    const t = v.e.text;
    return `<div class="stack">
      <div class="field"><label for="edText">Текст поверх, до двух строк</label>
        <textarea class="textarea" id="edText" rows="2" maxlength="80" placeholder="Например, имя или девиз">${esc(t.s)}</textarea></div>
      <div class="field"><span class="label" id="tpL">Где</span><div class="seg" role="group" aria-labelledby="tpL">${segBtns("data-tpos", [["top", "Сверху"], ["center", "По центру"], ["bottom", "Снизу"]], t.pos)}</div></div>
      <div class="field"><span class="label" id="tsL">Размер</span><div class="seg" role="group" aria-labelledby="tsL">${segBtns("data-tsize", [["S", "Мелко"], ["M", "Средне"], ["L", "Крупно"]], t.size)}</div></div>
      <div class="field"><span class="label" id="tcL">Цвет</span><div class="seg" role="group" aria-labelledby="tcL">${segBtns("data-tstyle", [["light", "Белый"], ["gold", "Золото"], ["silver", "Серебро"], ["dark", "Тёмный"]], t.style)}</div></div>
      <label class="check"><input type="checkbox" id="edBand" ${t.band ? "checked" : ""}> Подложка под текстом — читается на любой картинке</label>
    </div>`;
  },
  paint() {
    const P = v.paint;
    return `<div class="stack">
      <div class="seg paint-tools" role="group" aria-label="Инструмент">${PAINT_TOOLS.map(([id, ic, t]) => `<button data-ptool="${id}" aria-pressed="${P.tool === id}">${icon(ic)}${t}</button>`).join("")}</div>
      <div class="field"><span class="label" id="psL">Толщина</span><div class="seg" role="group" aria-labelledby="psL">${[1, 2, 4, 8].map((n) => `<button data-psize="${n}" aria-pressed="${P.size === n}">${n} px</button>`).join("")}</div></div>
      <div class="field"><span class="label">Цвет</span><div class="swatches" role="group" aria-label="Цвет кисти">${PAINT_COLORS.map((c) => `<button class="sw" data-pcolor="${c}" aria-pressed="${P.color === c}" aria-label="${c}" style="--c:${c}"></button>`).join("")}
        <label class="sw custom" data-tip="Свой цвет"><input type="color" id="pColor" value="${P.color}" aria-label="Свой цвет кисти"><i style="--c:${P.color}"></i></label></div></div>
      <div class="row wrap"><button class="btn small" data-a="p-undo" ${P.hist.length ? "" : "disabled"}>${icon("undo")}Отменить</button>
        <button class="btn small quiet" data-a="p-clear" ${P.used ? "" : "disabled"}>${icon("trash")}Очистить рисунок</button></div>
      <p class="note">Рисуй прямо на экране слева: рисунок ложится поверх каждого кадра — дорисуй узор, видео или фон. Правая кнопка мыши — ластик.</p>
    </div>`;
  }
};

function bindEditor() {
  const box = $("#edBody", v.root), src = $("#srcBody", v.root);
  const edit = (fn, { full = true, pane = false } = {}) => { fn(v.e); if (pane) renderEditor(); else renderSummary(); rerender(full ? 150 : 0); };
  v.offs.push(
    on(src, "change", "#fileIn", (e, el) => { takeFile(el.files[0]); el.value = ""; }),
    on(src, "dragover", "#drop", (e, el) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; el.classList.add("over"); }),
    on(src, "dragleave", "#drop", (e, el) => { if (!el.contains(e.relatedTarget)) el.classList.remove("over"); }),
    on(src, "drop", "#drop", (e, el) => { e.preventDefault(); el.classList.remove("over"); takeFile(e.dataTransfer.files[0]); }),
    on($("#srcTabs", v.root), "click", "[data-stab]", (e, el) => { v.srcTab = el.dataset.stab; renderSource(); }),
    on(src, "click", "[data-pat]", (e, el) => { v.pat.id = el.dataset.pat; applyPattern(); renderSource(); }),
    on(src, "click", "[data-pal]", (e, el) => { v.pat.palette = el.dataset.pal; renderSource(); applyPattern(); }),
    on(src, "change", "#palCustom", (e, el) => { v.pat.custom = el.value; v.pat.palette = "custom"; renderSource(); applyPattern(); }),
    on(src, "input", "[data-pk]", (e, el) => {
      const k = el.dataset.pk, val = +el.value;
      el.style.setProperty("--p", `${((val - +el.min) / (+el.max - +el.min)) * 100}%`);
      $(`#v-${k}`, v.root).textContent = `${String(val).replace(".", ",")}${el.dataset.unit}`;
      if (k === "pseconds") v.pat.seconds = val; else if (k === "pframes") v.pat.frames = val; else v.pat.density = val / 100;
      clearTimeout(v.patT); v.patT = setTimeout(applyPattern, 180);
    }),
    on(src, "click", "[data-canvas]", (e, el) => takeCanvas(el.dataset.canvas)),
    on(src, "change", "#canvasCustom", (e, el) => takeCanvas(el.value)),
    on(src, "click", "[data-bg]", (e, el) => takeBg(el.dataset.bg)),
    on(src, "click", "[data-style]", (e, el) => takeBlank(el.dataset.style)),
    on(src, "click", "[data-a=bgRetry]", () => { v.bgErr = ""; renderSource(); loadBgs(); }),
    on(src, "click", "[data-a=backToEdit]", () => { rerender(0); renderSource(); }),
    on(box, "click", "[data-et]", (e, el) => { v.etab = el.dataset.et; renderEditor(); renderLcd(); }),
    on(box, "click", "[data-ptool]", (e, el) => { v.paint.tool = el.dataset.ptool; renderEditor(); }),
    on(box, "click", "[data-psize]", (e, el) => { v.paint.size = +el.dataset.psize; renderEditor(); }),
    on(box, "click", "[data-pcolor]", (e, el) => { v.paint.color = el.dataset.pcolor; if (v.paint.tool === "eraser" || v.paint.tool === "picker") v.paint.tool = "brush"; renderEditor(); }),
    on(box, "input", "#pColor", (e, el) => { v.paint.color = el.value; el.nextElementSibling?.style.setProperty("--c", el.value); }),
    on(box, "click", "[data-a=p-undo]", () => { const h = v.paint.hist.pop(); if (h) { paintCv().getContext("2d").putImageData(h, 0, 0); v.paint.used = true; } renderEditor(); rerender(0); }),
    on(box, "click", "[data-a=p-clear]", () => { snapshotPaint(); paintCv().getContext("2d").clearRect(0, 0, W, H); v.paint.used = false; renderEditor(); rerender(0); }),
    on(box, "keydown", "[data-et]", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const t = editorTabs(), i = t.findIndex((x) => x.id === v.etab), n = t[(i + (e.key === "ArrowRight" ? 1 : t.length - 1)) % t.length];
      v.etab = n.id; renderEditor(); $(`#et-${n.id}`, v.root).focus();
    }),
    on(box, "click", "[data-emode]", (e, el) => edit((x) => { x.mode = el.dataset.emode; if (x.mode === "orig") { x.in = 0; x.out = v.src.duration; } constrain("out"); }, { pane: true })),
    on(box, "click", "[data-fit]", (e, el) => edit((x) => { x.fit = el.dataset.fit; x.zoom = 1; x.cx = x.cy = 0.5; }, { pane: true })),
    on(box, "click", "[data-bgc]", (e, el) => edit((x) => { x.bg = el.dataset.bgc; }, { pane: true })),
    on(box, "click", "[data-speed]", (e, el) => edit((x) => { x.speed = +el.dataset.speed; constrain("out"); }, { pane: true })),
    on(box, "click", "[data-tool]", (e, el) => edit((x) => {
      const t = el.dataset.tool;
      if (t === "rotL") x.rotate = (x.rotate + 270) % 360;
      if (t === "rotR") x.rotate = (x.rotate + 90) % 360;
      if (t === "flipH") x.flipH = !x.flipH;
      if (t === "flipV") x.flipV = !x.flipV;
      if (t === "center" || t.startsWith("rot")) { x.cx = x.cy = 0.5; x.zoom = t === "center" ? 1 : x.zoom; }
    }, { pane: true })),
    on(box, "input", "[data-k]", (e, el) => {
      const k = el.dataset.k, val = +el.value;
      el.style.setProperty("--p", `${((val - +el.min) / (+el.max - +el.min)) * 100}%`);
      $(`#v-${k}`, v.root).textContent = `${fmtVal(k, val)}${k === "zoom" ? "%" : ""}`;
      edit((x) => { if (k === "zoom") x.zoom = val / 100; else x[k] = val; if (k === "fps") constrain("out"); });
    }),
    on(box, "change", "#edRev", (e, el) => edit((x) => { x.reverse = el.checked; })),
    on(box, "change", "#edPing", (e, el) => edit((x) => { x.pingpong = el.checked; constrain("out"); })),
    on(box, "change", "#edDither", (e, el) => edit((x) => { x.dither = el.checked; })),
    on(box, "click", "[data-a=colorReset]", () => edit((x) => { x.bright = x.contrast = x.satur = x.sharp = 0; x.dither = true; }, { pane: true })),
    on(box, "input", "#edText", (e, el) => edit((x) => { x.text = { ...x.text, s: el.value }; })),
    on(box, "click", "[data-tpos]", (e, el) => edit((x) => { x.text = { ...x.text, pos: el.dataset.tpos }; }, { pane: true })),
    on(box, "click", "[data-tsize]", (e, el) => edit((x) => { x.text = { ...x.text, size: el.dataset.tsize }; }, { pane: true })),
    on(box, "click", "[data-tstyle]", (e, el) => edit((x) => { x.text = { ...x.text, style: el.dataset.tstyle }; }, { pane: true })),
    on(box, "change", "#edBand", (e, el) => edit((x) => { x.text = { ...x.text, band: el.checked }; })),
  );
  bindTimeline(box);
  bindLcd();
  const stop = (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); };   // файл мимо зоны не открывать вместо Studio
  window.addEventListener("dragover", stop); window.addEventListener("drop", stop);
  v.offs.push(() => { window.removeEventListener("dragover", stop); window.removeEventListener("drop", stop); });
}

// Плавный фрагмент не может быть длиннее бюджета: двигаем другую ручку.
function constrain(moved) {
  const e = v.e, d = v.src?.duration || 0;
  if (!d) return;
  const min = Math.min(d, 0.1);
  e.in = Math.max(0, Math.min(e.in, d - min)); e.out = Math.min(d, Math.max(e.out, e.in + min));
  if (e.mode === "fragment") {
    const ms = ED.maxSpan(e);
    if (e.out - e.in > ms) { if (moved === "in") e.out = e.in + ms; else e.in = Math.max(0, e.out - ms); }
  }
}

// ---------- шкала времени ----------
function layoutTl() {
  const tl = $("#tl", v.root); if (!tl || !v.src) return;
  const d = v.src.duration, e = v.e, pct = (t) => `${(t / d) * 100}%`;
  $("#tlSel", tl).style.left = pct(e.in); $("#tlSel", tl).style.width = pct(e.out - e.in);
  $("#tlIn", tl).style.left = pct(e.in); $("#tlOut", tl).style.left = pct(e.out);
  for (const [id, t] of [["tlIn", e.in], ["tlOut", e.out]]) {
    const h = $(`#${id}`, tl);
    h.setAttribute("aria-valuemin", "0"); h.setAttribute("aria-valuemax", d.toFixed(2));
    h.setAttribute("aria-valuenow", t.toFixed(2)); h.setAttribute("aria-valuetext", tc(t));
  }
  $("#tlInT", v.root).textContent = tc(e.in); $("#tlOutT", v.root).textContent = tc(e.out);
  $("#tlLen", v.root).textContent = secs(e.out - e.in);
  const s = ED.summary(v.src, e), note = $("#tlNote", v.root);
  if (note) {
    note.textContent = e.mode === "fragment"
      ? `Тащи ручки или весь отрезок. Влезает до ${secs(ED.maxSpan(e))}: длиннее ручки не разойдутся. Нужно длиннее — убавь кадры в секунду или ускорь во вкладке «Движение».`
      : e.mode === "whole"
        ? `${framesText(s.unique)} равномерно по отрезку, на экране в ${s.speedup.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} раза быстрее.`
        : `В отрезке ${framesText(s.unique)}${v.src.frames > ED.MAX_FRAMES ? `, в файле ${v.src.frames} — уместятся первые ${ED.budget(e)}` : ""}.`;
  }
  playhead();
}

function playhead() {
  const head = $("#tlHead", v.root); if (!head || !v.src?.duration) return;
  const f = v.plan?.[v.play.i];
  head.style.left = f ? `${(f.t / v.src.duration) * 100}%` : "0";
}

function drawStrip() {
  const cv = $("#tlStrip", v.root); if (!cv) return;
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
  const g = cv.getContext("2d");
  g.fillStyle = "#05080f"; g.fillRect(0, 0, cv.width, cv.height);
  if (!v.strip?.length) return;
  const w = cv.width / v.strip.length;
  v.strip.forEach((b, i) => {
    const k = Math.max(w / b.width, cv.height / b.height), dw = b.width * k, dh = b.height * k;
    g.save(); g.beginPath(); g.rect(i * w, 0, w, cv.height); g.clip();
    g.drawImage(b, i * w + (w - dw) / 2, (cv.height - dh) / 2, dw, dh); g.restore();
  });
}

function bindTimeline(box) {
  let drag = null;
  const timeAt = (x) => { const r = $("#tl", v.root).getBoundingClientRect(); return Math.min(1, Math.max(0, (x - r.left) / r.width)) * v.src.duration; };
  const apply = (moved) => { constrain(moved); layoutTl(); renderSummary(); v.play.i = 0; rerender(250); };
  v.offs.push(
    on(box, "pointerdown", "#tl", (e, tl) => {
      if (!v.src?.duration || e.button !== 0) return;
      const t = timeAt(e.clientX), id = e.target.id;
      if (id === "tlIn" || id === "tlOut") drag = { kind: id === "tlIn" ? "in" : "out" };
      else if (id === "tlSel") drag = { kind: "move", off: t - v.e.in, len: v.e.out - v.e.in };
      else { const len = v.e.out - v.e.in; v.e.in = Math.max(0, Math.min(t - len / 2, v.src.duration - len)); v.e.out = v.e.in + len; apply("in"); drag = { kind: "move", off: t - v.e.in, len }; }
      tl.setPointerCapture(e.pointerId); e.preventDefault();
    }),
    on(box, "pointermove", "#tl", (e) => {
      if (!drag) return;
      const t = timeAt(e.clientX), d = v.src.duration;
      if (drag.kind === "in") v.e.in = Math.min(t, v.e.out - 0.1);
      else if (drag.kind === "out") v.e.out = Math.max(t, v.e.in + 0.1);
      else { v.e.in = Math.max(0, Math.min(t - drag.off, d - drag.len)); v.e.out = v.e.in + drag.len; }
      apply(drag.kind === "move" ? "in" : drag.kind);
    }),
    on(box, "pointerup", "#tl", () => { drag = null; }),
    on(box, "pointercancel", "#tl", () => { drag = null; }),
    on(box, "keydown", ".tl-h", (e, el) => {
      const step = e.shiftKey ? 1 : 0.1, k = el.id === "tlIn" ? "in" : "out", d = v.src.duration;
      const map = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step };
      if (e.key in map) v.e[k] += map[e.key];
      else if (e.key === "Home") v.e[k] = k === "in" ? 0 : v.e.in + 0.1;
      else if (e.key === "End") v.e[k] = k === "out" ? d : v.e.out - 0.1;
      else return;
      e.preventDefault();
      if (k === "in") v.e.in = Math.min(v.e.in, v.e.out - 0.1); else v.e.out = Math.max(v.e.out, v.e.in + 0.1);
      apply(k);
    }),
  );
  const ro = new ResizeObserver(() => drawStrip());
  ro.observe($("#edBody", v.root));
  v.offs.push(() => ro.disconnect());
}

// ---------- экран: перетаскивание, масштаб, кисть ----------
function bindLcd() {
  const lcd = $("#lcd", v.root);
  let drag = null;
  const editing = () => v.src && v.preview;
  const nudge = (dx, dy) => { Object.assign(v.e, ED.pan({ width: v.src.w, height: v.src.h }, v.e, dx, dy)); rerender(200, true); };
  const zoomBy = (k) => {
    v.e.zoom = Math.min(4, Math.max(1, +(v.e.zoom * k).toFixed(3)));
    const r = $("#r-zoom", v.root);
    if (r) { r.value = Math.round(v.e.zoom * 100); r.style.setProperty("--p", `${((v.e.zoom - 1) / 3) * 100}%`); $("#v-zoom", v.root).textContent = `${Math.round(v.e.zoom * 100)}%`; }
    renderSummary(); rerender(250, true);
  };
  lcd.tabIndex = 0;
  const at = (e) => { const r = lcd.getBoundingClientRect();
    return { x: Math.max(0, Math.min(W - 1, Math.floor((e.clientX - r.left) / r.width * W))), y: Math.max(0, Math.min(H - 1, Math.floor((e.clientY - r.top) / r.height * H))) }; };
  v.offs.push(
    on(lcd, "pointerdown", "canvas", (e) => {
      if (!editing()) return;
      if (v.etab === "paint") {
        e.preventDefault();
        const p = at(e), tool = v.paint.tool, erase = e.button === 2 || tool === "eraser";
        if (tool === "picker" && e.button === 0) { pickColor(p.x, p.y); return; }
        snapshotPaint();
        if (tool === "fill" && e.button === 0) { floodFill(p.x, p.y); v.paint.used = true; renderEditor(); rerender(0); return; }
        v.paint.used = true; drag = { paint: true, last: p, erase }; paintLine(p, p, erase);
        lcd.setPointerCapture(e.pointerId); rerender(400, true); return;
      }
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY }; lcd.setPointerCapture(e.pointerId); lcd.classList.add("grabbing");
    }),
    on(lcd, "pointermove", "canvas", (e) => {
      if (!drag) return;
      if (drag.paint) { const p = at(e); paintLine(drag.last, p, drag.erase); drag.last = p; rerender(400, true); return; }
      const k = W / lcd.getBoundingClientRect().width;
      nudge((e.clientX - drag.x) * k, (e.clientY - drag.y) * k);
      drag = { x: e.clientX, y: e.clientY };
    }),
  );
  const up = () => { if (drag?.paint) { renderEditor(); rerender(0); } drag = null; lcd.classList.remove("grabbing"); };
  const noMenu = (e) => { if (editing() && v.etab === "paint") e.preventDefault(); };
  lcd.addEventListener("contextmenu", noMenu); v.offs.push(() => lcd.removeEventListener("contextmenu", noMenu));
  lcd.addEventListener("pointerup", up); lcd.addEventListener("pointercancel", up);
  const wheel = (e) => { if (!editing()) return; e.preventDefault(); zoomBy(Math.pow(1.1, -e.deltaY / 100)); };
  lcd.addEventListener("wheel", wheel, { passive: false });
  const key = (e) => {
    if (!editing()) return;
    const m = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -4], ArrowDown: [0, 4] }[e.key];
    if (m) { e.preventDefault(); nudge(m[0], m[1]); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.1); }
    else if (e.key === "-") { e.preventDefault(); zoomBy(1 / 1.1); }
  };
  lcd.addEventListener("keydown", key);
  v.offs.push(() => { lcd.removeEventListener("pointerup", up); lcd.removeEventListener("pointercancel", up); lcd.removeEventListener("wheel", wheel); lcd.removeEventListener("keydown", key); });
  const cap = $("#eyeCap", v.root);
  v.offs.push(on(cap, "click", "[data-a=play]", () => { v.play.on = !v.play.on; if (v.play.on) startPlay(); else stopPlay(); renderCaption(); }));
}

// ---------- кисть: слой 240×135 поверх кадров ----------
function paintCv() {
  if (!v.paint.cv) { const c = document.createElement("canvas"); c.width = W; c.height = H; v.paint.cv = c; }
  return v.paint.cv;
}
function snapshotPaint() {
  const g = paintCv().getContext("2d", { willReadFrequently: true });
  v.paint.hist.push(g.getImageData(0, 0, W, H));
  if (v.paint.hist.length > 40) v.paint.hist.shift();
}
function paintLine(a, b, erase) {
  const g = paintCv().getContext("2d"), s = v.paint.size, o = Math.floor(s / 2);
  const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  g.fillStyle = v.paint.color;
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0, x = Math.round(a.x + (b.x - a.x) * t) - o, y = Math.round(a.y + (b.y - a.y) * t) - o;
    if (erase) g.clearRect(x, y, s, s); else g.fillRect(x, y, s, s);
  }
}
// Заливка: область считается по тому, что видно на экране сейчас (кадр вместе с рисунком), красится в слой рисунка.
// Допуск небольшой — после перевода в 65 тысяч цветов соседние пиксели «одного» цвета чуть различаются.
function floodFill(x0, y0) {
  const g = paintCv().getContext("2d", { willReadFrequently: true }), id = g.getImageData(0, 0, W, H), d = id.data;
  const fr = v.out[v.play.i] || v.out.find(Boolean), s = fr ? fr.preview.data : d;
  const at = (x, y) => (y * W + x) * 4, i0 = at(x0, y0), t = [s[i0], s[i0 + 1], s[i0 + 2], s[i0 + 3]];
  const [r, gg, b] = rgb(v.paint.color), TOL = 24;
  const same = (i) => Math.abs(s[i] - t[0]) + Math.abs(s[i + 1] - t[1]) + Math.abs(s[i + 2] - t[2]) <= TOL && (fr || s[i + 3] === t[3]);
  const seen = new Uint8Array(W * H), stack = [x0, y0];
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H || seen[y * W + x]) continue;
    seen[y * W + x] = 1;
    const i = at(x, y); if (!same(i)) continue;
    d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  g.putImageData(id, 0, 0);
}
function pickColor(x, y) {
  const fr = v.out[v.play.i] || v.out.find(Boolean); if (!fr) return;
  const p = fr.preview.data, i = (y * W + x) * 4;
  v.paint.color = hex([p[i], p[i + 1], p[i + 2]]); v.paint.tool = "brush";
  renderEditor();
}

// ---------- рендер и проигрывание превью ----------
// Любая правка: новый план кадров, текущий кадр рисуется сразу, остальные — следом, в фоне.
function rerender(delay = 150, quickOnly = false) {
  if (!v?.src) return;
  clearTimeout(v.rt);
  const gen = ++v.gen;
  v.preview = true;
  v.plan = ED.plan(v.src, v.e);
  v.out = [];
  v.play.i = Math.min(v.play.i, v.plan.length - 1);
  renderLcd(); renderSummary(); renderCaption(); renderUpload(); playhead();
  quick(gen);
  v.rt = setTimeout(() => renderAll(gen), quickOnly ? Math.max(delay, 200) : delay);
}

async function frameAt(i, gen) {
  const img = await v.src.frameAt(v.plan[i].t);
  if (!v || gen !== v.gen) return null;
  return ED.to565(v.rend.draw(img, v.e, v.paint.used ? v.paint.cv : null), v.e.dither);
}

async function quick(gen) {
  try {
    const r = await frameAt(v.play.i, gen);
    if (r && v && gen === v.gen) { v.out[v.play.i] = r; paintPreview(); }
  } catch (e) { if (v && gen === v.gen) setMsg($("#srcMsg", v.root), e.message, "err"); }
}

async function renderAll(gen) {
  try {
    for (let i = 0; v && gen === v.gen && i < v.plan.length; i++) {
      if (v.out[i]) continue;
      const r = await frameAt(i, gen);
      if (!r || !v || gen !== v.gen) return;
      v.out[i] = r;
      if (i % 3 === 0) renderCaption();
      if (i % 6 === 5) await new Promise((res) => setTimeout(res));   // не замораживаем страницу на длинных планах
    }
  } catch (e) { if (v && gen === v.gen) setMsg($("#srcMsg", v.root), e.message, "err"); return; }
  if (!v || gen !== v.gen) return;
  renderCaption(); renderUpload();
  startPlay();
}

function ready() { return v.plan ? v.plan.reduce((a, _, i) => a + (v.out[i] ? 1 : 0), 0) : 0; }

function paintPreview() {
  const cv = $("#edCv", v.root); if (!cv) return;
  const r = v.out[v.play.i] || v.out.find(Boolean);
  if (r) cv.getContext("2d").putImageData(r.preview, 0, 0);
  playhead();
}

function startPlay() {
  stopPlay();
  if (!v?.src || !v.play.on || (v.plan?.length || 0) < 2) { if (v) paintPreview(); return; }
  const step = () => {
    if (!v) return;
    paintPreview();
    v.play.t = setTimeout(() => {
      if (!v) return;
      let j = (v.play.i + 1) % v.plan.length;
      if (!v.out[j]) j = 0;
      v.play.i = j; step();
    }, v.plan[v.play.i]?.delay || 100);
  };
  step();
}
function stopPlay() { if (v?.play.t) { clearTimeout(v.play.t); v.play.t = null; } }

function renderSummary() {
  const el = $("#edSum", v.root); if (!el) return;
  if (!v.src) { el.textContent = ""; el.hidden = true; return; }
  const s = ED.summary(v.src, v.e);
  el.hidden = false;
  if (s.frames === 1) { el.innerHTML = `<b>1 кадр</b> · картинка без движения · заливка ${estimate(1)}`; return; }
  el.innerHTML = `<b>${framesText(s.frames)}</b> · петля ${secs(s.loop)}${s.frames > 1 && Math.abs(s.speedup - 1) > 0.05 ? ` · ×${s.speedup.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} к оригиналу` : ""} · заливка ${estimate(s.frames)}`;
}

function editorCaption(clock) {
  const s = ED.summary(v.src, v.e), r = ready(), n = v.plan?.length || s.frames;
  const status = r < n ? `готовлю кадры: ${r} из ${n}` : n === 1 ? "картинка без движения" : `${framesText(n)} · петля ${secs(s.loop)}`;
  const btn = n > 1 ? `<button class="btn quiet small eye-play" data-a="play" aria-label="${v.play.on ? "Пауза" : "Играть"}">${icon(v.play.on ? "pause" : "play")}</button>` : "";
  return `<span class="tag warn">Превью</span><span>${esc(v.src.name)} · ещё не залито<br><span class="muted">${status}${clock ? " · видно в режиме «Анимация»" : ""}</span></span>${btn}`;
}

async function loadBgs() {
  try { bgCache = await get("/api/screen/backgrounds"); if (v) { v.bgs = bgCache; v.bgErr = ""; } }
  catch (e) { if (v) v.bgErr = e.message; }
  if (v && v.srcTab === "ready") renderSource();
}

// ---------- карточка ----------
const CARD = {
  silver: { bg: "#070b16", fg: "#e6ebf7", line: "rgba(196,207,232,.5)", line2: "rgba(196,207,232,.2)", star: "196,207,232" },
  gold: { bg: "#0b0e1a", fg: "#ecd6a6", line: "rgba(216,189,132,.6)", line2: "rgba(216,189,132,.25)", star: "236,214,166" },
  atlas: { bg: "#08101f", fg: "#c4cfe8", line: "rgba(196,207,232,.35)", line2: "rgba(196,207,232,.09)", star: "196,207,232" },
};
const STARS = (() => {   // постоянное «небо», чтобы картинка не менялась от перерисовки
  let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 22 }, () => [r() * W, r() * H, .35 + r() * .8, .25 + r() * .6]);
})();

function drawCard(cv, card) {
  const g = cv.getContext("2d"), S = CARD[card.style] || CARD.silver;
  g.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
  g.fillStyle = S.bg; g.fillRect(0, 0, W, H);
  g.lineWidth = 1;
  if (card.style === "atlas") {
    g.strokeStyle = S.line2; g.beginPath();
    for (let x = 20; x < W; x += 20) { g.moveTo(x + .5, 0); g.lineTo(x + .5, H); }
    for (let y = 15; y < H; y += 20) { g.moveTo(0, y + .5); g.lineTo(W, y + .5); }
    g.stroke();
    g.strokeStyle = S.line; g.beginPath();
    for (let x = 10; x < W; x += 10) { const l = x % 50 ? 2 : 4; g.moveTo(x + .5, 0); g.lineTo(x + .5, l); g.moveTo(x + .5, H); g.lineTo(x + .5, H - l); }
    g.stroke();
  }
  for (const [x, y, rad, a] of STARS) { g.fillStyle = `rgba(${S.star},${a})`; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); }
  if (card.style !== "atlas") {
    g.strokeStyle = S.line; g.strokeRect(5.5, 5.5, W - 11, H - 11);
    g.strokeStyle = S.line2; g.strokeRect(8.5, 8.5, W - 17, H - 17);
    if (card.style === "gold") {   // гравированные уголки
      g.strokeStyle = S.line; g.beginPath();
      for (const [x, y, dx, dy] of [[12, 12, 1, 1], [W - 12, 12, -1, 1], [12, H - 12, 1, -1], [W - 12, H - 12, -1, -1]]) {
        g.moveTo(x + .5, y + 8 * dy + .5); g.lineTo(x + .5, y + .5); g.lineTo(x + 8 * dx + .5, y + .5);
      }
      g.stroke();
    }
  }
  const lines = [card.l1, card.l2].map((s) => (s || "").trim()).filter(Boolean);
  if (!lines.length) return;
  const serif = '"Sitka Display", "Sitka Heading", Georgia, serif';
  const fit = (t, size, weight) => { let s = size; do { g.font = `${weight} ${s}px ${serif}`; } while (g.measureText(t).width > W - 30 && --s > 8); return s; };
  g.fillStyle = S.fg; g.textAlign = "center"; g.textBaseline = "alphabetic";
  const sizes = lines.map((t, i) => fit(t, i === 0 ? 26 : 15, i === 0 ? 500 : 400));
  const total = sizes.reduce((a, s) => a + s, 0) + (lines.length - 1) * 8;
  let y = (H - total) / 2;
  lines.forEach((t, i) => { y += sizes[i]; g.font = `${i === 0 ? 500 : 400} ${sizes[i]}px ${serif}`; g.fillText(t, W / 2, y - sizes[i] * .12); y += 8; });
  if (lines.length > 1) {   // тонкая гравированная черта между строками
    const yl = (H - total) / 2 + sizes[0] + 4;
    g.strokeStyle = S.line2; g.beginPath(); g.moveTo(W / 2 - 30, yl + .5); g.lineTo(W / 2 + 30, yl + .5); g.stroke();
  }
}

// ---------- заливка ----------
function upState() {
  const job = v.job;
  if (v.sending) return { busy: "send" };
  if (v.gfxSending) return { why: "Сейчас запускается запись графики экрана. Заливка станет доступна, когда она закончится." };
  if (job?.status === "running") return isUpload(job) ? { busy: "job" } : { why: `Сейчас идёт «${job.name}». Заливка станет доступна, когда она закончится.` };
  if (!connected()) return { why: "Клавиатура не подключена: превью работает, а заливать некуда. Подключи кабель, ползунок в центр." };
  if (!v.src) return { why: "Открой видео, GIF или картинку — или начни с готового фона." };
  return { ok: true, src: source() };
}

function renderUpload() {
  const btn = $("#upBtn", v.root); if (!btn) return;
  const s = upState(), job = v.job;
  const pct = s.busy === "job" && job.total ? Math.floor(job.progress / job.total * 100) : 0;
  const sig = JSON.stringify([s, v.slot, pct, v.prep]);
  if (sig === v.sig) return;
  v.sig = sig;
  btn.classList.toggle("busy", !!s.busy);
  btn.toggleAttribute("aria-busy", !!s.busy);
  btn.setAttribute("aria-disabled", String(!s.ok));
  if (s.busy === "send") btn.textContent = v.prep ? `Готовлю кадры… ${v.prep}` : "Отправляю…";
  else if (s.busy === "job") btn.textContent = `Заливаю… ${pct}%`;
  else btn.innerHTML = `${icon("upload")}Залить в слот ${v.slot}${s.ok ? ` <span class="est">${estimate(s.src.frames)}</span>` : ""}`;
  const why = $("#upWhy", v.root);
  why.hidden = !s.why; why.textContent = s.why || "";
}

// Все кадры текущего плана: недостающие дорисовываем. Правка посреди подготовки — начать заново.
async function ensureAll() {
  const gen = v.gen;
  for (let i = 0; i < v.plan.length; i++) {
    if (!v.out[i]) {
      const r = await frameAt(i, gen);
      if (!v || gen !== v.gen || !r) throw new Error("Правка поменялась, пока готовились кадры. Нажми «Залить» ещё раз.");
      v.out[i] = r;
    }
    v.prep = `${i + 1}/${v.plan.length}`; renderUpload();
  }
  return v.plan.map((f, i) => ({ bytes: v.out[i].bytes, delay: f.delay }));
}

async function upload() {
  const msg = $("#upMsg", v.root);
  const s = upState();
  if (s.busy) return;
  if (!s.ok) { setMsg(msg, s.why, "err"); return; }
  const slot = v.slot, cur = v, name = v.src.name;
  if (!slotInfo(slot)) {
    const ok = await confirmDialog({
      title: `Залить поверх слота ${slot}?`, danger: true, confirm: "Залить",
      body: slot === 1
        ? "В слоте 1 сейчас заводская анимация. Заливка сотрёт её, а вернуть её нечем: её нет даже в фирменной программе."
        : "В слоте сейчас то, что залито не из Lunacy Studio. Заливка сотрёт его, и вернуть прежнее будет нечем.",
    });
    if (!ok || v !== cur) return;
  }
  v.sending = true; v.prep = ""; v.waitSince = Date.now() / 1000;
  setMsg(msg, "", ""); renderUpload(); renderShow();
  try {
    const frames = await ensureAll();
    v.frames = frames.length; v.prep = ""; renderUpload();
    const res = await postRaw("/api/screen/upload_frames", new Blob(frames.map((f) => f.bytes)), {
      "X-Slot": String(slot), "X-Delays": frames.map((f) => f.delay).join(","),
      "X-Filename": encodeURIComponent(name), "X-Source": v.origin || "file",
    });
    if (res?.note) toast("Заливаю, но есть нюанс", { sub: res.note.charAt(0).toUpperCase() + res.note.slice(1), kind: "err" });
    if (v !== cur) return; // ушли с «Экрана» — итог покажет каркас тостом
    v.job = { name: `Заливка «${name}» в слот ${slot}`, status: "running", progress: 0, total: 0, started: Date.now() / 1000 };
    v.sending = false;
    progress(v.job);
  } catch (err) {
    if (v !== cur) return;
    v.sending = false; v.prep = ""; v.waitSince = 0;
    setMsg(msg, err.message, "err");
  }
  renderUpload(); renderShow();
}

// ---------- библиотека: свои видео, готовые для слота (studio/library.py) ----------
// Всё, что заливаешь, сервис кладёт сюда сам; «В библиотеку» сохраняет без заливки. Переключиться — одна заливка.
const libCache = new Map();          // id → массив ImageData (последние три — для оживших миниатюр и редактора)

function loopText(ms) { return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0).replace(".", ",")} с`; }

async function loadLib() {
  const cur = v;
  try { const r = await get("/api/library"); if (v !== cur) return; v.lib.items = r.items; v.lib.limit = r.limit; v.lib.err = ""; }
  catch (e) { if (v !== cur) return; v.lib.err = e.message; }
  renderLib();
}

function renderLib() {
  const body = $("#libBody", v.root); if (!body) return;
  const L = v.lib, inSlot = slotInfo(2)?.lib, inSlot1 = slotInfo(1)?.lib;
  $("#libNote", v.root).textContent = L.items?.length ? `${L.items.length} из ${L.limit} · хранятся в Studio, не в клавиатуре` : "";
  if (L.err && !L.items) {
    body.innerHTML = `<div class="row wrap"><span class="msg err">Библиотека не открылась: ${esc(L.err)}</span><button class="btn small" data-a="lib-retry">${icon("refresh")}Ещё раз</button></div>`;
    return;
  }
  if (!L.items) { body.innerHTML = `<div class="lib-row">${"<div class='lib-card skel'></div>".repeat(3)}</div>`; return; }
  if (!L.items.length) {
    body.innerHTML = `<p class="note lib-empty">${icon("screen")}Пока пусто. Сюда само попадает всё, что заливаешь в клавиатуру, и то, что сохранишь кнопкой «В библиотеку» в «Правке». Потом между видео можно переключаться в один щелчок — без повторной правки.</p>`;
    return;
  }
  const busy = upState().busy || v.job?.status === "running";
  body.innerHTML = `<div class="lib-row" role="list">${L.items.map((m) => {
    const here = m.id === inSlot || m.id === inSlot1;
    const name = L.renaming === m.id
      ? `<input class="input lib-rename" value="${esc(m.name)}" maxlength="60" aria-label="Новое название" data-libname="${m.id}">`
      : `<b class="lib-name" title="${esc(m.name)}">${esc(m.name)}</b>`;
    return `<article class="lib-card${here ? " here" : ""}" role="listitem" data-lib="${m.id}">
      <div class="lib-th"><img src="${esc(m.thumb)}" alt="" loading="lazy"><canvas width="${W}" height="${H}" aria-hidden="true"></canvas>
        ${here ? `<span class="tag ok">в слоте ${m.id === inSlot ? 2 : 1}</span>` : ""}${m.frames > 1 ? `<span class="lib-len">${loopText(m.loop_ms)}</span>` : ""}</div>
      ${name}<small class="muted">${m.frames > 1 ? framesText(m.frames) : "картинка"} · ${fmt.dateTime(m.created)}</small>
      <div class="row lib-act">
        <button class="btn small ${here ? "" : "primary"}" data-libup="${m.id}" ${busy ? "aria-disabled=\"true\"" : ""}>${icon("upload")}${here ? "Залить снова" : "На клавиатуру"}</button>
        <button class="btn small quiet icon" data-libedit="${m.id}" aria-label="Открыть «${esc(m.name)}» в редакторе" data-tip="Править">${icon("edit")}</button>
        <button class="btn small quiet icon" data-libren="${m.id}" aria-label="Переименовать «${esc(m.name)}»" data-tip="Переименовать">${icon("text")}</button>
        <button class="btn small quiet icon" data-libdel="${m.id}" aria-label="Удалить «${esc(m.name)}» из библиотеки" data-tip="Удалить">${icon("trash")}</button>
      </div></article>`;
  }).join("")}</div>`;
  const inp = $(".lib-rename", body); if (inp) { inp.focus(); inp.select(); }
}

async function libFrames(m) {
  if (libCache.has(m.id)) return libCache.get(m.id);
  const r = await fetch(`/api/library/${m.id}/frames.bin`);
  if (!r.ok) throw new Error("видео в библиотеке не читается — удали его и сохрани заново");
  const buf = await r.arrayBuffer(), out = [];
  for (let i = 0; i < m.frames; i++) {
    const dv = new DataView(buf, i * W * H * 2, W * H * 2), id = new ImageData(W, H), d = id.data;
    for (let q = 0; q < W * H; q++) {
      const c = dv.getUint16(q * 2, true), r5 = c >> 11, g6 = (c >> 5) & 63, b5 = c & 31;
      d[q * 4] = (r5 << 3) | (r5 >> 2); d[q * 4 + 1] = (g6 << 2) | (g6 >> 4); d[q * 4 + 2] = (b5 << 3) | (b5 >> 2); d[q * 4 + 3] = 255;
    }
    out.push(id);
  }
  libCache.set(m.id, out);
  if (libCache.size > 3) libCache.delete(libCache.keys().next().value);
  return out;
}

// миниатюра оживает при наведении: кадры с настоящими задержками
async function libHover(card) {
  const m = v.lib.items?.find((x) => x.id === card.dataset.lib);
  if (!m || m.frames < 2 || reduceMotion()) return;
  libHoverStop();
  const h = v.lib.hover = { card, raf: 0 };
  let frames; try { frames = await libFrames(m); } catch { return; }
  if (v?.lib.hover !== h) return;
  const cv = $("canvas", card), g = cv.getContext("2d");
  card.classList.add("playing");
  let i = 0, next = 0;
  const tick = (now) => {
    if (v?.lib.hover !== h) return;
    h.raf = requestAnimationFrame(tick);
    if (now < next) return;
    g.putImageData(frames[i], 0, 0); next = now + m.delays[i]; i = (i + 1) % frames.length;
  };
  h.raf = requestAnimationFrame(tick);
}
function libHoverStop() {
  const h = v?.lib.hover; if (!h) return;
  cancelAnimationFrame(h.raf); h.card.classList.remove("playing"); v.lib.hover = null;
}

// источник редактора из кадров библиотеки: правь поверх (текст, рисунок, цвет) и заливай заново
async function libEdit(id) {
  const m = v.lib.items.find((x) => x.id === id), msg = $("#libMsg", v.root);
  try {
    const frames = await libFrames(m);
    let src;
    if (frames.length === 1) {
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H; cv.getContext("2d").putImageData(frames[0], 0, 0);
      src = await ED.fromCanvas(cv, m.name);
    } else {
      const durs = m.delays.map((d) => d / 1000), starts = []; let t = 0;
      for (const d of durs) { starts.push(t); t += d; }
      const cache = new Map(), n = frames.length;
      src = { kind: "anim", name: m.name, size: 0, w: W, h: H, duration: t, frames: n, starts, durs,
        frameAt(at) {
          const x = ((at % t) + t) % t; let i = starts.findIndex((s0, j) => x < s0 + durs[j]); if (i < 0) i = n - 1;
          if (!cache.has(i)) cache.set(i, createImageBitmap(frames[i]));
          return cache.get(i);
        },
        close() { cache.forEach((p) => p.then((b) => b.close(), () => {})); cache.clear(); } };
    }
    setSource(src, "library");
    setMsg(msg, `«${m.name}» открыто в редакторе — правь справа и заливай`, "ok");
    $(".s-studio", v.root)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  } catch (e) { setMsg(msg, e.message, "err"); }
}

async function libUpload(id) {
  const m = v.lib.items.find((x) => x.id === id), msg = $("#libMsg", v.root), s = upState();
  if (s.busy || v.job?.status === "running") { setMsg(msg, "Сейчас идёт другая запись — дождись её конца.", "err"); return; }
  if (!connected()) { setMsg(msg, "Клавиатура не подключена: подключи кабель, ползунок в центр.", "err"); return; }
  const slot = v.slot, cur = v;
  if (!slotInfo(slot)) {
    const ok = await confirmDialog({
      title: `Залить поверх слота ${slot}?`, danger: true, confirm: "Залить",
      body: slot === 1 ? "В слоте 1 сейчас заводская анимация. Заливка сотрёт её, а вернуть её нечем."
        : "В слоте сейчас то, что залито не из Lunacy Studio. Заливка сотрёт его, и вернуть прежнее будет нечем.",
    });
    if (!ok || v !== cur) return;
  }
  v.waitSince = Date.now() / 1000; setMsg(msg, "", "");
  try {
    await post("/api/library/upload", { id, slot });
    if (v !== cur) return;
    v.job = { name: `Заливка «${m.name}» в слот ${slot}`, status: "running", progress: 0, total: 0, started: Date.now() / 1000 };
    progress(v.job); setMsg(msg, `Заливаю «${m.name}» в слот ${slot}…`, "");
  } catch (e) { if (v !== cur) return; v.waitSince = 0; setMsg(msg, e.message, "err"); }
  renderUpload(); renderLib();
}

async function libSave() {
  const msg = $("#upMsg", v.root), btn = $("#libSave", v.root);
  if (!v.src) { setMsg(msg, "Сначала открой видео, узор или рисунок.", "err"); return; }
  btn.classList.add("busy");
  try {
    const frames = await ensureAll();
    const r = await postRaw("/api/library/save", new Blob(frames.map((f) => f.bytes)), {
      "X-Delays": frames.map((f) => f.delay).join(","), "X-Filename": encodeURIComponent(v.src.name), "X-Source": v.origin || "file",
    });
    toast(r.message, { sub: "Переключиться на него — кнопка «На клавиатуру» в «Моих видео»" });
    await loadLib();
  } catch (e) { setMsg(msg, e.message, "err"); }
  btn?.classList.remove("busy");
}

async function libRename(id, name) {
  const msg = $("#libMsg", v.root), m = v.lib.items.find((x) => x.id === id);
  v.lib.renaming = null;
  if (!name.trim() || name.trim() === m.name) { renderLib(); return; }
  try { const r = await post("/api/library/rename", { id, name: name.trim() }); Object.assign(m, { name: r.item.name }); }
  catch (e) { setMsg(msg, e.message, "err"); }
  renderLib();
}

async function libDelete(id) {
  const m = v.lib.items.find((x) => x.id === id), cur = v;
  const ok = await confirmDialog({ title: `Удалить «${m.name}» из библиотеки?`, danger: true, confirm: "Удалить",
    body: "Файл видео в Studio сотрётся. В клавиатуре ничего не изменится: если оно сейчас в слоте, там и останется." });
  if (!ok || v !== cur) return;
  try { await post("/api/library/delete", { id }); toast(`«${m.name}» удалено из библиотеки`); libCache.delete(id); await loadLib(); }
  catch (e) { setMsg($("#libMsg", v.root), e.message, "err"); }
}

function bindLib() {
  const box = $("#libBody", v.root);
  v.offs.push(
    on(box, "click", "[data-libup]", (e, el) => libUpload(el.dataset.libup)),
    on(box, "click", "[data-libedit]", (e, el) => libEdit(el.dataset.libedit)),
    on(box, "click", "[data-libren]", (e, el) => { v.lib.renaming = el.dataset.libren; renderLib(); }),
    on(box, "click", "[data-libdel]", (e, el) => libDelete(el.dataset.libdel)),
    on(box, "click", "[data-a=lib-retry]", () => { v.lib.err = ""; v.lib.items = null; renderLib(); loadLib(); }),
    on(box, "keydown", "[data-libname]", (e, el) => {
      if (e.key === "Enter") { e.preventDefault(); libRename(el.dataset.libname, el.value); }
      if (e.key === "Escape") { e.preventDefault(); v.lib.renaming = null; renderLib(); }
    }),
    on(box, "focusout", "[data-libname]", (e, el) => { if (v.lib.renaming === el.dataset.libname) libRename(el.dataset.libname, el.value); }),
    on(box, "pointerover", ".lib-card", (e, el) => { if (v.lib.hover?.card !== el) libHover(el); }),
    on(box, "pointerleave", ".lib-card", () => libHoverStop()),
  );
  $("#libSave", v.root).onclick = libSave;
}

// ---------- графика экрана (04 38) ----------
function gfxState() {
  const g = gfx(), st = store.status || store.server, job = v.job;
  if (job?.status === "running" && isGfx(job)) return { kind: "", text: `Идёт запись: ${job.progress || 0} из ${job.total || g?.pack?.blocks || "…"} блоков. Не отключай кабель.` };
  // метку «оборвалось» сервис ставит на время записи, поэтому пока клавиатура занята, это ещё не обрыв
  if (st?.unsynced === "графика экрана" && !st.busy) return { kind: "err", text: "Последняя запись графики оборвалась: значки и фон экрана могут быть испорчены. Залей набор ещё раз." };
  if (!g?.pack) return { kind: "warn", text: "Набора графики нет. Его собирает tools/build_pack.py в репозитории — после сборки он появится здесь." };
  if (g.matches) return { kind: "ok", text: `В клавиатуре этот набор: залит ${fmt.dateTime(g.written.at)}.` };
  if (g.written) return { kind: "warn", text: `Набор пересобран после последней заливки (${fmt.dateTime(g.written.at)}): в клавиатуре прежний.` };
  return { kind: "", text: "Отсюда набор ещё не заливали: в клавиатуре заводская графика или залитая другой программой." };
}

function gfxUpState() {
  const job = v.job;
  if (v.gfxSending) return { busy: "send" };
  if (job?.status === "running") return isGfx(job) ? { busy: "job" } : { why: `Сейчас идёт «${job.name}». Залить набор можно, когда она закончится.` };
  if (v.sending) return { why: "Сейчас запускается заливка слота. Залить набор можно, когда она закончится." };
  if (!gfx()?.pack) return { why: "Заливать нечего: набор графики не собран." };
  if (!connected()) return { why: "Клавиатура не подключена. Подключи кабель, ползунок в центр." };
  if (wireless()) return { why: "Графика заливается только по кабелю: через ресивер 2.4G экран не настраивается." };
  return { ok: true };
}

function renderGfx() {
  const btn = $("#gfxBtn", v.root); if (!btn) return;
  const g = gfx(), s = gfxUpState(), job = v.job, state = gfxState();
  const pct = s.busy === "job" && job.total ? Math.floor(job.progress / job.total * 100) : 0;
  const sig = JSON.stringify([s, pct, state, g?.pack?.sha256]);
  if (sig === v.gfxSig) return;
  v.gfxSig = sig;
  const tiles = new Set(g?.pack?.tiles || []);
  $("#gfxStrip", v.root).innerHTML = STRIP.filter(([a]) => tiles.has(a))
    .map(([a, w, h]) => `<img src="${esc(packUrl(a))}" alt="" width="${w * 1.5}" height="${h * 1.5}">`).join("")
    + (tiles.has("_sheet") ? `<a class="more" href="${esc(packUrl("_sheet"))}" target="_blank" rel="noopener">Все картинки набора</a>` : "");
  const el = $("#gfxState", v.root);
  el.className = `gfx-state ${state.kind}`; el.textContent = state.text;
  btn.classList.toggle("busy", !!s.busy);
  btn.toggleAttribute("aria-busy", !!s.busy);
  btn.setAttribute("aria-disabled", String(!s.ok));
  if (s.busy === "send") btn.textContent = "Отправляю…";
  else if (s.busy === "job") btn.textContent = `Записываю… ${pct}%`;
  else btn.innerHTML = `${icon("upload")}${g?.matches ? "Залить заново" : "Залить набор"}${s.ok ? ` <span class="est">≈ ${Math.round((g.seconds || 280) / 60)} мин</span>` : ""}`;
  const why = $("#gfxWhy", v.root);
  why.hidden = !s.why; why.textContent = s.why || "";
}

async function gfxWrite() {
  const msg = $("#gfxMsg", v.root);
  const s = gfxUpState();
  if (s.busy) return;
  if (!s.ok) { setMsg(msg, s.why, "err"); return; }
  const g = gfx(), cur = v;
  const ok = await confirmDialog({
    title: "Стереть графику экрана и залить набор?", danger: true, confirm: "Стереть и залить",
    body: "Запись сотрёт то, что сейчас во флеш клавиатуры с адреса 0 до 0x740000: фон экрана статуса, значки, анимации поиска. Вернуть заводскую графику нечем — её копии нет. Картинки в слотах 1 и 2 не затрагиваются.",
    items: [
      ...(g.matches ? ["В клавиатуре уже этот набор. Повторять стоит, только если прошлая запись оборвалась."] : []),
      `Займёт около ${Math.round((g.seconds || 280) / 60)} минут, прервать нельзя. Не отключай кабель: оборванная запись оставит значки недописанными.`,
      "Пока идёт запись, остальные настройки клавиатуры недоступны.",
      `Набор собран ${fmt.dateTime(g.pack.built_at)}, ${g.pack.blocks} блоков по 4 КБ, SHA-256 ${g.pack.sha256.slice(0, 8)}…`,
    ],
  });
  if (!ok || v !== cur) return;
  v.gfxSending = true; v.gfxWait = Date.now() / 1000;
  setMsg(msg, "", ""); renderGfx(); renderUpload(); renderShow();
  try {
    await post("/api/screen/graphics/write", { sha256: g.pack.sha256 });
    if (v !== cur) return;
    v.job = { name: "Запись графики экрана", kind: "gfx", status: "running", progress: 0, total: g.pack.blocks, started: Date.now() / 1000 };
    v.gfxSending = false;
    progress(v.job);
  } catch (e) {
    if (v !== cur) return;
    v.gfxSending = false; v.gfxWait = 0;
    setMsg(msg, e.message, "err");
  }
  renderGfx(); renderUpload(); renderShow();
}

async function gfxFinish(job) {
  v.gfxWait = 0;
  const msg = $("#gfxMsg", v.root), cur = v;
  if (job.status === "done") { toast("Графика экрана обновлена", { sub: job.message }); setMsg(msg, "Залито", "ok"); }
  else setMsg(msg, `Запись не прошла: ${humanError(job.message) || "причина неизвестна"}. Значки и фон могли остаться недописанными — проверь кабель и залей набор ещё раз.`, "err");
  try { await window.__studio.refreshServer(); } catch (e) { if (v === cur) setMsg(msg, `${job.status === "done" ? "Залито" : "Запись не прошла"}, но состояние набора не обновилось: ${e.message}`, "err"); }
  if (v !== cur) return;
  renderGfx(); renderLcd(); renderCaption();
}

function onStatus(st) {
  if (!v) return;
  const prev = v.job, job = st.job || {};
  // Ответ опроса, отправленного до нашей заливки, ещё несёт прежнюю задачу — не даём ему сбросить прогресс.
  const since = v.waitSince || v.gfxWait;
  if (since && job.status !== "running" && (job.started || 0) < since - 2) return;
  v.job = job;
  if (isGfx(job) && job.status !== "running" && job.started !== v.gfxDoneAt
      && (v.gfxWait ? (job.started || 0) >= v.gfxWait - 2 : prev?.status === "running" && isGfx(prev)) && !v.gfxSending) {
    v.gfxDoneAt = job.started; gfxFinish(job);
  }
  renderGfx();
  if (job.status === "running" && isScreenJob(job)) progress(job);
  else {
    if (prev?.status === "running" && isScreenJob(prev)) progressOff();
    const ended = isUpload(job) && (job.status === "done" || job.status === "error") && job.started !== v.doneAt;
    const relevant = v.waitSince ? (job.started || 0) >= v.waitSince - 2 : prev?.status === "running" && isUpload(prev);
    if (ended && relevant && !v.sending) { v.doneAt = job.started; finish(job); }
    renderCaption();
  }
  renderUpload();
  if ((prev?.status === "running") !== (job.status === "running") || v.wasConn !== st.connected) { v.wasConn = st.connected; renderShow(); }
}

async function finish(job) {
  v.waitSince = 0;
  const msg = $("#upMsg", v.root);
  if (job.status !== "done") {
    setMsg(msg, `Заливка не прошла: ${humanError(job.message) || "причина неизвестна"}. Проверь кабель и залей ещё раз — прежняя картинка слота могла стереться.`, "err");
    renderShow();
    return;
  }
  toast("Картинка на экране клавиатуры", { sub: job.message });
  setMsg(msg, "Залито", "ok");
  v.preview = false;          // правка остаётся: можно поменять и перезалить; экран показывает слот
  stopPlay();
  const cur = v;
  try { await window.__studio.refreshServer(); } catch (e) { if (v === cur) setMsg(msg, `Залито, но список слотов не обновился: ${e.message}`, "err"); }
  if (v !== cur) return;
  v.slot = scr().slot === 1 ? 1 : 2;
  renderSource(); renderShow(); renderLcd(); renderUpload(); renderCaption();
  setMsg($("#libMsg", v.root), "", ""); loadLib();
}
