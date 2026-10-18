// Раздел «Настройки»: клавиатура, профили, устройство, программа, сброс к заводскому.
import { $, $$, esc, on, fmt, keepFocus } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { store, local, same, on as subscribe } from "../core/store.js";
import { get, post, withToken, humanError } from "../core/api.js";
import { toast, act, setMsg, confirmDialog, promptDialog } from "../core/feedback.js";
import { effectName } from "../core/keydata.js";
import * as D from "../core/drafts.js";
import * as VZ from "./settings-viz.js";
import { mountMini } from "../chart/effects.js";

// Профиль и сброс переписывают раскладку и макросы целиком. Черновик собран на прежнем состоянии:
// записанный потом, он молча откатил бы их, поэтому отменяем его вместе с подтверждением.
function draftLines() {
  const out = [];
  if (store.drafts.keymap) out.push(`незаписанный черновик раскладки (${D.keymapChanges().length}) будет отменён`);
  if (store.drafts.macros) out.push("незаписанный черновик макросов будет отменён");
  return out;
}
function dropDrafts() { if (store.drafts.keymap) D.discardKeymap(); if (store.drafts.macros) D.discardMacros(); }

const ZERO = { disable_alttab: 0, disable_altf4: 0, disable_win: 0, fn_mode: 0, sleep: 0, debounce: 0 };
const STEPS = { keymap: "раскладка", macros: "макросы", lighting: "подсветка", settings: "настройки" };
const MOTION = [{ id: "", label: "По системе" }, { id: "full", label: "Всегда полное" }, { id: "reduce", label: "Уменьшенное" }];

const KB_NOTE = "Клавиатура не сообщает текущие значения: показаны последние записанные отсюда.";
const KB_SCALES = "Шкалы сна и антидребезга взяты из кода фирменной программы и на клавиатуре пока не проверены.";

let v = null;

export function applyMotion(m = local.get("motion", "")) {
  document.documentElement.dataset.motion = ["full", "reduce"].includes(m) ? m : "";
}

