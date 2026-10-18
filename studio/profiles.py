"""Профили — снимки того, что живёт в клавиатуре: раскладка (база + Fn), макросы, подсветка, настройки.
Файлы %APPDATA%\\LunacyStudio\\profiles\\<имя>.json; имя — имя файла, поэтому проверяется строго."""
import json, os, re, copy, datetime
from . import actions as A
from .store import DIR, DEFAULT

PDIR = os.path.join(DIR, "profiles")
FORMAT = "lunacy-studio-profile"
FIELDS = ("keymap", "macros", "triggers", "lighting", "settings")
BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}
SETTINGS = {"disable_alttab": (0, 1), "disable_altf4": (0, 1), "disable_win": (0, 1), "fn_mode": (0, 1),
            "sleep": (0, 3), "debounce": (0, 4)}


def clean_name(name):
    name = " ".join(str(name or "").split())
    if not name:
        raise ValueError("имя профиля пустое")
    if len(name) > 40:
        raise ValueError("имя профиля длиннее 40 символов")
    if BAD.search(name) or name.endswith("."):
        raise ValueError('в имени профиля нельзя \\ / : * ? " < > | и точку в конце')
    if name.split(".")[0].strip().lower() in RESERVED:
        raise ValueError(f"«{name}» — служебное имя Windows, выбери другое")
    return name


def path(name):
    return os.path.join(PDIR, clean_name(name) + ".json")


# имена полей для сообщений об ошибке — по-русски, как в интерфейсе
NAMES_RU = {"colorful": "разноцветный", "brightness": "яркость", "speed": "скорость", "direction": "направление",
            "user_brightness": "яркость своих цветов", "disable_alttab": "блокировка Alt+Tab", "disable_altf4": "блокировка Alt+F4",
            "disable_win": "блокировка Win", "fn_mode": "режим Fn", "sleep": "сон", "debounce": "антидребезг"}


def _int(v, lo, hi, what):
    try:
        v = int(v)
    except (TypeError, ValueError):
        raise ValueError(f"{what}: {v!r} — не число")
    if not lo <= v <= hi:
        raise ValueError(f"{what}: {v} вне диапазона {lo}–{hi}")
    return v


def validate(p):
    """Проверить и нормализовать содержимое профиля (импорт — граница доверия). Возвращает dict FIELDS."""
    if not isinstance(p, dict):
        raise ValueError("профиль: нужен JSON-объект")
    km = p.get("keymap") or {}
    if not isinstance(km, dict):
        raise ValueError("профиль: keymap должен быть объектом")
    keymap = {}
    for layer in ("base", "fn"):
        src = km.get(layer) or {}
        if not isinstance(src, dict):
            raise ValueError(f"профиль: keymap.{layer} должен быть объектом")
        keymap[layer] = {}
        for k, act in src.items():
            idx = _int(k, 0, 143, "номер клавиши")
            if not isinstance(act, dict):
                raise ValueError(f"клавиша {idx}: действие должно быть объектом")
            try:
                A.encode(act)
            except (KeyError, TypeError) as e:
                raise ValueError(f"клавиша {idx}: неполное действие ({e})")
            if act.get("type", "default") != "default":
                keymap[layer][str(idx)] = act
    macros = p.get("macros") or []
    A.check_macros(macros)
    l = copy.deepcopy(DEFAULT["lighting"])
    src = p.get("lighting") or {}
    if not isinstance(src, dict):
        raise ValueError("профиль: lighting должен быть объектом")
    l.update({k: v for k, v in src.items() if k in l})
    if l["kind"] not in ("effect", "user"):
        raise ValueError("подсветка: kind должен быть effect или user")
    _int(l["mode"], 0, 19, "эффект")
    for k, hi in (("colorful", 1), ("brightness", 5), ("speed", 5), ("direction", 1), ("user_brightness", 5)):
        l[k] = _int(l[k], 0, hi, NAMES_RU.get(k, k))
    l["mode"] = int(l["mode"])
    l["rgb"] = [_int(c, 0, 255, "цвет") for c in l["rgb"]][:3]
    if len(l["rgb"]) != 3 or not isinstance(l["user_colors"], dict):
        raise ValueError("подсветка: rgb — три числа, user_colors — объект")
    l["user_colors"] = {str(_int(i, 0, 143, "клавиша")): [_int(c, 0, 255, "цвет") for c in rgb][:3]
                        for i, rgb in l["user_colors"].items()}
    s = p.get("settings")
    if s is not None:
        if not isinstance(s, dict):
            raise ValueError("профиль: settings должен быть объектом или null")
        s = {k: _int(s.get(k, 0), lo, hi, NAMES_RU.get(k, k)) for k, (lo, hi) in SETTINGS.items()}
    # сочетания клавиш для макросов (combos.py) — у старых профилей их нет
    from . import combos as C
    triggers = C.check(p.get("triggers") or [], len(macros))
    return {"keymap": keymap, "macros": macros, "triggers": triggers, "lighting": l, "settings": s}


