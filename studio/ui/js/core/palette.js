// Палитра команд (Ctrl+K): переходы, частые действия, поиск по эффектам и профилям.
import { esc, h } from "./dom.js";

const providers = [];
export const addCommands = (fn) => providers.push(fn); // fn() → [{title, group, keywords?, run}]

let dlg;
export function openPalette() {
  if (dlg?.open) return;
  const items = providers.flatMap((p) => { try { return p(); } catch { return []; } });
  dlg = h(`<dialog class="palette" aria-label="Палитра команд">
      <input type="text" role="combobox" aria-expanded="true" aria-controls="palList" aria-autocomplete="list" placeholder="Что сделать? Раздел, эффект, профиль, действие" autocomplete="off" spellcheck="false">
      <ul role="listbox" id="palList"></ul></dialog>`);
  document.body.appendChild(dlg);
  const input = dlg.querySelector("input"), list = dlg.querySelector("ul");
  let shown = [], sel = 0;
  const norm = (s) => s.toLowerCase().replace(/ё/g, "е");
  const render = () => {
    const q = norm(input.value.trim());
    shown = !q ? items : items.filter((i) => norm(`${i.title} ${i.group} ${i.keywords || ""}`).includes(q));
    shown = shown.slice(0, 40); sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length
      ? shown.map((i, n) => `<li role="option" id="pal-${n}" data-n="${n}" aria-selected="${n === sel}"><span>${esc(i.title)}</span><small>${esc(i.group)}</small></li>`).join("")
      : `<div class="empty">Ничего не нашлось. Попробуй «эффект», «записать» или название раздела.</div>`;
    // скринридер читает выбранную строку, хотя фокус остаётся в поле
    if (shown.length) input.setAttribute("aria-activedescendant", `pal-${sel}`); else input.removeAttribute("aria-activedescendant");
  };
  const run = (n) => { const i = shown[n]; if (!i) return; dlg.close(); i.run(); };
  input.addEventListener("input", () => { sel = 0; render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); render(); list.children[sel]?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); render(); list.children[sel]?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter") { e.preventDefault(); run(sel); }
  });
  list.addEventListener("click", (e) => { const li = e.target.closest("li"); if (li) run(+li.dataset.n); });
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  render();
  dlg.showModal();
  input.focus();
}
