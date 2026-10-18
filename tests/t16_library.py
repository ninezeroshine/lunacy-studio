"""Библиотека экрана и сочетания макросов через API — только против заглушки (tests/stub_studio.py):
STUDIO_URL=http://127.0.0.1:47804 python -I tests/t16_library.py
Клавиатуру не трогает: заливку из библиотеки проверяет фиктивная клавиатура заглушки."""
import json, os, re, sys, time, urllib.request, urllib.error
sys.stdout.reconfigure(encoding="utf-8")
BASE = os.environ.get("STUDIO_URL")
if not BASE or BASE.endswith(":47800"):
    sys.exit("только против заглушки: задай STUDIO_URL заглушки (не 47800)")
TOKEN = re.search(r'STUDIO_TOKEN = "([^"]+)"', urllib.request.urlopen(BASE + "/").read().decode()).group(1)
FB = 240 * 135 * 2


def call(path, body=None, raw=None, headers=None):
    h = {"X-Studio-Token": TOKEN, "Content-Type": "application/json" if raw is None else "application/octet-stream", **(headers or {})}
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    req = urllib.request.Request(BASE + path, data=data, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            b = r.read()
            return 200, (json.loads(b) if r.headers.get("Content-Type", "").startswith("application/json") else b)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


ok = fail = 0
def check(name, cond, info=""):
    global ok, fail
    ok, fail = ok + bool(cond), fail + (not cond)
    print(("OK   " if cond else "FAIL ") + name + ("" if cond else f" — {info}"))


def frames(n, seed):
    return b"".join(bytes([(seed + i) & 255, i & 255]) * (FB // 2) for i in range(n))

# ---- библиотека ----
before = {i["id"] for i in call("/api/library")[1]["items"]}
body = frames(3, 17)
c, r = call("/api/library/save", raw=body, headers={"X-Delays": "100,100,200", "X-Filename": "t16%20clip", "X-Source": "pattern"})
check("сохранение", c == 200 and r["new"] and r["item"]["frames"] == 3 and r["item"]["loop_ms"] == 400, r)
cid = r["item"]["id"]
c, r = call("/api/library/save", raw=body, headers={"X-Delays": "100,100,200", "X-Filename": "%D0%B4%D1%80%D1%83%D0%B3%D0%BE%D0%B5"})
check("то же видео второй раз — без дубля", c == 200 and r["new"] is False and r["item"]["id"] == cid, r)
c, r = call("/api/library/save", raw=body, headers={"X-Delays": "100,100", "X-Filename": "x"})
check("задержек меньше, чем кадров — отказ", c == 400, r)
c, r = call("/api/library/save", raw=body[:-1], headers={"X-Delays": "100,100,200"})
check("тело не из целых кадров — отказ", c == 400, r)
c, r = call("/api/library/save", raw=body, headers={"X-Delays": "100,100,200", "X-Source": "evil"})
check("неизвестный источник — отказ", c == 400, r)
items = call("/api/library")[1]["items"]
check("видео в списке с миниатюрой", any(i["id"] == cid and i["thumb"].startswith(f"/api/library/{cid}/thumb.png") for i in items))
c, png = call(f"/api/library/{cid}/thumb.png")
check("миниатюра — PNG", c == 200 and png[:8] == b"\x89PNG\r\n\x1a\n")
c, fb = call(f"/api/library/{cid}/frames.bin")
check("кадры отдаются байт в байт", c == 200 and fb == body)
c, r = call("/api/library/xyz/frames.bin")
check("чужой путь — 404", c == 404)
c, r = call("/api/library/rename", {"id": cid, "name": "  Мой клип  "})
check("переименование", c == 200 and r["item"]["name"] == "Мой клип", r)
c, r = call("/api/library/rename", {"id": "../../etc", "name": "x"})
check("кривой id — отказ", c == 400, r)
c, r = call("/api/library/upload", {"id": cid, "slot": 2})
check("заливка из библиотеки запущена", c == 200, r)
for _ in range(60):
    job = call("/api/status")[1]["job"]
    if job.get("status") != "running":
        break
    time.sleep(0.5)
check("заливка из библиотеки прошла", job.get("status") == "done" and "Мой клип" in job.get("message", ""), job)
slot2 = call("/api/state")[1].get("slots", {}).get("2") or {}
check("слот помнит id из библиотеки", slot2.get("lib") == cid, slot2)
c, r = call("/api/library/delete", {"id": cid})
check("удаление", c == 200 and cid not in {i["id"] for i in call("/api/library")[1]["items"]})
c, r = call("/api/library/delete", {"id": cid})
check("повторное удаление — понятный отказ", c == 400, r)

# ---- сочетания макросов ----
prof = call("/api/state")[1]["profile"]
saved_macros, saved_trig = prof["macros"], prof.get("triggers") or []
call("/api/macros", {"macros": [{"name": "a", "actions": [["down", 4], ["up", 4]]}, {"name": "b", "actions": [["down", 5], ["up", 5]]}]})
trig = [{"mods": ["ctrl", "alt", "shift"], "hid": 0x44, "macro": 1}]
c, r = call("/api/macros/triggers", {"triggers": trig})
check("сочетание сохранено", c == 200 and r["triggers"] == [{"mods": ["ctrl", "shift", "alt"], "hid": 0x44, "macro": 1}], r)
c, r = call("/api/macros/triggers", {"triggers": [{"mods": ["shift"], "hid": 0x04, "macro": 0}]})
check("Shift + буква — отказ", c == 400, r)
c, r = call("/api/macros", {"macros": [{"name": "b", "actions": [["down", 5], ["up", 5]]}],
                             "triggers": [{"mods": ["ctrl", "alt", "shift"], "hid": 0x44, "macro": 0}]})
check("удаление макроса сдвигает номер в сочетании", c == 200 and call("/api/state")[1]["profile"]["triggers"][0]["macro"] == 0, r)
c, r = call("/api/macros", {"macros": [], "triggers": [{"mods": ["ctrl"], "hid": 0x44, "macro": 0}]})
check("сочетание на несуществующий макрос — отказ", c == 400, r)
call("/api/macros", {"macros": saved_macros, "triggers": saved_trig})

print(f"\nитог: {ok} ок, {fail} провалов")
sys.exit(1 if fail else 0)
