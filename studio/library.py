"""Библиотека экрана: свои видео и картинки, уже готовые для слота (кадры 240×135 RGB565 и задержки).
Живёт в Studio, а не в клавиатуре и не в профиле: %APPDATA%\\LunacyStudio\\library\\<id>\\ — frames.bin, meta.json,
thumb.png. Переключиться на сохранённое — одна заливка, без повторной правки. id — начало SHA-256 кадров и задержек,
поэтому одно и то же видео дважды не сохраняется."""
import hashlib, json, os, shutil, datetime, threading
from .store import DIR

LDIR = os.path.join(DIR, "library")
FRAME_BYTES = 240 * 135 * 2
LIMIT = 60                                   # штук; ~4,5 МБ максимум на штуку — до ~270 МБ
_lock = threading.Lock()


def _dir(cid):
    if not (isinstance(cid, str) and len(cid) == 12 and all(c in "0123456789abcdef" for c in cid)):
        raise ValueError("нет такого видео в библиотеке")
    return os.path.join(LDIR, cid)


def _meta(cid):
    with open(os.path.join(_dir(cid), "meta.json"), encoding="utf-8") as f:
        return json.load(f)


def listing():
    out = []
    if os.path.isdir(LDIR):
        for cid in os.listdir(LDIR):
            try:
                m = _meta(cid)
                out.append({**m, "thumb": f"/api/library/{cid}/thumb.png?v={m['sha'][:8]}"})
            except (OSError, ValueError, TypeError, KeyError):
                continue                      # недописанная, повреждённая или чужая папка — пропускаем
    out.sort(key=lambda m: m.get("created", ""), reverse=True)
    return out


def save(name, source, body, delays):
    """Сохранить кадры (уже проверенные вызывающим). Возвращает (meta, new)."""
    from lunacy import images
    sha = hashlib.sha256(body + b"|" + ",".join(map(str, delays)).encode()).hexdigest()
    cid = sha[:12]
    with _lock:
        d = os.path.join(LDIR, cid)
        if os.path.isfile(os.path.join(d, "meta.json")):
            return _meta(cid), False
        if len(listing()) >= LIMIT:
            raise ValueError(f"в библиотеке уже {LIMIT} видео — удали ненужные")
        tmp = d + ".tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp)
        with open(os.path.join(tmp, "frames.bin"), "wb") as f:
            f.write(body)
        with open(os.path.join(tmp, "thumb.png"), "wb") as f:
            f.write(images.png(images.bgra_from_rgb565(body[:FRAME_BYTES])))
        n = len(body) // FRAME_BYTES
        meta = {"id": cid, "sha": sha, "name": name[:60], "source": source, "frames": n, "delays": delays,
                "loop_ms": sum(delays), "created": datetime.datetime.now().isoformat(timespec="seconds")}
        with open(os.path.join(tmp, "meta.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)
        os.replace(tmp, d)
        return meta, True


def load(cid):
    try:
        m = _meta(cid)
        with open(os.path.join(_dir(cid), "frames.bin"), "rb") as f:
            body = f.read()
    except OSError:
        raise ValueError("этого видео в библиотеке больше нет — обнови страницу")
    if len(body) != m["frames"] * FRAME_BYTES:
        raise ValueError("файл видео в библиотеке повреждён — удали его и сохрани заново")
    return m, body


def file(cid, name):
    return os.path.join(_dir(cid), name)


def rename(cid, name):
    with _lock:
        try:
            m = _meta(cid)
        except OSError:
            raise ValueError("этого видео в библиотеке больше нет — обнови страницу")
        m["name"] = name[:60]
        p = os.path.join(_dir(cid), "meta.json")
        with open(p + ".tmp", "w", encoding="utf-8") as f:
            json.dump(m, f, ensure_ascii=False)
        os.replace(p + ".tmp", p)
        return m


def delete(cid):
    with _lock:
        d = _dir(cid)
        if not os.path.isdir(d):
            raise ValueError("нет такого видео в библиотеке")
        shutil.rmtree(d)