export default {
  id: "settings", title: "Настройки", icon: "settings",

  mount(root, ctx) {
    applyMotion();
    v = { root, ctx, vals: savedVals(), job: store.status?.job || store.server.job || null, doneAt: null, wasConn: connected(), offs: [], minis: [] };
    root.innerHTML = `
      <div class="page">
        <div class="page-head"><div><h1>Настройки</h1>
          <p class="lead">Как ведёт себя клавиатура — на наглядных схемах: меняй и смотри, что произойдёт. Ниже профили, устройство и сама программа.</p></div></div>
        <div class="set-grid" id="setGrid">
          <section class="panel span-all" aria-labelledby="hKb" id="cKb"></section>
          <section class="panel span-wide" aria-labelledby="hProf" id="cProf">
            <div class="panel-head"><h2 id="hProf">Профили</h2>
              <a class="btn quiet small" id="expCur" download data-tip="Текущая настройка одним JSON-файлом">${icon("download")}Экспорт текущей</a></div>
            <div class="panel-body stack">
              <div class="row wrap">
                <button class="btn" id="profSave">${icon("plus")}Сохранить текущее как профиль</button>
                <label class="btn quiet" id="profImpLbl">${icon("upload")}Импорт<input type="file" id="profImp" class="sr-only" accept=".json,application/json"></label>
              </div>
              <span class="msg" id="profMsg" aria-live="polite"></span>
              <div id="profList"></div>
            </div>
          </section>
          <section class="panel span-narrow" aria-labelledby="hDev" id="cDev"></section>
          <section class="panel span-wide" aria-labelledby="hApp" id="cApp"></section>
          <section class="panel span-narrow danger-zone" aria-labelledby="hReset" id="cReset">
            <div class="panel-body stack">
              <h2 id="hReset">Сброс к заводскому</h2>
              <p class="muted">Возвращает клавиатуру к состоянию из коробки: раскладку, макросы, подсветку и настройки. Профили и картинки экрана остаются.</p>
              <div class="pjob" id="resetJob" hidden></div>
              <div class="row wrap"><button class="btn danger" id="resetBtn">${icon("reset")}Сбросить к заводскому…</button><span class="msg" id="resetMsg" aria-live="polite"></span></div>
            </div>
          </section>
        </div>
      </div>`;

    const r = root;
    renderKb(); renderProfiles(); renderDevice(); renderApp(); syncJobUi();

    v.offs.push(
      on($("#cKb", r), "click", "[data-lock]", (e, b) => { const k = b.dataset.lock; v.vals[k] = v.vals[k] ? 0 : 1; redrawKb(); }),
      on($("#cKb", r), "click", "[data-set]", (e, b) => { v.vals[b.dataset.set] = +b.dataset.val; redrawKb(); }),
      on($("#cKb", r), "click", "#kbWrite", (e, b) => writeKb(b)),
      on($("#cKb", r), "click", "#kbZero", () => {
        v.vals = { ...ZERO }; redrawKb();
        setMsg($("#kbMsg", r), same(v.vals, savedVals()) ? "Заводские значения — они же записаны сейчас" : "В форме заводские значения — запиши, чтобы отправить их в клавиатуру", "info");
      }),
      on($("#profList", r), "click", "[data-a]", (e, b) => profAction(b.dataset.a, b.closest(".prof").dataset.name, b)),
      // делегирование: act() пересобирает содержимое кнопки-метки вместе с полем файла
      on($("#cProf", r), "change", "#profImp", (e, el) => { const f = el.files[0]; el.value = ""; importProfile(f); }),
      on($("#cDev", r), "click", "#devTime", (e, b) => syncTime(b)),
      on($("#cApp", r), "change", "#autostart", (e, el) => setAutostart(el)),
      on($("#cApp", r), "change", "#expOn", (e, el) => setExperimental(el)),
      on($("#cApp", r), "change", "#updAuto", (e, el) => setUpdAuto(el)),
      on($("#cApp", r), "click", "#updCheck", (e, el) => checkUpdate(el)),
      on($("#cApp", r), "change", "#flashSel", (e, el) => { local.set("flashSelect", el.checked); setMsg($("#appMsg", r), el.checked ? "Выбранная клавиша будет вспыхивать на клавиатуре" : "Вспышка выключена", "ok"); }),
      on($("#cApp", r), "click", "[data-motion]", (e, b) => {
        local.set("motion", b.dataset.motion); applyMotion(b.dataset.motion);
        $$("[data-motion]", r).forEach((x) => x.setAttribute("aria-pressed", x === b));
        setMsg($("#appMsg", r), "Движение интерфейса: " + b.textContent.toLowerCase(), "ok");
      }),
      on($("#cApp", r), "click", "#quitBtn", (e, b) => quit(b)),
      subscribe("status", onStatus),
    );
    $("#profSave", r).onclick = (e) => saveProfile(e.currentTarget);
    $("#resetBtn", r).onclick = (e) => factory(e.currentTarget);
    $("#expCur", r).href = withToken("/api/profiles/export");

    if (ctx.params.profile) focusProfile(ctx.params.profile);
    return () => { v.offs.forEach((f) => f()); v.minis.forEach((f) => f()); v = null; };
  },

  onServer() {
    if (!v) return;
    // Несохранённые правки в форме клавиатуры не затираем: перечитываем, только если формы не трогали.
    if (same(v.vals, v.base)) v.vals = savedVals();
    keepFocus($("#setGrid", v.root), () => { renderKb(); renderProfiles(); renderDevice(); renderApp(); syncJobUi(); });
  },
};

// ---------- общее ----------
const connected = () => (store.status ? !!store.status.connected : !!store.server.connected);
const running = () => v.job?.status === "running";
function savedVals() { return { ...ZERO, ...(store.server.profile.settings || {}) }; }
function offReason() {
  if (running()) return `Сейчас идёт «${v.job.name}» — дождись окончания.`;
  if (!connected()) return "Клавиатура не подключена. Подключи кабель, ползунок в центр.";
  return "";
}
const disAttr = (why) => (why ? `aria-disabled="true" data-tip="${esc(why)}"` : "");

