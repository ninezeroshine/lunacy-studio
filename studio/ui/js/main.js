// Точка входа: каркас, маршруты, статус, черновики, горячие клавиши.
import { $, $$, esc, transition, fmt, reduceMotion, keepFocus } from "./core/dom.js";
import { icon } from "./core/icons.js";
import { store, on, emit, same, blockReason } from "./core/store.js";
import { get, post, humanError } from "./core/api.js";
import { toast, toastError, act, initTips } from "./core/feedback.js";
import { openPalette, addCommands } from "./core/palette.js";
import * as D from "./core/drafts.js";
import { startStarfield } from "./core/starfield.js";
import { effectName } from "./core/keydata.js";
import { generate } from "../vendor/transitions/ui-generation.js";

import overviewPage from "./pages/overview.js";
import { renderUpdate } from "./core/update.js";
import keysPage from "./pages/keys.js";
import macrosPage from "./pages/macros.js";
import lightPage from "./pages/light.js";
import screenPage from "./pages/screen.js";
import signalsPage from "./pages/signals.js";
import settingsPage, { applyMotion } from "./pages/settings.js";

const PAGES = [overviewPage, keysPage, macrosPage, lightPage, screenPage, signalsPage, settingsPage];
let current = null, cleanup = null, revealed = false, target = null, revealRun = null;

// ---------- каркас ----------
function renderShell() {
  $("#brand").innerHTML = `${icon("moon")}<span>Lunacy Studio</span>`;
  $("#nav").innerHTML = PAGES.map((p) => `<a href="#/${p.id}" data-page="${p.id}">${icon(p.icon)}<span>${p.title}</span><span class="badge" hidden></span></a>`).join("")
    + `<div class="foot"><span class="annot" id="fw"></span></div>`;
  $("#paletteBtn").onclick = openPalette;
  renderProfile();
}

function renderProfile() {
  const name = store.server.active_profile;
  $("#profile").innerHTML = name ? `Профиль <b>${esc(name)}</b>` : `<span class="muted" data-tip="Сохранить настройку профилем — в «Настройках»">Без профиля</span>`;
  const dev = store.server.device;
  $("#fw").textContent = dev?.firmware ? `Прошивка ${dev.firmware}` : "";
}

function navBadges() {
  const k = D.keymapChanges().length, m = store.drafts.macros ? D.macrosChangeCount() || 1 : 0;
  for (const [id, n] of [["keys", k], ["macros", m]]) {
    const b = $(`#nav [data-page="${id}"] .badge`);
    if (b) { b.hidden = !n; b.textContent = n; b.title = n ? "Не записано в клавиатуру" : ""; }
  }
}

// ---------- маршруты ----------
const pageById = (id) => PAGES.find((p) => p.id === id) || PAGES[0];
export function go(id, params) { const hash = `#/${id}${params ? "?" + new URLSearchParams(params) : ""}`; if (location.hash !== hash) location.hash = hash; else route(); }

async function route() {
  const [id, q] = location.hash.replace(/^#\//, "").split("?");
  const page = pageById(id);
  const params = Object.fromEntries(new URLSearchParams(q || ""));
  const samePage = (target ?? current) === page;
  if (samePage && !Object.keys(params).length) return;
  target = page;
  const mount = () => {
    revealRun?.cancel(); revealRun = null; // первая сборка не должна дорисовывать старую страницу поверх новой
    cleanup?.(); cleanup = null;
    const view = $("#view");
    view.replaceChildren();
    current = page;
    cleanup = page.mount(view, { go, params, reveal }) || null;
    $$("#nav a").forEach((a) => a.dataset.page === page.id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    document.title = `${page.title} · Lunacy Studio`;
  };
  // первый раз — без перехода: страница ещё скрыта и сразу уходит в сборку скелетоном
  if (!samePage) window.scrollTo({ top: 0 });
  if (!revealed) mount(); else await transition(mount);
  if (target === page) target = null;
  renderDraftBar();
  if (!revealed) { revealed = true; await firstReveal(); }
  else if (!document.activeElement || document.activeElement === document.body || document.activeElement.closest("#nav")) $("#main").focus({ preventScroll: true });
}

// Однократная сборка страницы при запуске: точечный каркас → линии частей → раскрытие за линией сканирования.
// До этого момента содержимое скрыто (html[data-boot]), так что готовая страница не мелькает раньше скелетона.
const showView = () => document.documentElement.removeAttribute("data-boot");
async function firstReveal() {
  const page = $("#view .page");
  // окно открылось в фоне или движение выключено — показываем сразу, момент некому смотреть
  if (!page || document.visibilityState !== "visible" || reduceMotion()) { showView(); return; }
  // замер частей идёт по настоящей вёрстке, поэтому ждём шрифты, но не дольше полсекунды
  try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 500))]); } catch {}
  reveal(page, 0, 1800); // generate() прячет .page сразу, в том же кадре
  showView();
}
function reveal(el, delay = 0, duration = 1500) {
  if (reduceMotion()) return Promise.resolve();
  try { revealRun = generate(el, { mode: "skeleton", duration, delay }); return revealRun.finished; } catch { return Promise.resolve(); }
}

