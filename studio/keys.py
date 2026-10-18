"""Геометрия и коды клавиш Lunacy In Space (data/keyboard.json): имя, HID, индексы клавиши и светодиода, прямоугольник."""
import os, json

HERE = os.path.dirname(os.path.abspath(__file__))
LAYOUT = os.path.join(HERE, "data", "keyboard.json")   # своя таблица: имя, HID, индексы, ряд/столбец, прямоугольник

# HID usage -> Windows VK (US-позиции). Для подсветки нажатий и подсказчика горячих клавиш.
HID_TO_VK = {**{0x04 + i: 0x41 + i for i in range(26)},
             **{0x1E + i: 0x31 + i for i in range(9)}, 0x27: 0x30,
             0x28: 0x0D, 0x29: 0x1B, 0x2A: 0x08, 0x2B: 0x09, 0x2C: 0x20, 0x2D: 0xBD, 0x2E: 0xBB,
             0x2F: 0xDB, 0x30: 0xDD, 0x31: 0xDC, 0x33: 0xBA, 0x34: 0xDE, 0x35: 0xC0, 0x36: 0xBC,
             0x37: 0xBE, 0x38: 0xBF, 0x39: 0x14, **{0x3A + i: 0x70 + i for i in range(12)},
             0x46: 0x2C, 0x47: 0x91, 0x48: 0x13, 0x49: 0x2D, 0x4A: 0x24, 0x4B: 0x21, 0x4C: 0x2E,
             0x4D: 0x23, 0x4E: 0x22, 0x4F: 0x27, 0x50: 0x25, 0x51: 0x28, 0x52: 0x26, 0x53: 0x90,
             0x54: 0x6F, 0x55: 0x6A, 0x56: 0x6D, 0x57: 0x6B, 0x58: 0x0D,
             **{0x59 + i: 0x61 + i for i in range(9)}, 0x62: 0x60, 0x63: 0x6E,
             0xE0: 0xA2, 0xE1: 0xA0, 0xE2: 0xA4, 0xE3: 0x5B, 0xE4: 0xA3, 0xE5: 0xA1, 0xE6: 0xA5, 0xE7: 0x5C}

# Имена для подсказчика (hotkeys.json) -> HID
NAME_TO_HID = {**{chr(0x41 + i): 0x04 + i for i in range(26)},
               **{str((i + 1) % 10): 0x1E + i for i in range(10)},
               "Enter": 0x28, "Esc": 0x29, "Backspace": 0x2A, "Tab": 0x2B, "Space": 0x2C, "-": 0x2D,
               "=": 0x2E, "[": 0x2F, "]": 0x30, "\\": 0x31, ";": 0x33, "'": 0x34, "`": 0x35, ",": 0x36,
               ".": 0x37, "/": 0x38, "Caps": 0x39, **{f"F{i + 1}": 0x3A + i for i in range(12)},
               "Insert": 0x49, "Home": 0x4A, "PageUp": 0x4B, "Delete": 0x4C, "End": 0x4D, "PageDown": 0x4E,
               "Right": 0x4F, "Left": 0x50, "Down": 0x51, "Up": 0x52,
               "Ctrl": 0xE0, "Shift": 0xE1, "Alt": 0xE2, "Win": 0xE3, "RCtrl": 0xE4, "RShift": 0xE5, "RAlt": 0xE6}

MOD_VK = {"ctrl": (0xA2, 0xA3, 0x11), "shift": (0xA0, 0xA1, 0x10), "alt": (0xA4, 0xA5, 0x12), "win": (0x5B, 0x5C)}


class Key:
    __slots__ = ("name", "hid", "key_index", "light_index", "row", "col", "x", "y", "w", "h")

    def as_dict(self):
        return {s: getattr(self, s) for s in self.__slots__}


def load(path=LAYOUT):
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    keys = []
    for row in doc["keys"]:
        k = Key()
        for name, value in zip(doc["fields"], row):
            setattr(k, name, value)
        keys.append(k)
    return keys


KEYS = load()
BY_HID = {k.hid: k for k in KEYS if k.name != "Enter" or k.hid == 0x28}
BY_VK = {}
for _k in KEYS:
    vk = HID_TO_VK.get(_k.hid)
    if vk is not None and vk not in BY_VK:
        BY_VK[vk] = _k
for _vk, _names in ((0x11, ("Left Ctrl",)), (0x10, ("Left Shift",)), (0x12, ("Left Alt",))):
    BY_VK[_vk] = next(k for k in KEYS if k.name in _names)
FN_KEY = next(k for k in KEYS if k.name == "Fn")


if __name__ == "__main__":
    diff = [(k.name, k.key_index, k.light_index) for k in KEYS if k.key_index != k.light_index]
    print(len(KEYS), "клавиш; key_index != light_index:", diff or "нет")
    print("строк:", sorted({k.row for k in KEYS}), "столбцов:", max(k.col for k in KEYS) + 1)