// ---------- клавиатура ----------
// Четыре прибора: каждый показывает, что сделает настройка. Правки копятся в форме, в клавиатуру — кнопкой.
function renderKb() {
  const s = v.vals, why = offReason();
  v.base = savedVals();
  const locked = VZ.LOCKS.filter((l) => s[l.k]).length;
  const msg = $("#kbMsg", v.root)?.outerHTML || `<span class="msg" id="kbMsg" aria-live="polite"></span>`;
  $("#cKb", v.root).innerHTML = `
    <div class="panel-head kb-head"><h2 id="hKb">Клавиатура</h2>
      <div class="row wrap"><span class="tag warn" id="kbDirty" ${same(s, v.base) ? "hidden" : ""}>не записано</span>
        <button class="btn quiet small" id="kbZero">Заводские значения</button>
        <button class="btn primary" id="kbWrite" ${disAttr(why)}>Записать в клавиатуру</button></div></div>
    <div class="panel-body">
      <div class="insts">
        <section class="inst" aria-labelledby="iLock"><header><h3 id="iLock">Защита от случайных сочетаний</h3>
          <span class="inst-v">${locked ? `заблокировано ${locked} из 3` : "всё работает"}</span></header>
          ${VZ.locks(s)}<p class="inst-say">Нажми на сочетание, чтобы заблокировать его. Пригодится в играх.</p></section>
        <section class="inst" aria-labelledby="iFn"><header><h3 id="iFn">Режим Fn</h3><span class="inst-v">${VZ.FN_MODES[s.fn_mode]?.t || ""}</span></header>
          ${VZ.fnModes(s.fn_mode)}</section>
        <section class="inst" aria-labelledby="iSleep"><header><h3 id="iSleep">Сон без нажатий</h3><span class="inst-v">${VZ.SLEEP[s.sleep]?.t || ""}</span></header>
          ${VZ.sleep(s.sleep)}</section>
        <section class="inst" aria-labelledby="iDb"><header><h3 id="iDb">Антидребезг</h3><span class="inst-v">уровень ${s.debounce + 1}</span></header>
          ${VZ.debounce(s.debounce)}${VZ.levels(s.debounce)}<p class="inst-say" id="dbNote">${VZ.debounceSay(s.debounce)}</p></section>
      </div>
      <div class="row between wrap kb-bottom">${msg}
        <p class="note kb-foot">${store.server.profile.settings ? KB_NOTE : "Клавиатура не сообщает текущие значения, а отсюда их ещё не записывали — показаны заводские."} ${KB_SCALES}</p></div>
    </div>`;
}
function redrawKb() { keepFocus($("#cKb", v.root), renderKb); }

function kbDirty() { $("#kbDirty", v.root).hidden = same(v.vals, v.base); }

async function writeKb(b) {
  const msg = $("#kbMsg", v.root), why = offReason();
  if (why) { setMsg(msg, why, "err"); return; }
  const vals = { ...v.vals };
  const r = await act(b, msg, () => post("/api/settings", vals), { busy: "Записываю…", ok: "Настройки записаны" });
  if (!r || !v) return;
  store.server.profile.settings = vals;
  v.base = { ...vals };
  kbDirty();
  $(".kb-foot", v.root).textContent = `${KB_NOTE} ${KB_SCALES}`;
}

// ---------- профили ----------
const profs = () => store.server.profiles || [];