def summary(name, p):
    lt = p.get("lighting") if isinstance(p.get("lighting"), dict) else {}
    return {"name": name, "saved_at": p.get("saved_at"),
            "counts": {"keys": sum(len(p.get("keymap", {}).get(l) or {}) for l in ("base", "fn")),
                       "macros": len(p.get("macros") or [])},
            # для карточки профиля: какой эффект и цвет, есть ли свои настройки клавиатуры
            "lighting": {k: lt.get(k) for k in ("kind", "mode", "rgb", "colorful", "brightness") if k in lt},
            "has_settings": bool(p.get("settings"))}


def document(name, content):
    """Полный JSON профиля, как он лежит в файле и уходит при экспорте."""
    return {"format": FORMAT, "version": 1, "name": name,
            "saved_at": datetime.datetime.now().isoformat(timespec="seconds"), **content}


def load(name):
    try:
        with open(path(name), encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise ValueError(f"профиля «{name}» нет — обнови список")


def save(name, content):
    name = clean_name(name)
    os.makedirs(PDIR, exist_ok=True)
    doc = document(name, content)
    tmp = path(name) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path(name))
    return doc


def listing():
    out = []
    if os.path.isdir(PDIR):
        for fn in os.listdir(PDIR):
            if fn.endswith(".json"):
                try:
                    with open(os.path.join(PDIR, fn), encoding="utf-8") as f:
                        out.append(summary(fn[:-5], json.load(f)))
                except (OSError, ValueError, TypeError, AttributeError):   # не объект, поля не того типа
                    out.append({"name": fn[:-5], "saved_at": None, "counts": None, "error": "файл повреждён"})
    return sorted(out, key=lambda p: p["name"].lower())


def exists(name):
    return os.path.isfile(path(name))


def delete(name):
    try:
        os.remove(path(name))
    except FileNotFoundError:
        raise ValueError(f"профиля «{name}» нет — обнови список")


def rename(name, to):
    src, dst = path(name), path(to)
    if not os.path.isfile(src):
        raise ValueError(f"профиля «{name}» нет — обнови список")
    if os.path.isfile(dst) and os.path.normcase(src) != os.path.normcase(dst):
        raise ValueError(f"профиль «{clean_name(to)}» уже есть — выбери другое имя")
    with open(src, encoding="utf-8") as f:
        doc = json.load(f)
    doc["name"] = clean_name(to)
    with open(src + ".tmp", "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    os.replace(src + ".tmp", src)
    os.replace(src, dst)
    return doc["name"]


def free_name(name):
    """Имя для импорта: «Имя», «Имя (2)», … — существующий профиль не затирается."""
    base = clean_name(name)
    cand, i = base, 2
    while exists(cand):
        suffix = f" ({i})"
        cand = base[:40 - len(suffix)].rstrip() + suffix
        i += 1
    return cand
