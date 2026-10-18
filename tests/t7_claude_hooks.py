"""Хуки Claude Code на временной копии settings.json: настоящий ~/.claude/settings.json не трогается.
Запуск: python -I tests/t7_claude_hooks.py"""
import json, os, sys, shutil, tempfile, copy
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from studio import claude_hooks as CH  # noqa: E402

ok = fail = 0
def check(name, cond, info=""):
    global ok, fail
    ok, fail = ok + bool(cond), fail + (not cond)
    print(("OK   " if cond else "FAIL ") + name + (f" — {info}" if info else ""))


ORIG = {"model": "opus", "permissions": {"allow": ["Bash(git status)"]},
        "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "notify.exe", "args": ["done"]}]}],
                  "PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "guard.cmd"}]}]}}
d = tempfile.mkdtemp(prefix="lunacy-t7-")
p = os.path.join(d, "settings.json")
assert os.path.normcase(os.path.abspath(p)) != os.path.normcase(CH.PATH)
with open(p, "w", encoding="utf-8") as f:
    json.dump(ORIG, f)

st = CH.status(p)
check("до установки: не установлено", not st["installed"] and not st["partial"] and st["events"] == [])
check("превью — все 5 событий", sorted(json.loads(st["preview"])["hooks"]) == sorted(CH.EVENTS))

r = CH.install(p)
data = json.load(open(p, encoding="utf-8"))
check("установка добавила 5 событий", sorted(r["added"]) == sorted(CH.EVENTS), str(r["added"]))
check("копия прежнего файла", r["backup"] and json.load(open(r["backup"], encoding="utf-8")) == ORIG, str(r["backup"]))
check("чужое не тронуто", data["model"] == "opus" and data["permissions"] == ORIG["permissions"]
      and data["hooks"]["PreToolUse"] == ORIG["hooks"]["PreToolUse"]
      and data["hooks"]["Stop"][0] == ORIG["hooks"]["Stop"][0])
check("наш обработчик: exec-форма, async", data["hooks"]["Notification"] == [{"hooks": [CH.HANDLER]}])
st = CH.status(p)
check("статус: установлено", st["installed"] and not st["partial"] and json.loads(st["preview"]) == {"hooks": {}})

before = json.load(open(p, encoding="utf-8"))
r = CH.install(p)
check("повторная установка ничего не добавляет", r["added"] == [] and r["backup"] is None
      and json.load(open(p, encoding="utf-8")) == before)

r = CH.uninstall(p)
data = json.load(open(p, encoding="utf-8"))
check("удаление убрало 5 событий", sorted(r["removed"]) == sorted(CH.EVENTS), str(r["removed"]))
check("после удаления файл = исходный", data == ORIG, json.dumps(data, ensure_ascii=False)[:200])

# только наши хуки → поле hooks исчезает целиком
with open(p, "w", encoding="utf-8") as f:
    json.dump({"model": "opus"}, f)
CH.install(p); CH.uninstall(p)
check("пустые группы и hooks удаляются", json.load(open(p, encoding="utf-8")) == {"model": "opus"})

# частичная установка
with open(p, "w", encoding="utf-8") as f:
    json.dump({"hooks": {"Stop": [{"hooks": [copy.deepcopy(CH.HANDLER)]}]}}, f)
st = CH.status(p)
check("частично: partial", st["partial"] and st["events"] == ["Stop"])

# битый JSON — отказ, файл не меняется
with open(p, "w", encoding="utf-8") as f:
    f.write('{"model": "opus",')
for fn in (CH.install, CH.uninstall):
    try:
        fn(p); check(f"{fn.__name__}: битый JSON — отказ", False)
    except ValueError as e:
        check(f"{fn.__name__}: битый JSON — отказ", open(p, encoding="utf-8").read() == '{"model": "opus",', str(e)[-60:])
check("статус на битом файле — ошибка, не исключение", CH.status(p)["error"])

# нет файла — создаётся без копии
q = os.path.join(d, "new", "settings.json")
r = CH.install(q)
check("нет файла: создан, копии нет", r["backup"] is None and CH.status(q)["installed"])

check("события хуков → состояния", [CH.state_for({"hook_event_name": e}) for e in ("UserPromptSubmit", "StopFailure", "Foo")]
      == [(True, "working"), (True, "error"), (False, None)]
      and CH.state_for({"hook_event_name": "Notification", "notification_type": "idle_prompt"}) == (True, None))

backups = [f for f in os.listdir(d) if ".lunacy-backup-" in f]
check("копии в одну секунду не затирают друг друга", len(backups) == len(set(backups)) >= 4, str(len(backups)))
shutil.rmtree(d)
print(f"\nитог: {ok} ок, {fail} провалов")
sys.exit(1 if fail else 0)