function renderProfiles() {
  const box = $("#profList", v.root), list = profs(), active = store.server.active_profile, why = offReason();
  v.minis.forEach((f) => f()); v.minis = [];
  if (!list.length) {
    box.innerHTML = `<div class="prof-empty"><div class="prof-ghost" aria-hidden="true"><canvas></canvas></div>
      <p>Профиль — снимок всей настройки: раскладка, макросы, подсветка и поведение клавиатуры. Сохрани текущую — и вернёшься к ней одной кнопкой или перенесёшь на другой компьютер.</p></div>`;
    v.minis.push(mountMini($(".prof-ghost canvas", box), 11, () => ({ rgb: [255, 255, 255], colorful: 1, brightness: 3, speed: 2, direction: 0 })));
    return;
  }
  box.innerHTML = `<div class="profiles">${list.map((p) => {
    const isActive = p.name === active;
    const k = p.counts?.keys || 0, m = p.counts?.macros || 0, lt = p.lighting || {};
    const chips = p.error ? `<span class="danger">Файл не читается: ${esc(p.error)}</span>`
      : `<span class="chips"><span class="chip">${icon("keys")}${k ? `${k} ${fmt.plural(k, "клавиша", "клавиши", "клавиш")}` : "заводская раскладка"}</span>
        <span class="chip">${icon("macros")}${m ? `${m} ${fmt.plural(m, "макрос", "макроса", "макросов")}` : "без макросов"}</span>
        <span class="chip">${icon("light")}${lt.kind === "user" ? "свои цвета" : esc(effectName(lt.mode ?? 11))}</span>
        ${p.has_settings ? `<span class="chip">${icon("settings")}поведение</span>` : ""}</span>`;
    return `<div class="prof" data-name="${esc(p.name)}" ${isActive ? "data-active" : ""} tabindex="-1">
      <div class="prof-kb" aria-hidden="true"><canvas data-mode="${lt.kind === "user" ? 1 : lt.mode ?? 11}"></canvas></div>
      <b><span class="pname">${esc(p.name)}</span>${isActive ? `<span class="tag gold">применён</span>` : ""}</b>
      <small class="muted">${esc(fmt.dateTime(p.saved_at) || "дата неизвестна")}</small>
      ${chips}
      <div class="acts">
        ${p.error ? "" : `<button class="btn small" data-a="apply" ${disAttr(why)}>Применить</button>
        <button class="btn small quiet icon" data-a="rename" aria-label="Переименовать «${esc(p.name)}»" data-tip="Переименовать">${icon("edit")}</button>
        <a class="btn small quiet icon" href="${esc(withToken(`/api/profiles/export?name=${encodeURIComponent(p.name)}`))}" download aria-label="Экспорт «${esc(p.name)}» в JSON" data-tip="Экспорт в JSON">${icon("download")}</a>`}
        <button class="btn small quiet icon danger" data-a="delete" aria-label="Удалить «${esc(p.name)}»" data-tip="Удалить">${icon("trash")}</button>
      </div>
      <div class="pjob" hidden></div>
      <span class="msg" aria-live="polite"></span>
    </div>`;
  }).join("")}</div>`;
  $$(".prof", box).forEach((row) => {
    const p = list.find((x) => x.name === row.dataset.name), lt = p?.lighting || {}, cv = $(".prof-kb canvas", row);
    const params = { rgb: lt.rgb || [255, 255, 255], colorful: lt.colorful ?? 1, brightness: lt.brightness ?? 5, speed: 2, direction: 0 };
    if (cv) v.minis.push(mountMini(cv, +cv.dataset.mode, () => params));
  });
  syncJobUi();
}

const rowOf = (name) => $$(".prof", v.root).find((el) => el.dataset.name === name);

async function profAction(a, name, b) {
  const row = rowOf(name), msg = $(".msg", row);
  if (a === "apply") return applyProfile(name, b, msg);
  if (a === "rename") {
    const to = await promptDialog({ title: "Переименовать профиль", label: "Новое имя", value: name, confirm: "Переименовать",
      hint: "До 40 символов, без \\ / : * ? \" < > |" });
    if (!v || to == null || to === name) return;
    const r = await act(null, msg, () => post("/api/profiles/rename", { name, to }), { ok: "Переименован" });
    if (!r || !v) return;
    toast(`Профиль «${name}» теперь «${r.name}»`);
    await refresh(msg);
    return;
  }
  if (a === "delete") {
    const ok = await confirmDialog({
      title: `Удалить профиль «${name}»?`, danger: true, confirm: "Удалить",
      body: "Файл профиля удалится с диска, вернуть его будет нельзя. Клавиатуру это не меняет. Если профиль может пригодиться, сначала сделай экспорт.",
    });
    if (!ok || !v) return;
    const r = await act(b, msg, () => post("/api/profiles/delete", { name }), { busy: "…", keepText: true });
    if (!r || !v) return;
    toast(r.message || `Профиль «${name}» удалён`);
    await refresh(msg);
  }
}

async function applyProfile(name, b, msg) {
  const why = offReason();
  if (why) { setMsg(msg, why, "err"); return; }
  const ok = await confirmDialog({
    title: `Применить профиль «${name}»?`, confirm: "Записать в клавиатуру",
    body: "В клавиатуру будет записано по шагам:",
    items: ["раскладка обоих слоёв — основного и Fn", "макросы", "подсветка", "настройки клавиатуры, если они есть в профиле", ...draftLines()],
  });
  if (!ok || !v) return;
  setMsg(msg, "Текущая настройка заменится. Отмены у записи нет — дождись конца.", "info");
  const r = await act(b, msg, () => post("/api/profiles/apply", { name }), { busy: "Начинаю…" });
  if (!r || !v) return;
  dropDrafts(); // только когда запись точно началась
  v.waitSince = Date.now() / 1000;
  v.job = { name: `Применение профиля «${name}»`, status: "running", progress: 0, total: 4, step: "keymap", started: v.waitSince };
  syncJobUi();
}

