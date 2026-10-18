"""Графика экрана в Studio (04 38) на заглушке клавиатуры: статус набора, превью, запись с прогрессом, блокировка
остальных операций, обрыв посередине, отказ по радио и для неподтверждённого набора. В клавиатуру ничего не пишет,
журнал записей — во временной папке. python -I tests/t12_graphics.py"""
import json, os, sys, time, urllib.request, urllib.error
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import stub_studio                                  # noqa: E402

PORT = 47802
app, httpd, tmp = stub_studio.start(PORT, block_delay=0.004)
import fake_kb                                      # noqa: E402
from studio import server, graphics as G           # noqa: E402
FK = fake_kb.FakeKeyboard
BASE = f"http://127.0.0.1:{PORT}"

ok = fail = 0
def check(name, cond, info=""):
    global ok, fail
    ok, fail = ok + bool(cond), fail + (not cond)
    print(("OK   " if cond else "FAIL ") + name + (f" — {info}" if info else ""))


def req(path, body=None, token=True):
    h = {"Content-Type": "application/json"}
    if token:
        h["X-Studio-Token"] = server.TOKEN
    r = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers=h)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            data = resp.read()
            return resp.status, json.loads(data) if "json" in resp.headers.get("Content-Type", "") else data
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


# экспериментальные функции по умолчанию выключены: без них запись отклоняется, потом включаем
c0, r0 = req("/api/screen/graphics/write", {"sha256": "0" * 64})
check("без экспериментального режима запись графики отклонена", c0 == 400 and "эксперимент" in r0.get("error", ""), r0)
check("включение экспериментального режима", req("/api/experimental", {"on": True}) == (200, {"ok": True, "experimental": True}))


