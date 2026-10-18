"""Что мы заливали в слоты экрана: миниатюра первого кадра (PNG 240×135) и описание.
Клавиатура слот не отдаёт, поэтому помним сами: %APPDATA%\\LunacyStudio\\slots\\slot<n>.png / .json."""
import json, os, datetime
from .store import DIR

SDIR = os.path.join(DIR, "slots")


def png_path(slot):
    return os.path.join(SDIR, f"slot{int(slot)}.png")


def save(slot, bgra, name, frames, source, lib=None):
    from lunacy import images
    os.makedirs(SDIR, exist_ok=True)
    with open(png_path(slot) + ".tmp", "wb") as f:
        f.write(images.png(bgra))
    os.replace(png_path(slot) + ".tmp", png_path(slot))
    meta = {"name": name, "frames": frames, "source": source, "lib": lib,      # lib — id в библиотеке экрана
            "uploaded_at": datetime.datetime.now().isoformat(timespec="seconds")}
    with open(os.path.join(SDIR, f"slot{slot}.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)


def meta(slot):
    try:
        with open(os.path.join(SDIR, f"slot{slot}.json"), encoding="utf-8") as f:
            m = json.load(f)
    except (OSError, ValueError):
        return None
    m["thumb"] = f"/api/screen/slot/{slot}.png" if os.path.isfile(png_path(slot)) else None
    return m


def all_slots():
    return {str(n): meta(n) for n in (1, 2)}