// ---------- полоса черновика ----------
function renderDraftBar() {
  const bar = $("#draftBar");
  let n = 0, what = "", kind = null, commit = null, discard = null, undo = null;
  if (current?.id === "keys") {
    n = D.keymapChanges().length; what = "раскладки"; kind = "keymap"; commit = D.commitKeymap; discard = D.discardKeymap; undo = D.undoKeymap;
  } else if (current?.id === "macros" && store.drafts.macros) {
    n = D.macrosChangeCount() || 1; what = "макросов"; kind = "macros"; commit = D.commitMacros; discard = D.discardMacros; undo = D.undoMacros;
  }
  navBadges();
  if (!n) {
    bar.classList.remove("on"); bar.dataset.page = ""; bar.inert = true;
    clearTimeout(bar._clear); bar._clear = setTimeout(() => { if (!bar.classList.contains("on")) bar.replaceChildren(); }, 320);
    return;
  }
  bar.inert = false; clearTimeout(bar._clear);
  const block = blockReason(), canUndo = D.canUndo(kind);
  keepFocus(bar, () => { bar.innerHTML = `
    <div class="what">Не записано в клавиатуру: <b>${n}</b> ${fmt.plural(n, "изменение", "изменения", "изменений")} ${what}</div>
    <span class="msg" id="draftMsg"></span>
    <button class="btn quiet" data-a="undo" ${canUndo ? 'data-tip="Ctrl+Z"' : 'aria-disabled="true" data-tip="Шагов назад нет: после перезагрузки страницы история начинается заново"'}>${icon("undo")}Шаг назад</button>
    <button class="btn quiet" data-a="discard">Отменить всё</button>
    <button class="btn primary" data-a="commit" aria-disabled="${!!block}" ${block ? `data-tip="${esc(block[0])}"` : ""}>Записать в клавиатуру <span class="kbd">Ctrl S</span></button>`; });
  bar.dataset.page = current.id;
  bar.classList.add("on");
  bar.onclick = async (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    if (b.dataset.a === "undo") { if (!undo()) toast("Шагов назад нет", { sub: "Отменить весь черновик — «Отменить всё»" }); }
    if (b.dataset.a === "discard") {
      const snap = D.snapshot();
      discard();
      toast("Черновик отменён", { sub: "Клавиатура не менялась", undo: () => D.restore(snap), undoLabel: "Вернуть" });
    }
    if (b.dataset.a === "commit") await commitDraft(b, commit);
  };
}
async function commitDraft(b, commit) {
  const block = blockReason();
  if (block) { toast(block[0], { sub: block[1], kind: "err" }); return; }
  // полоса прячется сразу после записи, поэтому итог — тостом; при ошибке полоса остаётся с сообщением
  const r = await act(b, b ? $("#draftMsg") : null, commit, { busy: "Записываю…" });
  if (r) toast(r.message || "Записано в клавиатуру");
}
on("draft", () => { renderDraftBar(); current?.onDraft?.(); });

// ---------- статус ----------
let lastConnected = null, lastJob = null, instance = null, restartedFlag = false, bannerText = "";
async function poll() {
  try {
    const st = await get("/api/status");
    store.status = st; store.online = true;
    if (instance && st.instance && st.instance !== instance) restarted();
    instance ??= st.instance;
    renderStatus(st);
    renderUpdate(st);
    if (lastConnected === false && st.connected) {
      toast("Клавиатура снова на связи", { timeout: 2500 });
      refreshServer().catch(() => {}); // прошивка и состояние устройства могли смениться
    }
    lastConnected = st.connected;
    jobFinished(st.job);
    emit("status", st);
  } catch (e) {
    store.online = false;
    store.status = { ...(store.status || {}), connected: false, job: null };
    renderOffline(e.message);
    emit("status", store.status);
  }
  setTimeout(poll, 1000);
}