async function saveProfile(b) {
  const msg = $("#profMsg", v.root);
  const name = await promptDialog({ title: "Сохранить текущее как профиль", label: "Имя профиля", value: store.server.active_profile || "",
    confirm: "Сохранить", hint: "Сохранятся раскладка, макросы, подсветка и настройки клавиатуры — то, что сейчас записано в неё отсюда." });
  if (!v || name == null) return;
  if (!name) { setMsg(msg, "Имя пустое — профиль не сохранён. Нажми ещё раз и введи имя.", "err"); return; }
  if (profs().some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    const ok = await confirmDialog({ title: `Профиль «${name}» уже есть`, body: "Сохранённое в нём заменится текущей настройкой.", confirm: "Перезаписать", danger: true });
    if (!ok || !v) return;
  }
  const r = await act(b, msg, () => post("/api/profiles/save", { name }), { busy: "Сохраняю…", ok: "Сохранено" });
  if (r && v) await refresh(msg);
}

async function importProfile(f) {
  const msg = $("#profMsg", v.root);
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) { setMsg(msg, `«${f.name}» слишком большой для профиля (больше 2 МБ). Выбери JSON, сохранённый экспортом.`, "err"); return; }
  let doc;
  try { doc = JSON.parse(await f.text()); }
  catch { if (v) setMsg(msg, `«${f.name}» — не JSON. Выбери файл, сохранённый кнопкой «Экспорт».`, "err"); return; }
  if (!v) return;
  const lbl = $("#profImpLbl", v.root);
  const r = await act(lbl, msg, () => post("/api/profiles/import", doc), { busy: "Импортирую…", ok: "Импортирован", keepText: true });
  if (!r || !v) return;
  toast(r.message || "Профиль импортирован", { sub: "Он в списке — применить можно, когда удобно" });
  await refresh(msg);
  if (v && r.name) highlight(r.name);
}

async function refresh(msg) {
  try { await window.__studio.refreshServer(); }
  catch (e) { if (v && msg?.isConnected) setMsg(msg, `Список не обновился: ${e.message}`, "err"); }
}

function highlight(name) {
  const row = rowOf(name); if (!row) return null;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  row.classList.remove("hl"); void row.offsetWidth; row.classList.add("hl");
  row.focus({ preventScroll: true });
  return row;
}

// Из палитры: «Применить профиль …» → показать его и сразу спросить подтверждение.
function focusProfile(name) {
  history.replaceState(null, "", "#/settings");   // перезагрузка страницы не должна снова открывать подтверждение
  const row = highlight(name);
  if (!row) { setMsg($("#profMsg", v.root), `Профиля «${name}» нет — возможно, его удалили или переименовали.`, "err"); return; }
  const b = $("[data-a=apply]", row);
  if (b) setTimeout(() => v && row.isConnected && applyProfile(name, b, $(".msg", row)), 350);
}

// ---------- задачи: применение профиля и сброс ----------
function jobHost(job) {
  if (!job?.name) return null;
  if (/^Сброс/.test(job.name)) return $("#resetJob", v.root);
  const m = /^Применение профиля «(.+)»$/.exec(job.name);
  return m ? $(".pjob", rowOf(m[1]) || document.createElement("i")) : null;
}

function syncJobUi() {
  if (!v) return;
  $$(".pjob", v.root).forEach((el) => { el.hidden = true; });
  const job = v.job, host = running() && jobHost(job);
  if (host) {
    const n = job.total || 4, i = Math.min(job.progress || 0, n);
    const step = STEPS[job.step] || "подготовка";
    host.hidden = false;
    host.innerHTML = `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${i}" aria-label="${esc(job.name)}"><i style="width:${Math.max(4, i / n * 100)}%"></i></div>
      <span class="note">Шаг ${Math.min(i + 1, n)} из ${n}: ${step}. Не отключай клавиатуру до конца.</span>`;
  }
  const why = offReason();
  $$("[data-a=apply], #kbWrite, #resetBtn", v.root).forEach((b) => {
    if (b.classList.contains("busy")) return;
    if (why) { b.setAttribute("aria-disabled", "true"); b.dataset.tip = why; }
    else { b.removeAttribute("aria-disabled"); delete b.dataset.tip; }
  });
}

