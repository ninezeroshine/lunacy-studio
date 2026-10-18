"""Lunacy Studio: фоновый сервис + веб-интерфейс http://127.0.0.1:47800.
Установленная программа запускается через LunacyStudio.exe; из исходников — pythonw -I studio\\main.py
(без окна консоли; значок появится в трее). Интерфейс открывается отдельным окном Edge в режиме приложения."""
import os, sys, logging, logging.handlers, webbrowser, socket, threading, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from studio.store import Store, DIR                      # noqa: E402
from studio.device import DeviceManager                  # noqa: E402
from studio.winapi import KeyWatcher                     # noqa: E402
from studio.live import LiveEngine                       # noqa: E402
from studio import server, tray                          # noqa: E402

URL = f"http://127.0.0.1:{server.PORT}/"


def window_rect():
    """Окно по центру рабочей области экрана (без панели задач): ~85 % ширины и 88 % высоты, не больше 1600×1000.
    Без явной позиции Edge ставил окно приложения куда придётся — например, в левую половину экрана."""
    import ctypes, ctypes.wintypes as wt
    r = wt.RECT()
    if not ctypes.windll.user32.SystemParametersInfoW(0x30, 0, ctypes.byref(r), 0):   # SPI_GETWORKAREA
        return 1440, 920, 80, 60
    # рабочая область и SetWindowPos — в одних координатах этого процесса, масштаб экрана учитывать не нужно
    aw, ah = r.right - r.left, r.bottom - r.top
    w, h = int(min(1600, aw * 0.85)), int(min(1000, ah * 0.88))
    return w, h, r.left + (aw - w) // 2, r.top + (ah - h) // 2


def _studio_windows():
    """Видимые окна верхнего уровня с «Lunacy Studio» в заголовке: {hwnd}."""
    import ctypes, ctypes.wintypes as wt
    u, out = ctypes.windll.user32, set()

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(h, _):
        n = u.GetWindowTextLengthW(h)
        if n and u.IsWindowVisible(h):
            b = ctypes.create_unicode_buffer(n + 1)
            u.GetWindowTextW(h, b, n + 1)
            if "Lunacy Studio" in b.value:
                out.add(h)
        return True
    u.EnumWindows(cb, 0)
    return out


def _place_new_window(before, rect):
    """Edge восстанавливает окно приложения там, где оно было в прошлый раз (часто прилипшим к половине экрана),
    и не слушает --window-position. Поэтому новое окно Studio ставим по центру сами. Чужие и уже открытые окна
    не трогаем: только то, что появилось после запуска."""
    import ctypes, time
    u = ctypes.windll.user32
    x, y, w, h = rect
    for _ in range(40):                                     # до 10 с: Edge может стартовать не сразу
        time.sleep(0.25)
        new = _studio_windows() - before
        if new:
            hwnd = new.pop()
            u.ShowWindow(hwnd, 9)                           # SW_RESTORE: снять прилипание и развёрнутость
            u.SetWindowPos(hwnd, None, x, y, w, h, 0x0004 | 0x0010)   # SWP_NOZORDER | SWP_NOACTIVATE
            return


