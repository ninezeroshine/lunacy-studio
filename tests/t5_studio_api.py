"""Сквозная проверка запущенного Lunacy Studio через API. Меняет состояние клавиатуры и возвращает его;
сброс к заводскому оставляет пустые раскладку и макросы, а готовый фон (если есть manifest) заливает в слот 2.
Запуск при работающем сервисе: python -I tests/t5_studio_api.py
Без железа — против заглушки (tests/stub_studio.py): STUDIO_URL=http://127.0.0.1:47801"""
import json, os, re, sys, time, ctypes, urllib.request, urllib.parse, urllib.error
sys.stdout.reconfigure(encoding="utf-8")
BASE = os.environ.get("STUDIO_URL", "http://127.0.0.1:47800")
TOKEN = re.search(r'STUDIO_TOKEN = "([^"]+)"', urllib.request.urlopen(BASE + "/").read().decode()).group(1)


def call(path, body=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={"X-Studio-Token": TOKEN, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def overlay():
    return call("/api/status")["live"]


ok = fail = 0
def check(name, cond, info=""):
    global ok, fail
    ok, fail = ok + bool(cond), fail + (not cond)
    print(("OK   " if cond else "FAIL ") + name + (f" — {info}" if info else ""))


ORIG = call("/api/state")["profile"]      # подсветку и экран вернём в конце
st = call("/api/status")
check("клавиатура подключена", st["connected"], st.get("error") or "")

call("/api/claude", {"event": "attention"}); time.sleep(0.6)
lv = overlay(); check("Claude ждёт ответа → живой слой", lv["overlay"] == "Claude Code ждёт ответа", str(lv))
call("/api/claude", {"event": "idle"}); time.sleep(0.4)
call("/api/claude", {"event": "done"}); time.sleep(0.4)
lv = overlay(); check("Claude готово → волна", lv["overlay"] == "Claude Code: готово", str(lv))
time.sleep(1.5)
check("после волны слой снят", overlay()["overlay"] is None, str(overlay()))

raw = lambda body: json.loads(urllib.request.urlopen(urllib.request.Request(   # как шлёт хук: без токена
    BASE + "/api/claude", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})).read())
raw({"hook_event_name": "UserPromptSubmit", "session_id": "t5", "prompt": "x"}); time.sleep(0.3)
lv = overlay(); check("хук UserPromptSubmit → работает", lv["claude"] == "working" and lv["claude_event"] == "UserPromptSubmit", str(lv))
raw({"hook_event_name": "StopFailure", "session_id": "t5"}); time.sleep(0.4)
lv = overlay(); check("хук StopFailure → коралловый пульс", lv["claude"] == "error" and lv["overlay"] == "Claude Code: ошибка", str(lv))
check("неизвестное событие хука игнорируется", raw({"hook_event_name": "Foo"}) == {"ok": True, "ignored": True})
time.sleep(1.4); raw({"hook_event_name": "SessionEnd"})

u32 = ctypes.WinDLL("user32")
u32.keybd_event(0xA2, 0x1D, 0, 0)          # левый Ctrl вниз
time.sleep(0.8)
lv = overlay()
u32.keybd_event(0xA2, 0x1D, 2, 0)          # вверх
check("подсказчик при зажатом Ctrl", (lv["overlay"] or "").startswith("подсказки ctrl"), str(lv))
time.sleep(0.4)
check("подсказчик гаснет при отпускании", not (overlay()["overlay"] or "").startswith("подсказки"))

r = call("/api/lighting/effect", {"mode": 11, "brightness": 5, "speed": 3})
check("эффект 11 через API", r.get("ok"))
r = call("/api/screen/display", {"display": "clock", "slot": 2})
check("экран: часы на фоне слота 2", r.get("ok"))
r = call("/api/screen/time", {})
check("синхронизация времени", r.get("ok"), r.get("message", ""))

r = call("/api/keymap/commit", {"keymap": {"base": {"55": {"type": "key", "hid": 0x29}}, "fn": {}}})
check("раскладка Caps→Esc записана", r.get("ok"))
r = call("/api/keymap/commit", {"keymap": {"base": {}, "fn": {}}})
check("раскладка сброшена к заводской", r.get("ok"))
state = call("/api/state")
check("профиль: раскладка пустая", state["profile"]["keymap"] == {"base": {}, "fn": {}})

r = call("/api/macros/from_text", {"text": "Привет, Hi!"})
check("макрос из текста (RU+EN)", len(r["actions"]) > 20, f"{len(r['actions'])} действий")
try:
    call("/api/keymap/commit", {"keymap": {"base": {"55": {"type": "key", "hid": 0x68}}, "fn": {}}})
    check("F13 отклоняется", False)
except urllib.error.HTTPError as e:
    check("F13 отклоняется понятной ошибкой", e.code == 400, json.loads(e.read())["error"])

# ---- дополнения: устройство, профили, вспышка, таймер, нагрузка, сброс ----
def get(path, token=False):
    req = urllib.request.Request(BASE + path, headers={"X-Studio-Token": TOKEN} if token else {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, dict(r.headers), r.read()


def err(path, body):
    try:
        call(path, body)
        return None
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())["error"]


def wait_job(timeout=90):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = call("/api/status")["job"]
        if j["status"] != "running":
            return j
        time.sleep(0.3)
    return {"status": "timeout"}


dev = json.loads(get("/api/device")[2])
check("устройство: прошивка и подключение", dev["connected"] and re.fullmatch(r"\d+\.\d\d", dev["firmware"] or "")
      and dev["connection"] in ("usb", "2.4g"), str(dev))
st = json.loads(get("/api/stats")[2])
check("нагрузка CPU/RAM/GPU", 0 <= st["cpu"] <= 100 and 0 <= st["ram"] <= 100 and (st["gpu"] is None or 0 <= st["gpu"] <= 100), str(st))

hk = json.loads(get("/api/claude/hooks")[2])          # только чтение настоящего settings.json
check("статус хуков Claude Code", {"installed", "partial", "path", "events", "preview"} <= set(hk), hk["path"])
try:
    urllib.request.urlopen(urllib.request.Request(BASE + "/api/claude/hooks/install", data=b"{}"))
    check("установка хуков без токена закрыта", False)
except urllib.error.HTTPError as e:
    check("установка хуков без токена закрыта", e.code == 403)

NAME = "Тест API"
r = call("/api/profiles/save", {"name": NAME})
check("профиль сохранён", r.get("name") == NAME and NAME in [p["name"] for p in call("/api/state")["profiles"]])
check("имя с / отклоняется", (err("/api/profiles/save", {"name": "a/b"}) or (0,))[0] == 400)
code, hdr, body = get("/api/profiles/export?name=" + urllib.parse.quote(NAME) + "&token=" + TOKEN)
doc = json.loads(body)
check("экспорт по ?token= — файл", code == 200 and "attachment" in hdr.get("Content-Disposition", "") and doc["name"] == NAME)
try:
    get("/api/profiles/export?name=" + urllib.parse.quote(NAME)); check("экспорт без токена закрыт", False)
except urllib.error.HTTPError as e:
    check("экспорт без токена закрыт", e.code == 403)
r = call("/api/profiles/import", doc)
check("импорт не затирает: новое имя", r.get("name") == NAME + " (2)", str(r))
bad = dict(doc, keymap={"base": {"55": {"type": "key", "hid": 0x68}}, "fn": {}})
e = err("/api/profiles/import", bad)
check("импорт с F13 отклоняется", e and e[0] == 400, str(e))
r = call("/api/profiles/rename", {"name": NAME + " (2)", "to": NAME + " копия"})
check("переименование", r.get("name") == NAME + " копия")
call("/api/profiles/apply", {"name": NAME})
j = wait_job()
check("применение профиля — задача с шагами", j["status"] == "done" and j["progress"] == j["total"] == 4, str(j))
check("активный профиль", call("/api/state")["active_profile"] == NAME)
for n in (NAME, NAME + " копия"):
    call("/api/profiles/delete", {"name": n})
check("профили удалены", not {NAME, NAME + " копия"} & {p["name"] for p in json.loads(get("/api/profiles")[2])})

call("/api/live/flash", {"keys": [1, 2, 3], "rgb": [255, 200, 80], "seconds": 1.5}); time.sleep(0.4)
check("вспышка клавиш", overlay()["overlay"] == "вспышка", str(overlay()))
check("вспышка: неверный номер — 400", (err("/api/live/flash", {"keys": [999], "rgb": [1, 2, 3]}) or (0,))[0] == 400)
time.sleep(1.4)

r = call("/api/timer", {"minutes": 1}); time.sleep(0.5)
lv = overlay()
check("таймер запущен, F-ряд заполняется", r["timer"]["running"] and lv["timer"]["left_s"] <= 60
      and lv["overlay"] == "таймер: старт", str(lv))
call("/api/timer", {"cancel": True})
check("таймер отменён", not call("/api/status")["timer"]["running"])

prev = call("/api/state")["profile"]["smart"]["software"]
call("/api/smart", {"software": "load"}); time.sleep(0.6)
check("режим «Нагрузка»", overlay()["overlay"] == "нагрузка системы", str(overlay()))
call("/api/smart", {"software": prev})

bgs = json.loads(get("/api/screen/backgrounds")[2])
check("список фонов — массив", isinstance(bgs, list), f"{len(bgs)} фонов")
if bgs:
    call("/api/screen/upload_builtin", {"id": bgs[0]["id"], "slot": 2})
    j = wait_job(120)
    code, hdr, _ = get("/api/screen/slot/2.png")
    check("фон залит, миниатюра слота", j["status"] == "done" and hdr.get("Content-Type") == "image/png", str(j))
else:
    print("SKIP фоны: manifest.json нет — заливку готового фона не проверяем")

call("/api/factory", {})
j = wait_job()
s = call("/api/state")["profile"]
check("сброс к заводскому — задача", j["status"] == "done" and s["keymap"] == {"base": {}, "fn": {}}
      and s["macros"] == [] and s["lighting"]["mode"] == 11 and set(s["settings"].values()) == {0}, str(j))
old = ORIG["lighting"]
if old["kind"] == "effect":     # вернуть эффект и режим экрана, которые были до теста
    call("/api/lighting/effect", {k: old[k] for k in ("mode", "rgb", "colorful", "brightness", "speed", "direction")})
call("/api/screen/display", {"display": ORIG["screen"]["display"], "slot": ORIG["screen"]["slot"]})

print(f"\nитог: {ok} ок, {fail} провалов")
sys.exit(1 if fail else 0)
