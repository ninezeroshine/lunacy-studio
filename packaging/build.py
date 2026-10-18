"""Сборка Lunacy Studio для Windows: установщик, портативный ZIP и SHA256SUMS.txt в dist/.

    python packaging/build.py              полная сборка
    python packaging/build.py --no-installer   без Inno Setup (только папка и ZIP)

Нужно: Windows 10/11 x64, Python 3.11+ (только чтобы запустить этот скрипт), Inno Setup 6 (ISCC.exe в PATH,
в Program Files или в %LOCALAPPDATA%\\Programs), интернет при первой сборке. Внутрь программы кладётся
официальный встраиваемый Python с python.org — пользователю ставить Python не нужно. Запускалка LunacyStudio.exe
собирается компилятором C#, который есть в каждой Windows (.NET Framework 4).
"""
import argparse, hashlib, os, pathlib, re, shutil, subprocess, sys, urllib.request, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
PKG = ROOT / "packaging"
BUILD, DIST = ROOT / "build", ROOT / "dist"
STAGE, CACHE = BUILD / "stage", BUILD / "cache"

PY_VER = "3.11.9"
PY_ZIP = f"python-{PY_VER}-embed-amd64.zip"
PY_URL = f"https://www.python.org/ftp/python/{PY_VER}/{PY_ZIP}"
PY_SHA256 = "009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b"   # закреплено при первой сборке

CSC = pathlib.Path(os.environ.get("WINDIR", r"C:\Windows")) / "Microsoft.NET" / "Framework64" / "v4.0.30319" / "csc.exe"
SKIP = {"__pycache__", ".pytest_cache"}


def version():
    m = re.search(r'^VERSION = "(\d+\.\d+\.\d+)"', (ROOT / "studio" / "version.py").read_text(encoding="utf-8"), re.M)
    if not m:
        sys.exit("studio/version.py: нет VERSION = \"X.Y.Z\"")
    return m.group(1)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def python_runtime():
    CACHE.mkdir(parents=True, exist_ok=True)
    z = CACHE / PY_ZIP
    if not z.exists():
        print(f"скачиваю {PY_URL}")
        with urllib.request.urlopen(PY_URL, timeout=120) as r, open(z.with_suffix(".part"), "wb") as f:
            shutil.copyfileobj(r, f)
        z.with_suffix(".part").replace(z)
    got = sha256(z)
    if got != PY_SHA256:
        z.unlink()
        sys.exit(f"{PY_ZIP}: SHA-256 {got} не совпал с закреплённым {PY_SHA256} — сборка остановлена")
    return z


def copytree(src, dst):
    shutil.copytree(src, dst, ignore=lambda d, names: [n for n in names if n in SKIP or n.endswith(".pyc")])


def launcher(ver, out):
    if not CSC.exists():
        sys.exit(f"нет компилятора C# {CSC}: он входит в .NET Framework 4, который есть в Windows 10/11")
    src = (PKG / "launcher.cs").read_text(encoding="utf-8").replace("0.0.0.0", f"{ver}.0")
    tmp = BUILD / "launcher.cs"
    tmp.write_text(src, encoding="utf-8")
    subprocess.run([str(CSC), "/nologo", "/target:winexe", "/optimize+", "/codepage:65001",
                    f"/win32icon:{PKG / 'icon.ico'}", "/r:System.Windows.Forms.dll", f"/out:{out}", str(tmp)], check=True)


def iscc():
    cands = [shutil.which("ISCC"), shutil.which("iscc")]
    for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"),
                 os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs")):
        if base:
            cands.append(os.path.join(base, "Inno Setup 6", "ISCC.exe"))
    return next((c for c in cands if c and os.path.isfile(c)), None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-installer", action="store_true")
    a = ap.parse_args()
    ver = version()
    print(f"Lunacy Studio {ver}")
    shutil.rmtree(STAGE, ignore_errors=True)
    STAGE.mkdir(parents=True)
    DIST.mkdir(exist_ok=True)

    # встроенный Python
    with zipfile.ZipFile(python_runtime()) as z:
        z.extractall(STAGE / "runtime")
    # программа: сервис, протокол, интерфейс и ресурсы (без тестов и инструментов сборки)
    copytree(ROOT / "studio", STAGE / "app" / "studio")
    copytree(ROOT / "lunacy", STAGE / "app" / "lunacy")
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copy2(ROOT / name, STAGE / name)
    launcher(ver, STAGE / "LunacyStudio.exe")

    # дымовая проверка: сервис импортируется во встроенном Python (ctypes, ssl, http.server на месте)
    probe = ("import sys; sys.path.insert(0, r'%s'); import ssl, ctypes, http.server, zlib, winreg; "
             "import studio.server, studio.updater, lunacy.proto; print('runtime ok', sys.version.split()[0])") % (STAGE / "app")
    env = dict(os.environ, LUNACY_NO_UPDATE="1", APPDATA=str(BUILD / "probe-appdata"))
    subprocess.run([str(STAGE / "runtime" / "python.exe"), "-I", "-c", probe], check=True, env=env)

    outs = []
    if not a.no_installer:
        exe = iscc()
        if not exe:
            sys.exit("Inno Setup 6 не найден (ISCC.exe). Поставь его с jrsoftware.org или собери с --no-installer")
        subprocess.run([exe, "/Q", f"/DAppVersion={ver}", f"/DStage={STAGE}", str(PKG / "installer.iss")], check=True)
        outs.append(DIST / f"LunacyStudio-Setup-{ver}.exe")
    portable = DIST / f"LunacyStudio-{ver}-portable.zip"
    with zipfile.ZipFile(portable, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in sorted(STAGE.rglob("*")):
            if p.is_file():
                z.write(p, pathlib.Path("LunacyStudio") / p.relative_to(STAGE))
    outs.append(portable)
    sums = DIST / "SHA256SUMS.txt"
    with open(sums, "w", encoding="utf-8", newline="\n") as f:   # LF: sha256sum -c читает имена без «\r»
        f.write("".join(f"{sha256(p)}  {p.name}\n" for p in outs))
    for p in outs + [sums]:
        print(f"  {p.relative_to(ROOT)}  {p.stat().st_size / 1e6:.1f} МБ")


if __name__ == "__main__":
    main()
