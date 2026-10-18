"""Хуки Claude Code: свои записи в ~/.claude/settings.json и перевод событий хуков в состояние подсветки.
Наш обработчик — exec-форма (curl.exe + args, без оболочки), async: Claude Code его не ждёт.
Чужие ключи и чужие хуки не трогаются; перед записью — копия файла, запись атомарная."""
import json, os, copy, datetime

PATH = os.path.join(os.path.expanduser("~"), ".claude", "settings.json")
URL = "http://127.0.0.1:47800/api/claude"
MARK = "127.0.0.1:47800/api/claude"
EVENTS = ("UserPromptSubmit", "PermissionRequest", "Stop", "StopFailure", "Notification")
HANDLER = {"type": "command", "command": "curl.exe",
           "args": ["-s", "--max-time", "2", "-X", "POST", "-H", "Content-Type: application/json",
                    "--data-binary", "@-", URL],
           "async": True}

# hook_event_name -> состояние live.py; None = событие известно, но состояние не меняет
STATES = {"UserPromptSubmit": "working", "PreToolUse": "working", "PostToolUse": "working",
          "SubagentStart": "working", "PermissionRequest": "attention", "Stop": "done",
          "StopFailure": "error", "SessionEnd": "idle"}
NOTIFICATION = {"permission_prompt": "attention", "idle_prompt": None}


def state_for(payload):
    """(известно ли событие, состояние или None). Неизвестное → (False, None)."""
    ev = payload.get("hook_event_name")
    if ev == "Notification":
        nt = payload.get("notification_type")
        return (nt in NOTIFICATION, NOTIFICATION.get(nt))
    return (ev in STATES, STATES.get(ev))


def _ours(h):
    return isinstance(h, dict) and any(isinstance(a, str) and MARK in a for a in h.get("args") or [])


def _has_ours(groups):
    return any(_ours(h) for g in groups or [] if isinstance(g, dict) for h in g.get("hooks") or [])


def _read(path):
    """(dict, существовал ли файл). Битый JSON — отказ: такой файл не перезаписываем."""
    try:
        with open(path, encoding="utf-8-sig") as f:
            text = f.read()
    except FileNotFoundError:
        return {}, False
    try:
        data = json.loads(text) if text.strip() else {}
    except ValueError as e:
        raise ValueError(f"{path} — не JSON ({e}); исправь файл вручную, Lunacy Studio его не трогает")
    if not isinstance(data, dict):
        raise ValueError(f"{path} — ожидался JSON-объект; исправь файл вручную, Lunacy Studio его не трогает")
    if not isinstance(data.get("hooks", {}), dict):
        raise ValueError(f"в {path} поле hooks не объект; исправь файл вручную")
    return data, True


def _backup(path):
    base = f"{path}.lunacy-backup-{datetime.datetime.now():%Y%m%d-%H%M%S}"
    b, i = base, 2
    while os.path.exists(b):                      # две записи в одну секунду не должны затереть первую копию
        b, i = f"{base}-{i}", i + 1
    with open(path, "rb") as src, open(b, "xb") as dst:
        dst.write(src.read())
    return b


def _write(path, data):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".lunacy-tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    with open(path, encoding="utf-8") as f:       # перечитать: файл должен остаться валидным JSON
        if json.load(f) != data:
            raise RuntimeError(f"{path} после записи не совпал с ожидаемым; копия рядом (.lunacy-backup-*)")


def status(path=PATH):
    try:
        data, _ = _read(path)
        hooks, error = data.get("hooks") or {}, None
    except ValueError as e:
        hooks, error = {}, str(e)
    present = [e for e in EVENTS if _has_ours(hooks.get(e))]
    preview = {"hooks": {e: [{"hooks": [HANDLER]}] for e in EVENTS if e not in present}}
    return {"installed": len(present) == len(EVENTS), "partial": 0 < len(present) < len(EVENTS),
            "path": path, "events": present, "error": error,
            "preview": json.dumps(preview, ensure_ascii=False, indent=2)}


def install(path=PATH):
    data, existed = _read(path)
    new = copy.deepcopy(data)
    hooks = new.setdefault("hooks", {})
    added = []
    for e in EVENTS:
        groups = hooks.get(e)
        if groups is not None and not isinstance(groups, list):
            raise ValueError(f"в {path} hooks.{e} не список; исправь файл вручную")
        if _has_ours(groups):
            continue
        hooks[e] = (groups or []) + [{"hooks": [copy.deepcopy(HANDLER)]}]
        added.append(e)
    backup = None
    if added:
        backup = _backup(path) if existed else None
        _write(path, new)
    return {"ok": True, "backup": backup, "added": added}


def uninstall(path=PATH):
    data, existed = _read(path)
    new = copy.deepcopy(data)
    hooks = new.get("hooks") or {}
    removed = []
    for e in list(hooks):
        groups = hooks[e]
        if not isinstance(groups, list) or not _has_ours(groups):
            continue
        kept = []
        for g in groups:
            if isinstance(g, dict) and isinstance(g.get("hooks"), list):
                rest = [h for h in g["hooks"] if not _ours(h)]
                if not rest and g["hooks"]:
                    continue                                  # группа опустела — убираем
                g = {**g, "hooks": rest}
            kept.append(g)
        removed.append(e)
        if kept:
            hooks[e] = kept
        else:
            del hooks[e]
    if "hooks" in new and not hooks:
        del new["hooks"]
    backup = None
    if removed and existed:
        backup = _backup(path)
        _write(path, new)
    return {"ok": True, "backup": backup, "removed": removed}
