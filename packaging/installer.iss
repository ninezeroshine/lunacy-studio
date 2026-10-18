; Установщик Lunacy Studio (Inno Setup 6). Собирает packaging/build.py:
;   ISCC /DAppVersion=1.2.3 /DStage=<папка сборки> packaging\installer.iss
; Ставится в профиль пользователя без прав администратора. Профиль, макросы и «Мои видео» лежат в
; %APPDATA%\LunacyStudio и при обновлении и удалении не трогаются.
; Автообновление запускает этот же установщик тихо: /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /UPDATE=1.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef Stage
  #define Stage "..\build\stage"
#endif

[Setup]
AppId={{91D77452-B828-441D-92F4-8D8DC93E9FFF}
AppName=Lunacy Studio
AppVersion={#AppVersion}
AppVerName=Lunacy Studio {#AppVersion}
AppPublisher=Lunacy Studio (неофициальная программа)
AppPublisherURL=https://github.com/ninezeroshine/lunacy-studio
AppSupportURL=https://github.com/ninezeroshine/lunacy-studio/issues
AppUpdatesURL=https://github.com/ninezeroshine/lunacy-studio/releases
DefaultDirName={localappdata}\Programs\LunacyStudio
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=LunacyStudio-Setup-{#AppVersion}
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\LunacyStudio.exe
UninstallDisplayName=Lunacy Studio
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
CloseApplications=yes
CloseApplicationsFilter=*.exe,*.dll,*.pyd
RestartApplications=no
ShowLanguageDialog=no
VersionInfoVersion={#AppVersion}
VersionInfoProductName=Lunacy Studio

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
ru.Autostart=Запускать вместе с Windows (значок в трее, без окна)
en.Autostart=Start with Windows (tray icon, no window)
ru.LaunchNow=Запустить Lunacy Studio
en.LaunchNow=Launch Lunacy Studio
ru.Extra=Дополнительно:
en.Extra=Additional:

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "autostart"; Description: "{cm:Autostart}"; GroupDescription: "{cm:Extra}"

[InstallDelete]
; обновление начисто: старые файлы программы уходят, данные пользователя в %APPDATA% не трогаем
Type: filesandordirs; Name: "{app}\app"

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Lunacy Studio"; Filename: "{app}\LunacyStudio.exe"
Name: "{autodesktop}\Lunacy Studio"; Filename: "{app}\LunacyStudio.exe"; Tasks: desktopicon

[Registry]
; та же строка, что собирает сама Studio (server.autostart_cmd), — переключатель в настройках её узнаёт
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "LunacyStudio"; ValueData: """{app}\runtime\pythonw.exe"" -I ""{app}\app\studio\main.py"" --no-browser"; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\LunacyStudio.exe"; Description: "{cm:LaunchNow}"; Flags: nowait postinstall skipifsilent
; тихое автообновление: перезапустить без нового окна — открытое окно Studio само переподключится
Filename: "{app}\LunacyStudio.exe"; Parameters: "--no-browser"; Flags: nowait; Check: IsUpdate

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\runtime"

[Code]
function IsUpdate: Boolean;
begin
  Result := ExpandConstant('{param:UPDATE|0}') = '1';
end;

procedure QuitStudio(const Exe: String);
var
  Code: Integer;
begin
  { попросить запущенную Studio закрыться, чтобы файлы не были заняты }
  if FileExists(Exe) then
    Exec(Exe, '--quit', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  QuitStudio(ExpandConstant('{app}\LunacyStudio.exe'));
  Result := '';
end;

function InitializeUninstall: Boolean;
begin
  QuitStudio(ExpandConstant('{app}\LunacyStudio.exe'));
  Result := True;
end;
