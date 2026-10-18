"""Выпуск новой версии: python packaging/release.py 1.1.0

Проверяет, что в CHANGELOG.md есть раздел «## [1.1.0]», ставит VERSION в studio/version.py, делает коммит
и тег v1.1.0 и отправляет их на GitHub. Дальше установщик собирает и публикует GitHub Actions
(.github/workflows/release.yml), а установленные копии предложат обновиться.
"""
import pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]


def run(*cmd):
    print("$", " ".join(cmd))
    subprocess.run(cmd, cwd=ROOT, check=True)


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?", sys.argv[1]):
        sys.exit("использование: python packaging/release.py 1.2.3   (или 1.2.3-beta.1 для предварительного выпуска)")
    ver = sys.argv[1]
    base = ver.split("-")[0]
    if f"## [{ver}]" not in (ROOT / "CHANGELOG.md").read_text(encoding="utf-8"):
        sys.exit(f"в CHANGELOG.md нет раздела «## [{ver}] — дата»: опишите, что изменилось, — это увидят пользователи")
    if subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip():
        print("есть незакоммиченные изменения — они войдут в выпуск:")
        run("git", "status", "--short")
    vf = ROOT / "studio" / "version.py"
    text = re.sub(r'^VERSION = ".*"$', f'VERSION = "{base}"', vf.read_text(encoding="utf-8"), flags=re.M)
    vf.write_text(text, encoding="utf-8")
    run("git", "add", "-A")
    run("git", "commit", "-m", f"Выпуск {ver}")
    run("git", "tag", "-a", f"v{ver}", "-m", f"Lunacy Studio {ver}")
    run("git", "push", "origin", "HEAD")
    run("git", "push", "origin", f"v{ver}")
    print(f"готово: сборка идёт в GitHub Actions, выпуск v{ver} появится через 5–10 минут")


if __name__ == "__main__":
    main()
