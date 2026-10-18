// Обратная связь у места действия: тосты, диалоги, состояние кнопки, подсказки.
import { $, esc, h } from "./dom.js";
import { icon } from "./icons.js";

// ---------- тосты ----------
let box;
export function toast(text, { sub = "", kind = "", undo = null, undoLabel = "Отменить", timeout = 4500 } = {}) {
  box ??= document.body.appendChild(h(`<div class="toasts" role="status" aria-live="polite"></div>`));
  while (box.children.length >= 3) box.firstElementChild.remove();
  const el = h(`<div class="toast ${kind}">
      <div class="t-text">${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ""}</div>
      ${undo ? `<button class="btn small quiet" data-undo>${esc(undoLabel)}</button>` : ""}
      <button class="btn small quiet icon" data-close aria-label="Закрыть">${icon("close")}</button>
    </div>`);
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 240); };
  el.querySelector("[data-close]").onclick = close;
  if (undo) el.querySelector("[data-undo]").onclick = () => { close(); undo(); };
  box.appendChild(el);
  // наведение держит тост, уход мыши снова запускает отсчёт
  const life = undo ? Math.max(timeout, 6000) : timeout;
  let t = setTimeout(close, life);
  el.addEventListener("mouseenter", () => clearTimeout(t));
  el.addEventListener("mouseleave", () => { clearTimeout(t); t = setTimeout(close, 2500); });
  return close;
}
export const toastError = (e) => toast(e.message || String(e), { kind: "err", timeout: 7000 });

// ---------- диалог подтверждения ----------
export function confirmDialog({ title, body = "", items = [], code = "", confirm = "Подтвердить", cancel = "Отмена", danger = false }) {
  return new Promise((resolve) => {
    const dlg = h(`<dialog class="dlg">
      <form method="dialog">
        <div class="dlg-body">
          <h2>${esc(title)}</h2>
          ${body ? `<p class="muted">${esc(body)}</p>` : ""}
          ${items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
          ${code ? `<pre>${esc(code)}</pre>` : ""}
        </div>
        <div class="dlg-foot">
          <button type="button" class="btn quiet" data-cancel ${danger ? "autofocus" : ""}>${esc(cancel)}</button>
          <button class="btn ${danger ? "danger" : "primary"}" value="ok" ${danger ? "" : "autofocus"}>${esc(confirm)}</button>
        </div>
      </form></dialog>`);
    document.body.appendChild(dlg);
    wireDialog(dlg);
    dlg.addEventListener("close", () => { resolve(dlg.returnValue === "ok"); dlg.remove(); });
    dlg.showModal();
  });
}

// Общая обвязка диалогов: заголовок для скринридера и «Отмена» без отправки формы.
let dlgId = 0;
export function wireDialog(dlg) {
  const h2 = dlg.querySelector("h2");
  if (h2) { h2.id ||= `dlg-t-${++dlgId}`; dlg.setAttribute("aria-labelledby", h2.id); }
  dlg.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => dlg.close("cancel")));
}

// Диалог ввода одной строки (имя профиля, макроса, эффекта).
export function promptDialog({ title, label, value = "", confirm = "Сохранить", maxLength = 40, hint = "" }) {
  return new Promise((resolve) => {
    const dlg = h(`<dialog class="dlg">
      <form method="dialog">
        <div class="dlg-body">
          <h2>${esc(title)}</h2>
          <div class="field"><label for="dlg-in">${esc(label)}</label>
            <input class="input" id="dlg-in" maxlength="${maxLength}" value="${esc(value)}" autocomplete="off"></div>
          ${hint ? `<p class="note">${esc(hint)}</p>` : ""}
        </div>
        <div class="dlg-foot">
          <button type="button" class="btn quiet" data-cancel>Отмена</button>
          <button class="btn primary" value="ok">${esc(confirm)}</button>
        </div>
      </form></dialog>`);
    document.body.appendChild(dlg);
    wireDialog(dlg);
    const input = $("input", dlg);
    dlg.addEventListener("close", () => { resolve(dlg.returnValue === "ok" ? input.value.trim() : null); dlg.remove(); });
    dlg.showModal(); input.select();
  });
}

// ---------- кнопка: «идёт» → итог рядом ----------
// act(button, msgElement, async () => ({message}), {busy:"Записываю…", ok:"Записано"})
export async function act(btn, msg, fn, { busy = "Записываю…", ok = "Готово", keepText = false } = {}) {
  if (btn?.classList.contains("busy")) return null;
  const label = btn?.innerHTML;
  if (btn) { btn.classList.add("busy"); btn.setAttribute("aria-busy", "true"); if (!keepText) btn.textContent = busy; }
  if (msg) setMsg(msg, "", "");
  try {
    const r = await fn();
    if (msg) setMsg(msg, (r && r.message) || ok, "ok");
    return r ?? true;
  } catch (e) {
    if (msg) setMsg(msg, e.message || String(e), "err"); else toastError(e);
    return null;
  } finally {
    if (btn) { btn.classList.remove("busy"); btn.removeAttribute("aria-busy"); btn.innerHTML = label; }
  }
}

export function setMsg(el, text, kind) {
  el.textContent = text;
  el.className = `msg ${kind || ""}`;
  clearTimeout(el._t);
  if (kind === "ok") el._t = setTimeout(() => { if (el.textContent === text) { el.textContent = ""; el.className = "msg"; } }, 5000);
}

// ---------- подсказки по data-tip ----------
let tipEl;
export function initTips() {
  const show = (e) => {
    const el = e.target.closest("[data-tip]");
    if (!el) return;
    tipEl ??= document.body.appendChild(h(`<div class="tip" role="tooltip"></div>`));
    tipEl.textContent = el.dataset.tip;
    const r = el.getBoundingClientRect();
    tipEl.hidden = false;
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
    if (y < 8) y = r.bottom + 8;
    tipEl.style.left = Math.max(8, Math.min(innerWidth - tw - 8, x)) + "px";
    tipEl.style.top = y + "px";
  };
  const hide = (e) => { if (tipEl && (!e.relatedTarget || !e.relatedTarget.closest?.("[data-tip]"))) tipEl.hidden = true; };
  document.addEventListener("mouseover", show);
  document.addEventListener("focusin", show);
  document.addEventListener("mouseout", hide);
  document.addEventListener("focusout", hide);
}
