"""Автообновление с GitHub Releases.

Проверка: GET api.github.com/repos/<REPO>/releases/latest (черновики и предварительные выпуски GitHub туда не
отдаёт) — при запуске через минуту и потом раз в 6 часов, если проверка включена (store.updates.auto).
Наружу уходит только этот запрос: без данных о клавиатуре и профиле.

Установка — только по кнопке: качаем LunacyStudio-Setup-<версия>.exe во временную папку, сверяем SHA-256 со строкой
из SHA256SUMS.txt того же выпуска, закрываем Studio и запускаем установщик тихо (/VERYSILENT /UPDATE=1); он ставит
файлы поверх и сам запускает новую версию. Профиль и данные в %APPDATA%\\LunacyStudio не трогаются.
Запуск из исходников (git) не обновляется: там правильный путь — git pull.
"""
import hashlib, json, logging, os, re, subprocess, sys, tempfile, threading, time, urllib.error, urllib.request

from .version import VERSION, REPO

log = logging.getLogger("studio.update")
API = f"https://api.github.com/repos/{REPO}/releases/latest"
EVERY = 6 * 3600
FIRST = 60
UA = f"LunacyStudio/{VERSION} (+https://github.com/{REPO})"
SETUP = re.compile(r"^LunacyStudio-Setup-(\d+\.\d+\.\d+)\.exe$")


def parse(v):
    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)$", (v or "").strip())
    return tuple(int(x) for x in m.groups()) if m else None


def installed():
    """Установленная программа: рядом с runtime\\pythonw.exe лежат LunacyStudio.exe и деинсталлятор Inno Setup."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(sys.executable)))
    return os.path.isfile(os.path.join(root, "LunacyStudio.exe")) and os.path.isfile(os.path.join(root, "unins000.exe"))


def _get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/vnd.github+json"})
    return urllib.request.urlopen(req, timeout=timeout)


class Updater:
    def __init__(self, store, on_quit):
        self.store, self.on_quit = store, on_quit
        self.state = {"current": VERSION, "latest": None, "available": False, "notes": "", "url": None,
                      "published": None, "status": "idle", "progress": 0, "total": 0, "error": None,
                      "checked_at": None, "installed": installed()}
        self._release = None
        self._lock = threading.Lock()
        if os.environ.get("LUNACY_NO_UPDATE") != "1":      # заглушка и тесты в сеть не ходят
            threading.Thread(target=self._loop, name="updater", daemon=True).start()

    # ---- настройки ----
    def auto(self):
        return bool((self.store.get("updates") or {}).get("auto", True))

    def set_auto(self, on):
        u = dict(self.store.get("updates") or {}); u["auto"] = bool(on); self.store.set(u, "updates")

    def status(self):
        return {**self.state, "auto": self.auto()}

    # ---- проверка ----
    def _loop(self):
        time.sleep(FIRST)
        while True:
            if self.auto():
                try:
                    self.check()
                except Exception as e:                       # сеть, лимит GitHub — молча до следующего раза
                    log.info("проверка обновлений: %s", e)
            time.sleep(EVERY)

    def check(self):
        with self._lock:
            if self.state["status"] in ("downloading", "installing"):
                return self.status()
            self.state.update(status="checking", error=None)
        try:
            with _get(API) as r:
                rel = json.load(r)
            latest = parse(rel.get("tag_name"))
            assets = {a["name"]: a for a in rel.get("assets", [])}
            setup = next((a for n, a in assets.items() if SETUP.match(n) and parse(SETUP.match(n).group(1)) == latest), None)
            sums = assets.get("SHA256SUMS.txt")
            newer = bool(latest and latest > parse(VERSION) and setup and sums)
            self._release = {"setup": setup, "sums": sums} if newer else None
            self.state.update(latest=rel.get("tag_name", "").lstrip("v") or None, available=newer, url=rel.get("html_url"),
                              notes=(rel.get("body") or "")[:6000], published=rel.get("published_at"),
                              status="idle", checked_at=time.strftime("%Y-%m-%dT%H:%M:%S"))
        except Exception as e:
            if isinstance(e, urllib.error.HTTPError):
                why = {404: "на GitHub ещё нет выпусков", 403: "GitHub временно ограничил запросы — попробуй через час"}.get(e.code, f"GitHub ответил {e.code}")
            elif isinstance(e, (OSError, urllib.error.URLError)):
                why = "нет связи с GitHub — проверь интернет"
            else:
                why = str(e)
            self.state.update(status="idle", error=f"не удалось проверить обновления: {why}",
                              checked_at=time.strftime("%Y-%m-%dT%H:%M:%S"))
            raise RuntimeError(self.state["error"]) from e
        return self.status()

    # ---- установка ----
    def install(self, busy=None):
        if not self.state["installed"]:
            raise ValueError("Studio запущена из исходников — обнови её через git pull. Автообновление ставит только установленную программу")
        if busy:
            raise ValueError(f"сейчас идёт «{busy}» — обнови, когда она закончится")
        with self._lock:
            if not self._release:
                raise ValueError("нового выпуска нет — проверь обновления ещё раз")
            if self.state["status"] in ("downloading", "installing"):
                return self.status()
            self.state.update(status="downloading", progress=0, total=self._release["setup"].get("size") or 0, error=None)
        threading.Thread(target=self._install, name="update-install", daemon=True).start()
        return self.status()

    def _install(self):
        try:
            setup, sums = self._release["setup"], self._release["sums"]
            with _get(sums["browser_download_url"], 30) as r:
                text = r.read().decode("utf-8", "replace")
            want = next((ln.split()[0].lower() for ln in text.splitlines() if ln.strip().endswith(setup["name"])), None)
            if not want or not re.fullmatch(r"[0-9a-f]{64}", want):
                raise RuntimeError("в SHA256SUMS.txt нет суммы для установщика")
            folder = os.path.join(tempfile.gettempdir(), "LunacyStudio-update")
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, setup["name"])
            h = hashlib.sha256()
            with _get(setup["browser_download_url"], 60) as r, open(path + ".part", "wb") as f:
                while True:
                    chunk = r.read(1 << 16)
                    if not chunk:
                        break
                    f.write(chunk); h.update(chunk)
                    self.state["progress"] += len(chunk)
            if h.hexdigest() != want:
                os.remove(path + ".part")
                raise RuntimeError("установщик скачался с ошибкой (SHA-256 не совпал) — попробуй ещё раз")
            os.replace(path + ".part", path)
            self.state["status"] = "installing"
            log.info("обновление %s → %s: запускаю установщик", VERSION, self.state["latest"])
            # пауза, чтобы Studio успела закрыться и отпустить файлы; окно консоли не показываем
            flags = 0x08000000 | 0x00000008          # CREATE_NO_WINDOW | DETACHED_PROCESS
            subprocess.Popen(f'cmd /c ping -n 3 127.0.0.1 >nul & start "" "{path}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /UPDATE=1',
                             creationflags=flags, close_fds=True)
            threading.Timer(0.8, self.on_quit).start()
        except Exception as e:
            log.exception("обновление")
            why = "связь с GitHub оборвалась — попробуй ещё раз" if isinstance(e, (OSError, urllib.error.URLError)) else str(e)
            self.state.update(status="error", error=why)
