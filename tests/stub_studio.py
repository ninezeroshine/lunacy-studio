"""Lunacy Studio на заглушке клавиатуры (tests/fake_kb.py): настоящий сервер и интерфейс, профиль и слоты во
временной папке, журнал записей графики — тоже. В клавиатуру и в профиль пользователя ничего не пишет; рядом может
работать настоящая Studio на 47800.

python -I tests/stub_studio.py [--port 47801] [--block-delay 0.15]
Затем интерфейс на http://127.0.0.1:47801/, а t5 так: set STUDIO_URL=http://127.0.0.1:47801 и python -I tests/t5_studio_api.py"""
import os, sys, tempfile, argparse, threading, logging

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.dirname(HERE)]


def start(port=47801, block_delay=0.002):
    """Поднять сервис в этом процессе. -> (app, httpd, временная папка)."""
    tmp = tempfile.mkdtemp(prefix="studio-stub-")
    os.environ["APPDATA"] = tmp                       # store.DIR считается при импорте — до него
    os.environ["LUNACY_NO_UPDATE"] = "1"              # заглушка не ходит на GitHub
    logging.basicConfig(filename=os.path.join(tmp, "studio.log"), level=logging.INFO, encoding="utf-8",
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    import fake_kb
    from studio import device, graphics, server
    from studio.store import Store
    from studio.winapi import KeyWatcher
    from studio.live import LiveEngine
    fake_kb.FakeKeyboard.block_delay = block_delay
    device.Keyboard = fake_kb.FakeKeyboard
    graphics.RUNS = os.path.join(tmp, "runs")        # фиктивная запись не должна попасть в журнал пользователя
    server.PORT = port
    store = Store()
    dm = device.DeviceManager()
    engine = LiveEngine(dm, store, KeyWatcher())
    httpd = None
    app = server.App(store, dm, engine, None, lambda: threading.Thread(target=httpd.shutdown).start())
    httpd = server.serve(app)
    return app, httpd, tmp


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=47801)
    ap.add_argument("--block-delay", type=float, default=0.15, help="секунд на блок экрана (железо: 0.15)")
    a = ap.parse_args()
    app, httpd, tmp = start(a.port, a.block_delay)
    print(f"заглушка: http://127.0.0.1:{a.port}/  данные: {tmp}", flush=True)
    threading.Event().wait()