def wait(cond, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = cond()
        if v:
            return v
        time.sleep(0.05)
    return None


def job():
    return req("/api/status")[1]["job"]


def finished():
    return wait(lambda: (lambda j: j if j["status"] != "running" else None)(job()), 60)


wait(lambda: app.dm.connected, 10)
code, g = req("/api/screen/graphics")
pack = g["pack"]
data, blocks, sha = G.load()
check("статус: набор найден, 0x740 блоков, SHA как у pack.bin", code == 200 and pack and pack["blocks"] == blocks == 0x740
      and pack["sha256"] == sha, str(pack and pack["built_at"]))
check("статус: журнал заглушки пуст — что залито, неизвестно", g["written"] is None and g["matches"] is False)
check("статус есть и в /api/state", req("/api/state")[1]["graphics"]["pack"]["sha256"] == sha)
check("в превью есть фон и значки экрана статуса", {"000000", "0115bc", "01aa98", "02199c", "01e848", "01f9e4", "021ff4"}
      <= set(pack["tiles"]))
code, png = req("/api/screen/pack/000000.png")
check("превью фона — PNG", code == 200 and png[:8] == b"\x89PNG\r\n\x1a\n")
check("нет такой картинки — 404", req("/api/screen/pack/0000ff.png")[0] == 404)
check("чужой путь через pack/ не раздаётся", req("/api/screen/pack/..%2fpack.bin.png")[0] == 404)

code, r = req("/api/screen/graphics/write", {"sha256": sha}, token=False)
check("запись без токена — 403", code == 403)
code, r = req("/api/screen/graphics/write", {"sha256": "0" * 64})
check("набор не тот, что в превью — 400 «обнови страницу»", code == 400 and "Обнови страницу" in r["error"], r.get("error"))
app.dm.kb.wireless = True
code, r = req("/api/screen/graphics/write", {"sha256": sha})
check("по радио — 400 «только по кабелю»", code == 400 and "кабел" in r["error"], r.get("error"))
app.dm.kb.wireless = False
check("после отказов клавиатура не трогалась", not [c for c in FK.calls if c[0] == "header" and c[1][0] == 0x38])

# ---- полная запись ----
FK.calls.clear()
kb = app.dm.kb
code, r = req("/api/screen/graphics/write", {"sha256": sha})
check("запись принята", code == 200 and r.get("ok"), str(r))
j = wait(lambda: (lambda x: x if x["progress"] > 50 else None)(job()), 20)
check("задача «Запись графики экрана», kind gfx, прогресс по 1856 блокам",
      j and j["name"] == "Запись графики экрана" and j["kind"] == "gfx" and j["total"] == blocks and j["status"] == "running",
      str(j and {k: j[k] for k in ("progress", "total")}))
check("статус: «Идёт: запись графики экрана»", req("/api/status")[1]["busy"] == "запись графики экрана")
t0 = time.time()
code, r = req("/api/lighting/effect", {"mode": 11})
check("подсветка во время записи — 409 «занята»", code == 409 and "занята" in r["error"], f"{r.get('error')} ({time.time() - t0:.1f} с)")
code, r = req("/api/screen/upload_builtin", {"id": "crescent", "slot": 2})
check("заливка слота во время записи — «уже идёт»", code == 400 and "уже идёт" in r["error"], r.get("error"))
code, r = req("/api/screen/graphics/write", {"sha256": sha})
check("вторая запись во время первой — «уже идёт»", code == 400 and "уже идёт" in r["error"])
code, r = req("/api/quit", {})
check("выключить сервис во время записи нельзя", code == 400, r.get("error"))
j = finished()
check("запись завершена", j and j["status"] == "done" and j["progress"] == blocks, j and j["message"])
hdr = [c for c in FK.calls if c[0] == "header"]
check("заголовок 04 38, N = 0x740 в [8..9]", hdr and hdr[0][1][0] == 0x38 and hdr[0][1][2] == {8: 0x40, 9: 0x07}, str(hdr[:1]))
check("в клавиатуру ушли ровно байты pack.bin, блоками по 4096", len(kb.blocks) == blocks and set(kb.blocks) == {4097}
      and kb.sha.hexdigest() == sha)
names = [c[0] for c in FK.calls]
check("транзакция 04 18…04 02 закрыта, потом показ экрана восстановлен",
      names[:2] == ["begin", "header"] and names.count("end") >= 1 and names[-1] in ("set_time", "select_slot"), str(names[-3:]))
g = req("/api/screen/graphics")[1]
check("статус: залит этот набор, источник studio", g["matches"] and g["written"]["source"] == "studio"
      and g["written"]["blocks"] == blocks, str(g["written"]))
check("журнал — во временной папке заглушки, не в журнале пользователя", G.RUNS.startswith(tmp) and os.listdir(G.RUNS))
check("метки «оборвалось» нет", req("/api/status")[1]["unsynced"] is None)
check("клавиатура свободна после записи", req("/api/lighting/effect", {"mode": 11})[0] == 200)

# ---- обрыв посередине ----
FK.fail_at = 300
before = req("/api/screen/graphics")[1]["written"]
req("/api/screen/graphics/write", {"sha256": sha})
j = finished()
check("обрыв: задача с ошибкой, понятный текст без errno", j and j["status"] == "error" and "клавиатура" in j["message"]
      and "errno" not in j["message"].lower(), j and j["message"])
check("обрыв: метка «графика экрана» для баннера", req("/api/status")[1]["unsynced"] == "графика экрана")
check("обрыв: журнал не врёт, последняя полная запись прежняя", req("/api/screen/graphics")[1]["written"] == before)
FK.fail_at = None
check("после обрыва клавиатура переподключилась", wait(lambda: app.dm.connected, 10))
req("/api/screen/graphics/write", {"sha256": sha})
j = finished()
check("повторная запись снимает метку", j and j["status"] == "done" and req("/api/status")[1]["unsynced"] is None, j and j["message"])

print(f"\nитог: {ok} ок, {fail} провалов")
sys.stdout.flush()
httpd.shutdown()
os._exit(1 if fail else 0)
