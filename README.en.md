<p align="center"><img src="docs/images/icon.png" width="96" alt=""></p>

<h1 align="center">Lunacy Studio</h1>

<p align="center">Unofficial companion app for the <b>Lunacy In Space</b> keyboard: keys, macros, lighting and the little screen in one window.<br>
<a href="https://github.com/ninezeroshine/lunacy-studio/releases/latest"><b>Download for Windows</b></a> · <a href="README.md">Русский</a></p>

![Overview: live telemetry bench, keyboard and stats](docs/images/overview.jpg)

The interface is in Russian for now.

## Features

- **Keys.** Remap any key on the base and Fn layers: another key, a shortcut, media, a mouse button, a macro, or disable it. Pick a key on the picture or just press it.
- **Macros.** Record from the real keyboard or type text, tune delays, preview playback. Assign to a key, to Fn + key, or to a shortcut like Ctrl + Shift + M (shortcuts are handled by the app while it runs).
- **Lighting.** All built-in effects, per-key colours, live modes: shortcut hints, layout switch flash, system load, Ambilight.
- **Screen.** Upload your own video, GIF or picture, trim it, adjust colour, add text or draw on it. Twelve animated patterns. Every upload is kept in “My videos” so you can switch in one click.
- **Signals.** Focus timer on the F-row, a light cue when Claude Code waits for you, key-press heatmap.
- **Profiles.** Save the whole setup, move it to another PC, restore factory settings.

## Install

1. Open the [latest release](https://github.com/ninezeroshine/lunacy-studio/releases/latest) and download **LunacyStudio-Setup-…exe**.
2. Run it. Windows SmartScreen may warn because the app has no paid code-signing certificate: click **More info → Run anyway**.
3. No administrator rights needed; it installs for your user only.
4. Connect the keyboard **with a cable**, mode switch in the middle (USB). Over the 2.4G dongle or Bluetooth the screen cannot be updated.

Nothing else to install: Python is bundled. Windows 10 or 11, 64-bit.

There is also a **portable.zip**: unpack and run `LunacyStudio.exe`. The portable build only tells you about new versions; it does not update itself.

## Updates

Every few hours the app asks GitHub whether a new version is out. If so, an **Update** button appears in the top bar with the release notes. One click downloads the installer, checks its SHA-256, closes the app and starts the new version. Your profile, macros and videos stay. You can turn the check off in Settings → Program. Nothing else is sent anywhere.

## Your data

Everything lives in `%APPDATA%\LunacyStudio` and survives updates and uninstall.

## Unofficial

Lunacy Studio is a community project, not affiliated with or endorsed by the keyboard maker. The keyboard protocol was reconstructed for interoperability; no vendor files are included. MIT licensed — see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Development

A local Python service (standard library only) plus a build-free ES-module UI. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and [docs/RELEASING.md](docs/RELEASING.md).
