"""Профиль — источник правды о раскладке, макросах и подсветке (клавиатура раскладку не отдаёт).
Хранится в %APPDATA%\\LunacyStudio\\profile.json; запись атомарная, предыдущая версия — profile.bak.json."""
import json, os, threading, copy, shutil, datetime

DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "LunacyStudio")
PATH = os.path.join(DIR, "profile.json")

DEFAULT = {
    "version": 1,
    "keymap": {"base": {}, "fn": {}},          # key_index(str) -> действие (см. actions.py)
    "macros": [],                              # [{"name": str, "actions": [[kind, value], ...]}]
    "triggers": [],                            # макрос на сочетание (combos.py): [{"mods": [...], "hid": int, "macro": int}]
    "lighting": {"kind": "effect", "mode": 11, "rgb": [255, 255, 255], "colorful": 1,
                 "brightness": 5, "speed": 3, "direction": 0,
                 "user_colors": {}, "user_brightness": 5},
    "effect_names": {},                        # mode(str) -> имя эффекта, которое пользователь задал сам
    "screen": {"display": "clock", "slot": 2, "auto_time": True},
    "settings": None,                          # None = не трогали; иначе dict для 04 17
    "smart": {"hints": True, "hint_delay_ms": 350, "layout_flash": True, "claude": True,
              "heatmap_count": False, "software": None,      # None | "heatmap" | "ambilight" | "load" | "solid"
              "solid_rgb": [40, 0, 120], "brightness": 1.0},
    "heatmap": {},                             # light_index(str) -> число нажатий
    "heatmap_since": None,                     # ISO-дата: с какого дня считаем (включение подсчёта или обнуление)
    "active_profile": None,                    # имя профиля из profiles/, который последним сохраняли или применяли
    "unsynced": None,                          # запись в клавиатуру оборвалась посередине: что именно (для баннера)
    "updates": {"auto": True},                 # проверять обновления на GitHub (updater.py)
    "experimental": None,                      # запись графики во флеш и «Живые числа»: None — не решали (см. server.experimental_on)
}
NULLABLE = {"settings", "heatmap_since", "active_profile", "unsynced", "experimental"}


class Store:
    def __init__(self, path=PATH):
        self.path = path
        self.bak = path[:-5] + ".bak.json"
        self.lock = threading.RLock()
        self.error = None
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.data = copy.deepcopy(DEFAULT)
        main_ok = os.path.exists(path) and self._load(path)
        if not main_ok and os.path.exists(path):
            broken = path + ".broken"                   # испорченный файл не затираем: откладываем рядом
            if os.path.exists(broken):                  # прежний сбой тоже храним
                broken = path + datetime.datetime.now().strftime(".%Y%m%d-%H%M%S.broken")
            os.replace(path, broken)
        if not main_ok and os.path.exists(self.bak) and self._load(self.bak):
            when = datetime.datetime.fromtimestamp(os.path.getmtime(self.bak)).strftime("%d.%m %H:%M")
            self.error = (f"файл настроек был повреждён — восстановлен из резервной копии от {when}"
                          if os.path.exists(path + ".broken") else f"файла настроек не было — восстановлен из резервной копии от {when}")
            self.save()
        elif not main_ok and any(f.startswith(os.path.basename(path)) and f.endswith(".broken") for f in os.listdir(os.path.dirname(path))):
            self.error = "файл настроек был повреждён, а резервной копии нет — программа начала с чистого листа"

    def _load(self, path):
        """Прочитать и сверить с DEFAULT по типам: поле неверного типа берётся из умолчаний. False — файл не годится."""
        try:
            with open(path, encoding="utf-8") as f:
                loaded = json.load(f)
        except (OSError, ValueError):
            return False
        if not isinstance(loaded, dict):
            return False
        data = copy.deepcopy(DEFAULT)
        bad = []
        for k, v in loaded.items():
            if k in DEFAULT and DEFAULT[k] is not None and not isinstance(v, type(DEFAULT[k]))                     and not (k in NULLABLE and v is None) and not (isinstance(DEFAULT[k], float) and isinstance(v, int)):
                bad.append(k)
                continue
            if k in ("settings", "heatmap_since", "active_profile", "unsynced") and v is not None                     and not isinstance(v, dict if k == "settings" else str):
                bad.append(k)
                continue
            if isinstance(v, dict) and isinstance(data.get(k), dict) and k not in ("keymap", "heatmap", "effect_names"):
                self._merge(data[k], v)
            else:
                data[k] = v
        for l in ("base", "fn"):
            if not isinstance(data["keymap"].get(l), dict):
                if data["keymap"].get(l) is not None:
                    bad.append(f"keymap.{l}")
                data["keymap"][l] = {}
        if not isinstance(data["macros"], list):
            return False
        self.data = data
        if bad:
            self.error = f"в файле настроек испорчены поля {', '.join(bad)} — для них взяты значения по умолчанию"
        return True

    @staticmethod
    def _merge(dst, src):  # noqa: D401
        for k, v in src.items():
            if isinstance(v, dict) and isinstance(dst.get(k), dict) and k not in ("keymap", "heatmap", "effect_names"):
                Store._merge(dst[k], v)
            else:
                dst[k] = v

    def get(self, *path):
        with self.lock:
            d = self.data
            for p in path:
                d = d[p]
            return copy.deepcopy(d)

    def set(self, value, *path):
        with self.lock:
            d = self.data
            for p in path[:-1]:
                d = d[p]
            d[path[-1]] = value
            self.save()

    def save(self):
        """Атомарно и надёжно: новый файл целиком на диске (fsync) → копия прежнего в .bak → подмена.
        Ни в один момент на диске не бывает «ни одного» profile.json."""
        with self.lock:
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=1)
                f.flush(); os.fsync(f.fileno())
            if os.path.exists(self.path):
                shutil.copyfile(self.path, self.bak)
            os.replace(tmp, self.path)