// Итог фоновой задачи (заливка, профиль, сброс) — где бы ни был человек. «Экран» и «Настройки» показывают его сами.
const OWN_JOB = { screen: /^(Заливка|Запись графики экрана)/, settings: /^(Применение профиля|Сброс)/ };
function jobFinished(job) {
  const running = job?.status === "running" ? job.name : null;
  if (lastJob && !running && !OWN_JOB[current?.id]?.test(lastJob)) {
    if (job?.status === "error") toast(`Не получилось: ${lastJob}`, { sub: friendly(job.message || "") || "Проверь кабель и повтори", kind: "err", timeout: 10000 });
    else if (job?.status === "done") toast(`${lastJob}: готово`, { sub: job.message && job.message !== "готово" ? friendly(job.message) : "" });
    refreshServer().catch(() => {});
  }
  if (!!lastJob !== !!running) renderDraftBar();
  lastJob = running;
}

function banner(html, on = true) {
  const off = $("#offline");
  off.classList.toggle("on", on);
  if (on && html !== bannerText) { off.innerHTML = html; bannerText = html; } // не переписывать каждую секунду: скринридер повторит
  if (!on) bannerText = "";
}

function renderStatus(st) {
  const c = $("#conn");
  if (st.busy) { c.dataset.state = "busy"; c.querySelector(".txt").textContent = `Идёт: ${st.busy}`; }
  else if (st.connected) { c.dataset.state = "ok"; c.querySelector(".txt").textContent = st.wireless ? "Через ресивер 2.4G" : "По кабелю"; }
  else { c.dataset.state = "off"; c.querySelector(".txt").textContent = "Клавиатура не найдена"; }
  const l = st.live || {};
  $("#liveLine").innerHTML = l.overlay ? `${icon("star", "star")}<span>${esc(cap(l.overlay))}</span>` : "";
  const t = st.timer || l.timer;
  const chip = $("#timerChip");
  chip.classList.toggle("on", !!t?.running);
  if (t?.running) chip.innerHTML = `${icon("timer")}${fmt.left(t.left_s)}`;
  const cb = $("#draftBar [data-a=commit]"), bl = blockReason();
  if (cb) { cb.setAttribute("aria-disabled", String(!!bl)); bl ? cb.setAttribute("data-tip", bl[0]) : cb.removeAttribute("data-tip"); }
  if (restartedFlag) return;
  const lines = [];
  if (store.server?.store_error && !storeErrorSeen) {
    const hasProfiles = (store.server.profiles || []).length > 0;
    const e = store.server.store_error, clean = /чистого листа/.test(e);
    lines.push(`${icon("warn")}<span>${esc(e.charAt(0).toUpperCase() + e.slice(1))}. Старый файл сохранён рядом как profile.json.broken.${clean && hasProfiles ? " Вернуть настройку можно в «Настройки» → «Профили» → «Применить»." : ""}</span><button class="btn small quiet" data-banner="store">Понятно</button>`);
  }
  if (st.unsynced === "графика экрана") {
    // метка стоит и во время самой записи (5 минут): обрыв — только когда клавиатура уже не занята
    if (!st.busy) lines.push(`${icon("warn")}<span>Запись графики экрана оборвалась посередине — значки и фон экрана клавиатуры могут быть испорчены. Подключи кабель и залей набор ещё раз в разделе «Экран».</span>`);
  } else if (st.unsynced) {
    lines.push(`${icon("warn")}<span>Запись в клавиатуру (${esc(st.unsynced)}) оборвалась посередине — клавиатура может работать не так, как показано здесь. Подключи кабель и запиши ещё раз или примени профиль в «Настройках».</span>`);
  }
  if (st.vendor_app) {
    // фирменная программа тоже держит клавиатуру: перезаписывает настройки и сбивает подсветку
    lines.push(`${icon("warn")}<span>Запущена фирменная программа Lunacy (${esc(st.vendor_app)}). Она тоже управляет клавиатурой: может перезаписать раскладку и подсветку и мешает сигналам. Закрой её из трея, пока работаешь здесь.</span>`);
  }
  if (!st.connected) {
    const why = st.error && !/не найден|не подключ/i.test(st.error)
      ? ` Последняя ошибка: ${esc(friendly(st.error))}. Если открыта фирменная программа Lunacy, закрой её — она держит клавиатуру.` : "";
    lines.push(`${icon("plug")}<span>Клавиатура не найдена. Подключи кабель и сдвинь ползунок в центр — Lunacy Studio переподключится сама. Черновики можно править и сейчас.${why}</span>`);
  }
  banner(lines.map((l) => `<div class="bline">${l}</div>`).join(""), lines.length > 0);
}
let storeErrorSeen = false;
$("#offline").addEventListener("click", (e) => { if (e.target.closest("[data-banner=store]")) { storeErrorSeen = true; renderStatus(store.status || store.server); } });
function restarted() {
  restartedFlag = true;
  banner(`<div class="bline">${icon("refresh")}<span>Сервис Lunacy Studio перезапустился. Обнови страницу, чтобы продолжить — черновики сохранятся.</span><button class="btn small" onclick="location.reload()">Обновить</button></div>`);
}
const friendly = humanError;
function renderOffline(msg) {
  const c = $("#conn"); c.dataset.state = "off"; c.querySelector(".txt").textContent = "Сервис не отвечает";
  banner(`<div class="bline">${icon("warn")}<span>${esc(msg)}</span></div>`);
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- горячие клавиши ----------
function typing(e) { const t = e.target; return t.closest?.("input, textarea, select, [contenteditable]"); }
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyK") { e.preventDefault(); openPalette(); return; }
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") { e.preventDefault(); $("#draftBar.on [data-a=commit]")?.click(); return; }
  if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ" && !typing(e)) {
    if (current?.id === "keys" && D.undoKeymap()) { e.preventDefault(); return; }
    if (current?.id === "macros" && D.undoMacros()) { e.preventDefault(); return; }
  }
  if (!typing(e) && !document.querySelector("dialog[open]")) current?.onKey?.(e, "down");
});
document.addEventListener("keyup", (e) => { if (!typing(e)) current?.onKey?.(e, "up"); });