def open_ui():
    """Окно программы: Edge в режиме приложения (без вкладок и адресной строки), если его нет — браузер по умолчанию."""
    roots = [os.environ.get(v) for v in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA")]
    for exe in [os.path.join(r, "Microsoft", "Edge", "Application", "msedge.exe") for r in roots if r]:
        if os.path.isfile(exe):
            try:
                w, h, x, y = window_rect()
                before = _studio_windows()
                subprocess.Popen([exe, f"--app={URL}", f"--window-size={w},{h}", f"--window-position={x},{y}"], close_fds=True)
                threading.Thread(target=_place_new_window, args=(before, (x, y, w, h)), daemon=True).start()
                return
            except OSError:
                break
    webbrowser.open(URL)


def already_running():
    s = socket.socket()
    try:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", server.PORT)) == 0
    finally:
        s.close()


SESSION = os.path.join(DIR, "session.json")    # порт и токен запущенного сервиса: для --quit из установщика


def quit_running():
    """--quit: попросить запущенную Studio закрыться (установщик делает так перед заменой файлов)."""
    import json, urllib.request
    try:
        with open(SESSION, encoding="utf-8") as f:
            s = json.load(f)
        req = urllib.request.Request(f"http://127.0.0.1:{s['port']}/api/quit", data=b"{}", method="POST",
                                     headers={"X-Studio-Token": s["token"], "Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=5).read()
    except Exception:
        return                                  # не запущена или старая версия — установщик закроет файлы сам
    for _ in range(40):                         # ждём до 10 с, пока порт освободится
        if not already_running():
            return
        threading.Event().wait(0.25)


def main():
    os.makedirs(DIR, exist_ok=True)
    if "--quit" in sys.argv:
        quit_running()
        return
    # журнал с ротацией: 1 МБ × 3 файла, чтобы повторяющаяся ошибка не съела диск
    handler = logging.handlers.RotatingFileHandler(os.path.join(DIR, "studio.log"), maxBytes=1_000_000, backupCount=3,
                                                   encoding="utf-8")
    logging.basicConfig(level=logging.INFO, handlers=[handler], format="%(asctime)s %(name)s %(levelname)s %(message)s")
    if sys.stdout is None:                                  # pythonw
        sys.stdout = sys.stderr = open(os.devnull, "w")
    if already_running():
        if "--no-browser" not in sys.argv:
            open_ui()
        return
    store = Store()
    dm = DeviceManager()
    watcher = KeyWatcher()
    engine = LiveEngine(dm, store, watcher)
    t = None

    def quit_app(force=False):
        job = app.job.state if app else {}
        if not force and job.get("status") == "running":
            # обрыв посередине оставил бы клавиатуру записанной наполовину; ждём конца и выходим сами
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, f"Сейчас идёт «{job.get('name')}». Lunacy Studio закроется сама, "
                                             "когда запись закончится.", "Lunacy Studio", 0x40)
            def later():
                while app.job.state.get("status") == "running":
                    threading.Event().wait(0.5)
                quit_app(force=True)
            threading.Thread(target=later, daemon=True).start()
            return
        logging.info("выход")
        dm.stop()
        if t:
            t.close()
        else:
            os._exit(0)

    app = None
    app = server.App(store, dm, engine, watcher, quit_app)

    def on_connect():
        if store.get("screen").get("auto_time"):
            try:
                app.sync_time(wait=None)     # при подключении ждём, если клавиатура занята
            except Exception as e:
                logging.warning("синхронизация времени: %s", e)
    dm.on_connect.append(on_connect)
    try:
        app.migrate_autostart()
    except OSError:
        logging.warning("не удалось обновить путь автозапуска")
    server.serve(app)
    logging.info("сервис запущен на %s", URL)
    try:
        import json
        with open(SESSION, "w", encoding="utf-8") as f:
            json.dump({"port": server.PORT, "token": server.TOKEN, "pid": os.getpid()}, f)
    except OSError:
        logging.warning("не записал session.json")

    icon = os.path.join(HERE, "assets", "icon.ico")       # иконка программы (packaging/icon.ico)
    if not os.path.isfile(icon):
        icon = os.path.join(DIR, "icon.ico")
        tray.make_icon(icon)

    def toggle_hints():
        s = store.get("smart"); s["hints"] = not s["hints"]; store.set(s, "smart")

    from studio.version import VERSION
    t = tray.Tray(icon, f"Lunacy Studio {VERSION}", [
        ("Открыть Lunacy Studio", open_ui, None),
        ("Подсказчик горячих клавиш", toggle_hints, lambda: store.get("smart")["hints"]),
        ("", None, None),
        ("Выход", quit_app, None),
    ])
    if "--no-browser" not in sys.argv:
        threading.Timer(0.5, open_ui).start()
    t.loop()
    dm.stop()


if __name__ == "__main__":
    main()
