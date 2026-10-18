"""Действия клавиш профиля -> 4 байта раскладки и макросы -> действия прошивки. Источник кодов: PROTOCOL.md,
FUN_004187b0 (типы записей), FUN_00419690 (consumer-коды)."""

MEDIA = {  # имя -> consumer usage (FUN_00419690 и тип 6 в FUN_004187b0)
    "play_pause": 0xCD, "stop": 0xB7, "prev": 0xB6, "next": 0xB5, "vol_up": 0xE9, "vol_down": 0xEA,
    "mute": 0xE2, "my_computer": 0x194, "calculator": 0x192, "mail": 0x18A, "media": 0x183,
    "browser_home": 0x223, "browser_refresh": 0x227, "browser_stop": 0x226, "browser_back": 0x224,
    "browser_forward": 0x225, "bookmarks": 0x22A, "search": 0x221,
}
MOUSE = {  # [1], [2] после типа 01 (FUN_004187b0, ветка iVar5 == 5); маска кнопок как в HID-мыши
    "left": (0x01, 0x01), "right": (0x01, 0x02), "middle": (0x01, 0x04), "back": (0x01, 0x08),
    "forward": (0x01, 0x10), "wheel_up": (0x03, 0x01), "wheel_down": (0x03, 0xFF),
}
MOD_BITS = {"ctrl": 1, "shift": 2, "alt": 4, "win": 8}
MODIFIER_HID = {0xE0: 0x01, 0xE1: 0x02, 0xE2: 0x04, 0xE3: 0x08, 0xE4: 0x10, 0xE5: 0x20, 0xE6: 0x40, 0xE7: 0x80}


def encode(action) -> bytes:
    t = action.get("type", "default")
    if t == "default":
        return b"\0\0\0\0"
    if t == "key":
        hid, mods = int(action["hid"]), int(action.get("mods", 0))
        if hid in MODIFIER_HID and not mods:
            return bytes((0x02, MODIFIER_HID[hid], 0, 0))
        if hid > 0x65 and hid not in MODIFIER_HID:
            raise ValueError("коды выше 0x65 (F13–F24 и т. п.) клавиатура не доносит до системы")
        return bytes((0x02, mods & 0xFF, hid, 0))
    if t == "media":
        c = MEDIA[action["name"]] if "name" in action else int(action["code"])
        return bytes((0x03, c & 0xFF, c >> 8, 0))
    if t == "mouse":
        a, b = MOUSE[action["name"]]
        return bytes((0x01, a, b, 0))
    if t == "macro":
        return bytes((0x06, int(action["index"]), int(action.get("mode", 1)), int(action.get("count", 1))))
    if t == "disabled":
        return bytes((0x05, 0x03, 0, 0))
    raise ValueError(f"неизвестное действие {t}")


def keymap_entries(layer: dict) -> dict:
    return {int(k): encode(v) for k, v in layer.items() if v and v.get("type", "default") != "default"}


