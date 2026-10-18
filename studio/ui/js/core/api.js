// Связь с сервисом. Ошибки переводятся в «что случилось и что делать».
export const TOKEN = window.STUDIO_TOKEN;

// Сырые ошибки драйвера («[Errno 5] … \\?\hid#…») человеку ничего не говорят; остальное — с заглавной буквы.
// Узнаём их по признакам HID: путь устройства и коды ввода-вывода. Сетевые и файловые ошибки («[Errno 11001]»,
// «[Errno 13]») сервис переводит сам — их нельзя выдавать за молчание клавиатуры.
const DEVICE_ERROR = /hid#|\[errno (5|22|995|1167)\]/i;
export function humanError(e) {
  const t = String(e || "");
  return DEVICE_ERROR.test(t) ? "Клавиатура не ответила" : t.charAt(0).toUpperCase() + t.slice(1);
}

export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

async function request(path, opt) {
  let r;
  try { r = await fetch(path, opt); }
  catch { throw new ApiError("Сервис Lunacy Studio не отвечает. Запусти его ярлыком «Lunacy Studio».", 0); }
  const isJson = (r.headers.get("Content-Type") || "").includes("json");
  const body = isJson ? await r.json().catch(() => ({})) : null;
  if (!r.ok) {
    // сырые ошибки драйвера («[Errno 5] … \?\hid#…») человеку ничего не говорят
    let text = body?.error && DEVICE_ERROR.test(body.error) ? "Клавиатура не ответила" : body?.error;
    if (text === "нет такого метода") text = ""; // старый сервис: ниже подскажем перезапустить
    if (text) text = text.charAt(0).toUpperCase() + text.slice(1);
    if (r.status === 503) throw new ApiError(`${text || "Клавиатура не отвечает"}. Проверь кабель (ползунок в центре) и повтори.`, 503);
    if (r.status === 403) throw new ApiError("Сервис перезапускался, страница устарела. Обнови её (F5).", 403);
    if ((r.status === 404 && !text) || body?.error === "нет такого метода") throw new ApiError("Эта функция появится после обновления сервиса. Перезапусти Lunacy Studio.", 404);
    throw new ApiError(text || `Ошибка сервиса (${r.status}).`, r.status);
  }
  return isJson ? body : r;
}

export const get = (path) => request(path, { headers: { "X-Studio-Token": TOKEN } });

export function post(path, body = {}) {
  return request(path, {
    method: "POST",
    headers: { "X-Studio-Token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function postRaw(path, blob, headers = {}) {
  return request(path, {
    method: "POST",
    headers: { "X-Studio-Token": TOKEN, "Content-Type": "application/octet-stream", ...headers },
    body: blob,
  });
}

// Ссылка на скачивание с токеном (GET без заголовков из <a download>).
export const withToken = (path) => `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(TOKEN)}`;
