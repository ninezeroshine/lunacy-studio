// Обновления Lunacy Studio (studio/updater.py): кнопка в шапке, когда на GitHub вышла новая версия,
// и диалог «что нового» → «Обновить». Студия сама скачает установщик, сверит SHA-256, закроется и перезапустится.
import { $, esc } from "./dom.js";
import { icon } from "./icons.js";
import { post } from "./api.js";
import { confirmDialog, toast, toastError } from "./feedback.js";

let chip = null, last = "";

export function renderUpdate(st) {
  const u = st?.update;
  if (!chip) {
    chip = document.createElement("button");
    chip.className = "btn small update-chip"; chip.id = "updateChip"; chip.hidden = true;
    chip.onclick = openUpdate;
    $("#paletteBtn")?.before(chip);
  }
  const show = !!(u && (u.available || u.status === "downloading" || u.status === "installing" || u.status === "error" && u.latest));
  const pct = u?.total ? Math.floor((u.progress / u.total) * 100) : 0;
  const text = !show ? "" : u.status === "downloading" ? `Скачиваю обновление… ${pct}%`
    : u.status === "installing" ? "Устанавливаю — Studio перезапустится" : `Обновление ${u.latest}`;
  const sig = `${show}|${text}|${u?.status}`;
  if (sig === last) return;
  last = sig;
  chip.hidden = !show;
  chip.classList.toggle("busy", u?.status === "downloading" || u?.status === "installing");
  chip.innerHTML = `${icon("download")}${esc(text)}`;
  chip.dataset.tip = u?.error ? u.error : "Новая версия Lunacy Studio на GitHub";
}

export async function openUpdate() {
  let u;
  try { u = await post("/api/update/check", {}); } catch (e) { toastError(e); return; }
  if (!u.available) { toast(`У тебя последняя версия — ${u.current}`); return; }
  const notes = (u.notes || "").replace(/\r/g, "").trim();
  const ok = await confirmDialog({
    title: `Обновить Lunacy Studio до ${u.latest}?`, confirm: "Обновить",
    body: `Сейчас у тебя ${u.current}. Studio скачает установщик с GitHub, проверит его и перезапустится — это около минуты. Профиль, макросы и «Мои видео» останутся.`,
    code: notes ? notes.slice(0, 1800) + (notes.length > 1800 ? "\n…" : "") : "",
  });
  if (!ok) return;
  try { await post("/api/update/install", {}); toast("Скачиваю обновление", { sub: "Studio перезапустится сама, страница обновится" }); }
  catch (e) { toastError(e); }
}