# --- текст -> макрос (US-раскладка; русский текст печатается, если в системе включена RU и клавиши те же) ---
_US = {**{c: (0x04 + i, False) for i, c in enumerate("abcdefghijklmnopqrstuvwxyz")},
       **{c: (0x04 + i, True) for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ")},
       **{c: (0x1E + i, False) for i, c in enumerate("1234567890")},
       **{c: (0x1E + i, True) for i, c in enumerate("!@#$%^&*()")},
       " ": (0x2C, False), "\n": (0x28, False), "\t": (0x2B, False),
       "-": (0x2D, False), "_": (0x2D, True), "=": (0x2E, False), "+": (0x2E, True),
       "[": (0x2F, False), "{": (0x2F, True), "]": (0x30, False), "}": (0x30, True),
       "\\": (0x31, False), "|": (0x31, True), ";": (0x33, False), ":": (0x33, True),
       "'": (0x34, False), '"': (0x34, True), "`": (0x35, False), "~": (0x35, True),
       ",": (0x36, False), "<": (0x36, True), ".": (0x37, False), ">": (0x37, True),
       "/": (0x38, False), "?": (0x38, True)}
_RU = "фисвуапршолдьтщзйкыегмцчня"   # буквы ЙЦУКЕН на позициях a..z (ф=a, и=b, ...)
# остальные буквы ЙЦУКЕН стоят на клавишах знаков: ё ` х [ ъ ] ж ; э ' б , ю .
_RU_EXTRA = {"ё": 0x35, "х": 0x2F, "ъ": 0x30, "ж": 0x33, "э": 0x34, "б": 0x36, "ю": 0x37}
# знаки в русской раскладке: точка и запятая на клавише «/», остальное — Shift+цифра
_RU_PUNCT = {".": (0x38, False), ",": (0x38, True), "!": (0x1E, True), '"': (0x1F, True), "№": (0x20, True),
             ";": (0x21, True), "%": (0x22, True), ":": (0x23, True), "?": (0x24, True), "*": (0x25, True),
             "(": (0x26, True), ")": (0x27, True)}


def text_to_actions(text, delay=12):
    """Макрос нажимает клавиши, а не буквы. Текст с русскими буквами и без латиницы набирается как в русской
    раскладке (и знаки — по её местам); иначе — как в английской."""
    ru = any(c.lower() in _RU or c.lower() in _RU_EXTRA for c in text) and not any("a" <= c.lower() <= "z" for c in text)
    acts = []
    for ch in text:
        low = ch.lower()
        if low in _RU:
            hid, shift = 0x04 + _RU.index(low), ch.isupper()
        elif low in _RU_EXTRA:
            hid, shift = _RU_EXTRA[low], ch.isupper()
        elif ru and ch in _RU_PUNCT:
            hid, shift = _RU_PUNCT[ch]
        elif ch in _US:
            hid, shift = _US[ch]
        else:
            raise ValueError(f"символ {ch!r} нельзя набрать макросом")
        if shift:
            acts.append(["down", 0xE1])
        acts += [["down", hid], ["delay", delay], ["up", hid]]
        if shift:
            acts.append(["up", 0xE1])
        acts.append(["delay", delay])
    return acts


MACRO_KINDS = ("down", "up", "mdown", "mup", "delay")


def check_macros(macros):
    """Проверить макросы профиля до записи: число, виды действий, значения, размер буфера (3.5 КБ)."""
    if not isinstance(macros, list) or len(macros) > 100:
        raise ValueError("макросы: нужен список, не больше 100")
    for m in macros:
        if not isinstance(m, dict) or not isinstance(m.get("actions", []), list):
            raise ValueError("макрос: нужен объект с полем actions")
        for a in m.get("actions", []):
            if not (isinstance(a, list) and len(a) == 2 and a[0] in MACRO_KINDS):
                raise ValueError(f"неизвестное действие макроса {a!r}")
            if not 0 <= int(a[1]) <= (0xFFFF if a[0] == "delay" else 0xFF):
                raise ValueError(f"значение вне диапазона в действии макроса {a!r}")
    # Память 0xE00 режется блоками по 64 байта с маркером в конце блока (FUN_0042ebc0): данные помещаются до 3 520 байт.
    # Проверка по длине буфера тут не годится — macro_buffer обрезает его до 0xE00 и переполнение не видно.
    used = macros_bytes(macros)
    if used > MACRO_LIMIT:
        raise ValueError(f"макросы не помещаются в память клавиатуры: {used} из {MACRO_LIMIT} байт")


MACRO_LIMIT = 3520


def macros_bytes(macros):
    """Сколько занимает буфер: таблица 400 байт + на каждый непустой макрос 8 байт заголовка и 4 на шаг."""
    return 400 + sum(8 + 4 * len(m.get("actions") or []) for m in macros if m.get("actions"))


def macros_for_device(macros):
    out = []
    for m in macros:
        out.append([(k, int(v)) for k, v in m.get("actions", [])])
    return out


if __name__ == "__main__":
    assert encode({"type": "key", "hid": 0x29}) == bytes((2, 0, 0x29, 0))           # железо: Caps->Esc
    assert encode({"type": "key", "hid": 0x06, "mods": 1}) == bytes((2, 1, 6, 0))    # Ctrl+C как в UI
    assert encode({"type": "macro", "index": 0}) == bytes((6, 0, 1, 1))              # железо: макрос
    assert encode({"type": "media", "name": "calculator"}) == bytes((3, 0x92, 0x01, 0))
    assert text_to_actions("Hi")[:3] == [["down", 0xE1], ["down", 0x0B], ["delay", 12]]
    ru = text_to_actions("С уважением, Иван.")
    assert ["down", 0x33] in ru                                          # ж — на клавише ;
    assert ru[-4:-1] == [["down", 0x38], ["delay", 12], ["up", 0x38]]    # точка в русской — клавиша /
    assert any(ru[k:k + 2] == [["down", 0xE1], ["down", 0x38]] for k in range(len(ru)))  # запятая — Shift+/
    assert text_to_actions("a.")[-4] == ["down", 0x37]                    # в английском тексте точка своя
    big = lambda n: [{"actions": [["delay", 20]] * n}]
    check_macros(big(778))                                              # 3 520 байт — ровно влезает
    try:
        check_macros(big(779)); raise SystemExit("3 524 байта должны отклоняться")
    except ValueError:
        pass
    try:
        encode({"type": "key", "hid": 0x68}); raise SystemExit("F13 должен отклоняться")
    except ValueError:
        pass
    print("actions: ок")
