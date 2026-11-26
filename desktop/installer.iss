#define AppVersion "1.1.3"
#define AppExe "RuqenAI.exe"

[Setup]
AppId=ai.ruqenai.desktop
AppName=Ruqenai
AppVersion={#AppVersion}
DefaultDirName={autopf}\Ruqenai
DefaultGroupName=Ruqenai
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog commandline
OutputDir=..\release
OutputBaseFilename=Ruqenai-Setup-{#AppVersion}
SetupIconFile=assets\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
CloseApplications=yes
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked
[Files]
Source: "..\release\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "assets\icon.ico"; DestDir: "{app}"; Flags: ignoreversion
[Icons]
Name: "{group}\Ruqenai"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\icon.ico"
Name: "{autodesktop}\Ruqenai"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon; IconFilename: "{app}\icon.ico"
[Run]
; Normal installs offer to launch the app. Silent updater installs relaunch it
; automatically; skipifsilent would otherwise suppress both entries.
Filename: "{app}\{#AppExe}"; Description: "Launch Ruqenai"; Flags: nowait postinstall skipifsilent; Check: not IsUpdateInstall
Filename: "{app}\{#AppExe}"; Flags: nowait; Check: IsUpdateInstall

[Code]
function IsUpdateInstall(): Boolean;
begin
  Result := (Pos('/RUQENAIUPDATE', Uppercase(GetCmdTail)) > 0) or
            (Pos('/RESTARTAPP', Uppercase(GetCmdTail)) > 0);
end;
