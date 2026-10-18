"""Хранилище профиля без клавиатуры и без сервиса: всё во временной папке.
profile.json — единственная копия раскладки и макросов (клавиатура их не отдаёт), поэтому проверяем восстановление.
Запуск: python -I tests/t9_store.py"""
import json, os, sys, tempfile
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from studio.store import Store  # noqa: E402

ok = fail = 0
def check(name, cond, extra=""):
    global ok, fail
    ok, fail = ok + bool(cond), fail + (not cond)
    print(("OK  " if cond else "FAIL") + f" {name}" + ("" if cond else f" {extra}"))

def fresh():
    d = tempfile.mkdtemp(); return os.path.join(d, "profile.json")

p = fresh()
s = Store(p); s.data["macros"] = [{"name": "A", "actions": []}]; s.save()
s.data["macros"].append({"name": "B", "actions": []}); s.save()
check("целый файл читается без ошибки", len(Store(p).data["macros"]) == 2 and Store(p).error is None)

open(p, "w").write("{битый")
s = Store(p)
check("битый файл → резервная копия", [m["name"] for m in s.data["macros"]] == ["A"] and "резервной" in (s.error or ""), s.error)
check("битый файл отложен", os.path.exists(p + ".broken"))
open(p, "w").write("{снова битый")
Store(p)
check("второй сбой не затирает первый .broken", len([f for f in os.listdir(os.path.dirname(p)) if f.endswith(".broken")]) == 2)

p = fresh(); json.dump([1, 2], open(p, "w"))
s = Store(p)
check("список вместо объекта без копии → чистый лист с объяснением", s.data["macros"] == [] and "нет" in (s.error or ""), s.error)

p = fresh(); json.dump({"macros": [{"name": "X", "actions": []}], "smart": None, "lighting": "x"}, open(p, "w"))
s = Store(p)
check("испорченные поля → умолчания только для них", s.data["macros"][0]["name"] == "X" and s.data["smart"]["hints"] is True
      and "smart" in (s.error or "") and "lighting" in (s.error or ""), s.error)

p = fresh(); json.dump({"keymap": {"base": {"55": {"type": "key", "hid": 41}}}, "macros": []}, open(p, "w"))
s = Store(p)
check("раскладка без слоя fn не выкидывает файл", s.data["keymap"]["base"].get("55", {}).get("hid") == 41 and s.data["keymap"]["fn"] == {})

p = fresh(); s = Store(p); s.data["macros"] = [{"name": "K", "actions": []}]; s.save(); s.save(); os.remove(p)
s = Store(p)
check("файл пропал, копия есть → копия", [m["name"] for m in s.data["macros"]] == ["K"] and s.error, s.error)

p = fresh(); s = Store(p); s.data["macros"] = [{"name": "M", "actions": []}]; s.save()
check("после сохранения есть и файл, и копия", os.path.exists(p) and not os.path.exists(p + ".tmp"))

print(f"\nитог: {ok} ок, {fail} провалов")
sys.exit(1 if fail else 0)
