# Как помочь

- Нашли ошибку — [заведите issue](https://github.com/ninezeroshine/lunacy-studio/issues/new/choose): версия программы, как подключена клавиатура, шаги и журнал `%APPDATA%\LunacyStudio\studio.log`.
- Хотите поправить код — устройство описано в [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Сервис — Python только со стандартной библиотекой, интерфейс — ES-модули без сборки, так что достаточно `git clone` и `pythonw -I studio/main.py`.
- Перед pull request прогоните тесты: `powershell -File packaging/run-tests.ps1` (клавиатура не нужна, всё на заглушке).
- Всё, что пишет в клавиатуру, должно сначала проверять вход на сервере и показывать человеку понятный результат: что случилось и что делать.
