"""Макрос на сочетание клавиш (studio/combos.py): проверка входа, сверка в хуке, проигрывание.
SendInput подменён записью событий — в систему ничего не уходит. Запуск: python -I tests/t15_combos.py"""
import os, sys, time
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from studio import combos as C

ok = fail = 0
def check(name, cond, info=""):
    global ok, fail
    ok, fail = (ok + 1, fail) if cond else (ok, fail + 1)
    print(("OK  " if cond else "FAIL") + f" {name}" + (f" — {info}" if info and not cond else ""))

def raises(fn):
    try:
        fn(); return False
    except ValueError:
        return True

# ---- проверка входа ----
t = C.check([{"mods": ["shift", "ctrl", "ctrl"], "hid": 0x10, "macro": 0}], 1)
check("моды без повторов и по порядку", t == [{"mods": ["ctrl", "shift"], "hid": 0x10, "macro": 0}], t)
check("без модификатора — отказ", raises(lambda: C.check([{"mods": [], "hid": 0x10, "macro": 0}], 1)))
check("Shift + буква — отказ (это набор текста)", raises(lambda: C.check([{"mods": ["shift"], "hid": 0x04, "macro": 0}], 1)))
check("Shift + F5 — можно", C.check([{"mods": ["shift"], "hid": 0x3E, "macro": 0}], 1)[0]["hid"] == 0x3E)
check("модификатор как клавиша — отказ", raises(lambda: C.check([{"mods": ["ctrl"], "hid": 0xE1, "macro": 0}], 1)))
check("несуществующий макрос — отказ", raises(lambda: C.check([{"mods": ["ctrl"], "hid": 0x10, "macro": 3}], 2)))
check("неизвестный модификатор — отказ", raises(lambda: C.check([{"mods": ["hyper"], "hid": 0x10, "macro": 0}], 1)))
check("дубль сочетания — отказ", raises(lambda: C.check([{"mods": ["ctrl"], "hid": 0x10, "macro": 0},
                                                       {"mods": ["ctrl"], "hid": 0x10, "macro": 1}], 2)))
check("не список — отказ", raises(lambda: C.check({"mods": ["ctrl"]}, 1)))

# ---- сверка и проигрывание ----
class Store:
    def __init__(self, d): self.d = d
    def get(self, k): return self.d.get(k)

sent = []
def rec(inputs):
    for i in inputs:
        if i.type == 1: sent.append(("key", i.u.ki.wVk, bool(i.u.ki.dwFlags & 2)))
        else: sent.append(("mouse", i.u.mi.dwFlags))

macro = {"name": "привет", "actions": [["down", 0x0B], ["delay", 5], ["up", 0x0B], ["down", 0x0C], ["mdown", 1], ["mup", 1]]}
st = Store({"macros": [macro], "triggers": [{"mods": ["ctrl", "shift"], "hid": 0x10, "macro": 0}]})
c = C.Combos(st, sender=rec, pressed=lambda vk: False)
check("Ctrl+Shift+M — наше", c.on_key(0x4D, {"ctrl", "shift"}) is True)
time.sleep(0.4)
check("Ctrl+M — не наше (моды точно)", c.on_key(0x4D, {"ctrl"}) is False)
check("Ctrl+Shift+Alt+M — не наше", c.on_key(0x4D, {"ctrl", "shift", "alt"}) is False)
keys = [s for s in sent if s[0] == "key"]
check("H нажата и отпущена", keys[:2] == [("key", 0x48, False), ("key", 0x48, True)], keys)
check("I нажата и в конце отпущена сама", keys[2:] == [("key", 0x49, False), ("key", 0x49, True)], keys)
check("клик мыши: нажать и отпустить левую", [s for s in sent if s[0] == "mouse"] == [("mouse", 2), ("mouse", 4)], sent)
check("последнее проигрывание записано", c.last and c.last[1] == "привет", c.last)

sent.clear()
st.d["triggers"] = [{"mods": ["win"], "hid": 0x10, "macro": 0}]; c.reload()
c.on_key(0x4D, {"win"}); time.sleep(0.4)
check("Win+M: сначала «пустая» клавиша, чтобы не открылся Пуск", sent[:2] == [("key", C.MASK_VK, False), ("key", C.MASK_VK, True)], sent[:3])
st.d["macros"] = []
sent.clear(); c.on_key(0x4D, {"win"}); time.sleep(0.3)
check("макроса больше нет — ничего не проигрывается", [s for s in sent if s[1] != C.MASK_VK] == [], sent)

print(f"\nитог: {ok} ок, {fail} провалов")
sys.exit(1 if fail else 0)