// ---------- команды палитры ----------
addCommands(() => [
  ...PAGES.map((p) => ({ title: p.title, group: "Раздел", run: () => go(p.id) })),
  { title: "Записать раскладку в клавиатуру", group: "Действие", keywords: "сохранить ctrl s", run: () => commitDraft(null, D.commitKeymap) },
  { title: "Синхронизировать время экрана", group: "Действие", keywords: "часы", run: () => busyToast() || post("/api/screen/time", {}).then(() => toast("Время на клавиатуре обновлено")).catch(toastError) },
  { title: "Найти сочетание клавиш", group: "Действие", keywords: "горячие подсказчик поиск", run: () => go("signals", { find: 1 }) },
  { title: "Подсказчик горячих клавиш: вкл / выкл", group: "Действие", run: async () => {
    const v = !store.server.profile.smart.hints;
    try { await post("/api/smart", { hints: v }); } catch (e) { toastError(e); return; }
    store.server.profile.smart.hints = v; toast(v ? "Подсказчик включён" : "Подсказчик выключен"); emit("server");
  } },
  ...(store.server.effects || []).map((_, i) => ({ title: effectName(i), group: "Эффект", keywords: "подсветка", run: () => busyToast() || post("/api/lighting/effect", { mode: i }).then(() => { store.server.profile.lighting.mode = i; store.server.profile.lighting.kind = "effect"; toast(`Эффект: ${effectName(i)}`); emit("server"); }).catch(toastError) })),
  ...(store.server.profiles || []).map((p) => ({ title: `Применить профиль «${p.name}»`, group: "Профиль", run: () => go("settings", { profile: p.name }) })),
]);

// занята ли клавиатура: тогда действие не отправляем, а говорим почему
function busyToast() { const b = blockReason(); if (b) { toast(b[0], { sub: b[1], kind: "err" }); return true; } return false; }

// ---------- запуск ----------
async function boot() {
  applyMotion();
  startStarfield();
  initTips();
  try {
    store.server = await get("/api/state");
  } catch (e) {
    $("#view").innerHTML = `<div class="page"><div class="empty-state"><img class="orn" src="assets/moon.png" alt=""><h2>Не удалось открыть обсерваторию</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Повторить</button></div></div>`;
    showView();
    const c = $("#conn"); c.dataset.state = "off"; c.querySelector(".txt").textContent = "Сервис не отвечает";
    return;
  }
  D.initDrafts();
  renderShell();
  on("server", () => { renderProfile(); current?.onServer?.(); });
  if (!location.hash) location.hash = "#/overview";
  window.addEventListener("hashchange", route);
  await route();
  renderStatus({ ...store.server, live: store.server.live || {}, timer: store.server.timer });
  poll();
}

// Перечитать состояние сервиса (после профиля, сброса и т. п.)
export async function refreshServer() {
  const before = store.server?.profile;
  store.server = await get("/api/state");
  const p = store.server.profile;
  // профиль или сброс поменяли клавиатуру под живым черновиком: черновик не трогаем, но предупреждаем
  const moved = (store.drafts.keymap && !same(before?.keymap, p.keymap)) || (store.drafts.macros && !same(before?.macros, p.macros));
  D.initDrafts();
  emit("server");
  renderDraftBar();
  if (moved && (store.drafts.keymap || store.drafts.macros)) {
    toast("Клавиатура изменилась, а черновик остался", { sub: "Он собран на прежнем состоянии — проверь его или отмени перед записью", timeout: 9000 });
  }
}
window.__studio = { refreshServer, go };

boot();