function onStatus(st) {
  if (!v) return;
  const prev = v.job, job = st.job || {};
  if (v.waitSince && job.status !== "running" && (job.started || 0) < v.waitSince - 2) return; // устаревший ответ опроса
  v.job = job;
  const ours = (j) => /^(Сброс|Применение профиля)/.test(j?.name || "");
  const ended = ours(job) && (job.status === "done" || job.status === "error") && job.started !== v.doneAt;
  const relevant = v.waitSince ? (job.started || 0) >= v.waitSince - 2 : prev?.status === "running" && ours(prev);
  if (ended && relevant) { v.doneAt = job.started; finishJob(job); }
  if (v.wasConn !== !!st.connected) {
    v.wasConn = !!st.connected;
    if (st.connected) get("/api/device").then((d) => { if (v) { store.server.device = d; renderDevice(); } }).catch(() => {});
    else renderDevice();
  }
  syncJobUi();
}

async function finishJob(job) {
  v.waitSince = 0;
  const reset = /^Сброс/.test(job.name);
  const prof = /«(.+)»$/.exec(job.name)?.[1];
  if (job.status === "done") {
    toast(humanError(job.message) || "Готово", { sub: reset ? "Профили и картинки экрана не тронуты" : "Раскладка, макросы, подсветка и настройки обновлены" });
    await refresh(null);
    if (!v) return;
    const target = reset ? $("#resetMsg", v.root) : $(".msg", rowOf(prof) || document.createElement("i"));
    setMsg(target, reset ? "Сброшено" : "Записано в клавиатуру", "ok");
    return;
  }
  const step = STEPS[job.step];
  const text = `Запись остановилась${step ? ` на шаге «${step}»` : ""}: ${humanError(job.message) || "причина неизвестна"}. Шаги до него уже в клавиатуре. Проверь кабель и запусти ещё раз.`;
  const target = reset ? $("#resetMsg", v.root) : rowOf(prof) && $(".msg", rowOf(prof));
  if (target) setMsg(target, text, "err"); else toast(text, { kind: "err", timeout: 9000 });
  await refresh(null);
}

async function factory(b) {
  const msg = $("#resetMsg", v.root), why = offReason();
  if (why) { setMsg(msg, why, "err"); return; }
  const ok = await confirmDialog({
    title: "Сбросить клавиатуру к заводскому?", danger: true, confirm: "Сбросить",
    body: "Профили и картинки экрана останутся. Чтобы потом вернуть текущую настройку, сначала сохрани её профилем. В клавиатуру запишется:",
    items: [
      "раскладка обоих слоёв — все переназначения клавиш исчезнут",
      "макросы — все удалятся из памяти клавиатуры",
      `подсветка — эффект «${effectName(11)}», разноцветный, яркость максимум`,
      "настройки — блокировки выключены, Fn «пока зажата», без сна, антидребезг уровня 1",
      ...draftLines(),
    ],
  });
  if (!ok || !v) return;
  const r = await act(b, msg, () => post("/api/factory", {}), { busy: "Начинаю…", ok: "Идёт сброс…" });
  if (!r || !v) return;
  dropDrafts();
  v.waitSince = Date.now() / 1000;
  v.job = { name: "Сброс к заводскому", status: "running", progress: 0, total: 4, step: "keymap", started: v.waitSince };
  syncJobUi();
}

// ---------- устройство ----------
function renderDevice() {
  const d = store.server.device || {}, isOn = connected();
  const conn = !isOn ? "не подключена" : d.connection === "2.4g" || store.status?.wireless ? "через ресивер 2.4G" : "по кабелю (USB)";
  const val = (x) => (x ? esc(x) : `<span class="muted">—</span>`);
  $("#cDev", v.root).innerHTML = `
    <div class="panel-body stack">
      <h2 id="hDev">Устройство</h2>
      ${VZ.deviceLink(d.connection || (store.status?.wireless ? "2.4g" : "usb"), isOn)}
      <dl class="device">
        <dt>Модель</dt><dd>${val(d.model)}</dd>
        <dt>Прошивка</dt><dd>${val(isOn && d.firmware)}${isOn && d.firmware ? ` <span class="annot">bcdDevice</span>` : ""}</dd>
        <dt>Подключение</dt><dd class="${isOn ? "" : "danger"}">${conn}</dd>
        <dt>VID:PID</dt><dd class="num">${isOn && d.vid ? esc(`${d.vid}:${d.pid}`) : `<span class="muted">—</span>`}</dd>
      </dl>
      ${isOn ? "" : `<p class="note">Подключи клавиатуру — прошивка и подключение появятся здесь сами.</p>`}
      <div class="row wrap"><button class="btn" id="devTime" ${isOn ? "" : disAttr("Клавиатура не подключена")}>${icon("clock")}Синхронизировать время</button>
        <span class="msg" id="devMsg" aria-live="polite"></span></div>
    </div>`;
}

