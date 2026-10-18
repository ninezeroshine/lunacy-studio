"""Живой экран (числа вместо часов) на заглушке клавиатуры: вход меняет фон (04 38, 16 блоков) и шлёт числа,
дальше числа раз в секунду; синхронизация времени их не затирает; выход возвращает обычный фон и время;
фоновый цикл сам чинит рассогласование фона и режима; по радио отказ. В клавиатуру ничего не пишет.
python -I tests/t13_live_screen.py"""
import json, os, sys, time, urllib.request, urllib.error
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import stub_studio                                  # noqa: E402

PORT = 47803
app, httpd, tmp = stub_studio.start(PORT, block_delay=0.004)
import fake_kb                                      # noqa: E402
from studio import server, graphics as G            # noqa: E402
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


# «Живые числа» — экспериментальная функция: без включения режим не включается
c0, r0 = req("/api/screen/display", {"display": "live"})
check("без экспериментального режима «Живые числа» отклонены", c0 == 400 and "эксперимент" in r0.get("error", ""), r0)
req("/api/experimental", {"on": True})


def wait(cond, timeout=10):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = cond()
        if v:
            return v
        time.sleep(0.05)
    return None


def since(mark):
    return FK.calls[mark:]


def writes38(calls):
    return [c[1][2] for c in calls if c[0] == "header" and c[1][0] == 0x38]


def screen():
    return app.store.get("screen")


wait(lambda: app.dm.connected)
head_live, head_plain = G.head(True), G.head(False)
check("заголовки набора: по 16 блоков, отличаются только фоном", len(head_live) == len(head_plain) == 16 * 4096
      and head_live[G.BG_BYTES:] == head_plain[G.BG_BYTES:] and head_live[:G.BG_BYTES] != head_plain[:G.BG_BYTES])
code, png = req("/api/screen/pack/_live.png")
check("превью фона живого экрана — PNG", code == 200 and png[:8] == b"\x89PNG\r\n\x1a\n")

check("режим без токена — 403", req("/api/screen/display", {"display": "live", "slot": 2}, token=False)[0] == 403)
check("неизвестный режим — 400", req("/api/screen/display", {"display": "tv", "slot": 2})[0] == 400)

app.dm.kb.wireless = True
mark = len(FK.calls)
code, r = req("/api/screen/display", {"display": "live", "slot": 2})
check("по радио — 400 «только по кабелю»", code == 400 and "кабел" in r.get("error", ""), r.get("error"))
check("после отказа клавиатура не трогалась", not writes38(since(mark)))
app.dm.kb.wireless = False

# ---- вход ----
mark = len(FK.calls)
code, r = req("/api/screen/display", {"display": "live", "slot": 2})
calls = since(mark)
check("вход в живой экран — 200", code == 200, str(r))
check("вход: одна запись 04 38 на 16 блоков", writes38(calls) == [{8: 16, 9: 0}], str(writes38(calls)))
check("вход: заглушка получила 16 блоков фона", app.dm.kb.blocks[-16:] == [4097] * 16)
check("вход: сразу отправлены числа", any(c[0] == "show_numbers" for c in calls))
s = screen()
check("профиль: display=live, live_bg=true", s["display"] == "live" and s.get("live_bg") is True, str(s))

# ---- раз в секунду ----
mark = len(FK.calls)
time.sleep(3.3)
nums = [c for c in since(mark) if c[0] == "show_numbers"]
check("числа идут раз в секунду (3–4 за 3.3 с)", 3 <= len(nums) <= 4, str(len(nums)))
args = nums[-1][1] if nums else ()
check("числа в пределах полей", len(args) >= 6 and args[0] <= 99 and args[1] == 0 and args[2] <= 39 and args[3] <= 39
      and args[4] <= 79 and args[5] == 0, str(args))
check("за это время фон не переписывался", not writes38(since(mark)))
st = req("/api/status")[1]["screen_live"]
check("статус: on, фон с подписями, показанные числа", st["on"] and st["bg"] and st["shown"]
      and st["shown"]["date"].startswith("20") and len(st["shown"]["time"]) == 8, str(st))

mark = len(FK.calls)
code, r = req("/api/screen/time", {})
check("синхронизация времени в живом режиме не ставит время", code == 200 and "живые числа" in r.get("message", "")
      and not [c for c in since(mark) if c[0] == "set_time"], r.get("message"))

mark = len(FK.calls)
code, r = req("/api/screen/display", {"display": "live", "slot": 2})
check("повторный вход не переписывает фон", code == 200 and not writes38(since(mark)))

# ---- выход ----
mark = len(FK.calls)
code, r = req("/api/screen/display", {"display": "clock", "slot": 2})
calls = since(mark)
check("выход — 200", code == 200, str(r))
check("выход: одна запись 04 38 на 16 блоков", writes38(calls) == [{8: 16, 9: 0}], str(writes38(calls)))
check("выход: настоящее время поставлено", any(c[0] == "set_time" for c in calls))
s = screen()
check("профиль: display=clock, live_bg=false", s["display"] == "clock" and s.get("live_bg") is False, str(s))
mark = len(FK.calls)
time.sleep(2.2)
check("после выхода числа не шлются", not [c for c in since(mark) if c[0] == "show_numbers"])

# ---- выход сразу в анимацию ----
req("/api/screen/display", {"display": "live", "slot": 1})
mark = len(FK.calls)
code, r = req("/api/screen/display", {"display": "gif", "slot": 1})
calls = since(mark)
check("из живого экрана в анимацию: фон, время, слот", code == 200 and writes38(calls) == [{8: 16, 9: 0}]
      and any(c[0] == "set_time" for c in calls) and any(c[0] == "select_slot" for c in calls))

# ---- самовосстановление ----
s = screen(); s.update(display="clock", live_bg=True); app.store.set(s, "screen")     # «упала посреди выхода»
mark = len(FK.calls)
fixed = wait(lambda: screen().get("live_bg") is False and any(c[0] == "set_time" for c in since(mark)), 5)
check("цикл сам вернул обычный фон, если режим не live", fixed and writes38(since(mark)) == [{8: 16, 9: 0}])

s = screen(); s.update(display="live", live_bg=False); app.store.set(s, "screen")    # «набор перезалили»
mark = len(FK.calls)
fixed = wait(lambda: screen().get("live_bg") is True and screen()["display"] == "live" and writes38(since(mark))
             and any(c[0] == "show_numbers" for c in since(mark)), 5)
check("цикл сам вернул фон с подписями в режиме live", fixed and writes38(since(mark)) == [{8: 16, 9: 0}])
req("/api/screen/display", {"display": "clock", "slot": 2})

# ---- обрыв посередине смены фона ----
FK.fail_at = 5
mark = len(FK.calls)
code, r = req("/api/screen/display", {"display": "live", "slot": 2})
FK.fail_at = None
check("обрыв на входе — ошибка, профиль не в live", code >= 400 and screen()["display"] != "live", f"{code} {r}")
healed = wait(lambda: screen().get("live_bg") is False and req("/api/status")[1].get("unsynced") is None
              and len(writes38(since(mark))) >= 2, 15)
calls = since(mark)
check("после обрыва цикл сам переписал обычный фон и снял баннер", healed, str(writes38(calls)))
check("после обрыва поставлено настоящее время", any(c[0] == "set_time" for c in calls))

print(f"\nитог: {ok} ок, {fail} провалов")
sys.stdout.flush()
httpd.shutdown()
os._exit(1 if fail else 0)