async function syncTime(b) {
  const msg = $("#devMsg", v.root);
  if (!connected()) { setMsg(msg, "Клавиатура не подключена", "err"); return; }
  await act(b, msg, () => post("/api/screen/time", {}), { busy: "Ставлю время…", ok: "Время обновлено" });
}

// ---------- программа ----------
function renderApp() {
  const motion = local.get("motion", "");
  $("#cApp", v.root).innerHTML = `
    <div class="panel-body">
      <h2 id="hApp">Программа</h2>
      <div class="set-row">
        <span class="t" id="t-auto">Запускать вместе с Windows</span><span class="d" id="d-auto">Сервис стартует в трее без окна браузера</span>
        <label class="toggle"><input type="checkbox" id="autostart" aria-labelledby="t-auto" aria-describedby="d-auto" ${store.server.autostart ? "checked" : ""}><i></i></label>
      </div>
      <div class="set-row">
        <span class="t" id="t-flash">Вспышка выбранной клавиши на клавиатуре</span><span class="d" id="d-flash">Когда выбираешь клавишу на карте, она коротко загорается на самой клавиатуре</span>
        <label class="toggle"><input type="checkbox" id="flashSel" aria-labelledby="t-flash" aria-describedby="d-flash" ${local.get("flashSelect", true) ? "checked" : ""}><i></i></label>
      </div>
      <div class="set-row stacked">
        <span class="t" id="t-motion">Движение интерфейса</span>
        <span class="d">«По системе» следует настройке Windows «Эффекты анимации».</span>
        <div class="seg" role="group" aria-labelledby="t-motion">${MOTION.map((m) => `<button data-motion="${m.id}" aria-pressed="${motion === m.id}">${m.label}</button>`).join("")}</div>
      </div>
      <div class="set-row">
        <span class="t" id="t-exp">Экспериментальные функции</span><span class="d" id="d-exp">Свой набор графики экрана и режим «Живые числа». Они перезаписывают заводскую графику во флеш клавиатуры — вернуть её нечем</span>
        <label class="toggle"><input type="checkbox" id="expOn" aria-labelledby="t-exp" aria-describedby="d-exp" ${store.server.experimental ? "checked" : ""}><i></i></label>
      </div>
      <div class="set-row">
        <span class="t">Выключить сервис</span><span class="d">Останавливает Lunacy Studio целиком. Настройка в клавиатуре сохраняется.</span>
        <button class="btn danger small" id="quitBtn">Выключить…</button>
      </div>
      <span class="msg" id="appMsg" aria-live="polite"></span>
      <div class="divider"></div>
      <h3>Обновления</h3>
      <div class="set-row">
        <span class="t" id="t-upd">Проверять обновления на GitHub</span><span class="d" id="d-upd">Раз в 6 часов Studio спрашивает GitHub, вышла ли новая версия. Ничего, кроме этого запроса, не уходит. Ставится обновление только по твоей кнопке</span>
        <label class="toggle"><input type="checkbox" id="updAuto" aria-labelledby="t-upd" aria-describedby="d-upd" ${store.server.updates?.auto !== false ? "checked" : ""}><i></i></label>
      </div>
      <div class="set-row">
        <span class="t">Версия ${esc(store.server.version || "")}</span><span class="d" id="updState">${updText(store.status?.update)}</span>
        <button class="btn small" id="updCheck">${icon("refresh")}Проверить сейчас</button>
      </div>
      <div class="divider"></div>
      <h3>О программе</h3>
      <dl class="device about">
        <dt>Программа</dt><dd>Lunacy Studio ${esc(store.server.version || "")} — неофициальная программа, не связана с производителем клавиатуры. Локальный сервис, адрес 127.0.0.1:47800</dd>
        <dt>Исходники</dt><dd><a href="https://github.com/ninezeroshine/lunacy-studio" target="_blank" rel="noopener">github.com/ninezeroshine/lunacy-studio</a> · лицензия MIT</dd>
        <dt>Данные</dt><dd>%APPDATA%\\LunacyStudio — профиль, сохранённые профили, миниатюры слотов</dd>
        <dt>Прошивка</dt><dd>${store.server.device?.firmware ? esc(store.server.device.firmware) : `<span class="muted">появится при подключении</span>`}</dd>
      </dl>
    </div>`;
}

function updText(u) {
  if (!u) return "Ещё не проверяли";
  if (u.status === "checking") return "Проверяю…";
  if (u.error) return u.error;
  if (u.available) return `Вышла версия ${u.latest} — кнопка «Обновление» в шапке`;
  return u.latest ? "Это последняя версия" : "Ещё не проверяли";
}

async function checkUpdate(btn) {
  const out = $("#updState", v.root);
  btn.classList.add("busy"); out.textContent = "Проверяю…";
  try { const u = await post("/api/update/check", {}); if (!v) return; out.textContent = updText(u); }
  catch (e) { if (v) out.textContent = e.message; }
  btn?.classList.remove("busy");
}

async function setUpdAuto(el) {
  try { const u = await post("/api/update/settings", { auto: el.checked }); store.server.updates = { auto: u.auto }; }
  catch (e) { el.checked = !el.checked; toast(e.message, { kind: "err" }); }
}

async function setExperimental(el) {
  const msg = $("#appMsg", v.root), want = el.checked;
  if (want) {
    const ok = await confirmDialog({ title: "Включить экспериментальные функции?", danger: true, confirm: "Включить",
      body: "Появятся заливка своего набора графики экрана и режим «Живые числа». Обе функции перезаписывают заводскую графику во флеш-памяти клавиатуры (фон экрана статуса, значки). Вернуть заводскую графику нечем — её нет ни в программе производителя, ни у нас. Сам переключатель ничего не пишет.",
      items: ["Без этих функций клавиатура и всё остальное работает как прежде", "Выключить можно в любой момент"] });
    if (!v) return;
    if (!ok) { el.checked = false; return; }
  }
  try {
    const r = await post("/api/experimental", { on: want });
    if (!v) return;
    store.server.experimental = r.experimental; el.checked = r.experimental;
    setMsg(msg, r.experimental ? "Экспериментальные функции включены: они появились на странице «Экран»" : "Экспериментальные функции выключены", "ok");
  } catch (e) { if (!v) return; el.checked = !want; setMsg(msg, e.message, "err"); }
}

async function setAutostart(el) {
  const msg = $("#appMsg", v.root), want = el.checked;
  el.disabled = true;
  setMsg(msg, want ? "Включаю автозапуск…" : "Выключаю автозапуск…", "info");
  try {
    const r = await post("/api/autostart", { enable: want });
    if (!v) return;
    store.server.autostart = !!r.autostart;
    el.checked = !!r.autostart;
    if (r.autostart === want) setMsg(msg, want ? "Lunacy Studio запустится вместе с Windows" : "Автозапуск выключен", "ok");
    else setMsg(msg, "Windows не приняла изменение автозапуска. Проверь, не блокирует ли его антивирус, и попробуй ещё раз.", "err");
  } catch (e) {
    if (!v) return;
    el.checked = !want;
    setMsg(msg, e.message, "err");
  } finally { el.disabled = false; }
}

async function quit(b) {
  const ok = await confirmDialog({
    title: "Выключить сервис Lunacy Studio?", danger: true, confirm: "Выключить",
    body: "Раскладка, макросы и подсветка в клавиатуре останутся, через пару секунд вернётся её собственный эффект подсветки. Запустить снова — ярлыком «Lunacy Studio». Остановится:",
    items: ["эта страница — она перестанет отвечать", "живая подсветка, подсказчик горячих клавиш, индикатор раскладки и таймер", "сигналы Claude Code"],
  });
  if (!ok || !v) return;
  const r = await act(b, $("#appMsg", v.root), () => post("/api/quit", {}), { busy: "Выключаю…", ok: "Сервис выключается. Запустить снова — ярлыком «Lunacy Studio»." });
  if (r) toast("Сервис Lunacy Studio выключается", { sub: "Запустить снова — ярлыком «Lunacy Studio»", timeout: 8000 });
}
