#define AppVersion "1.1.0"
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
UninstallDisplayIcon={app}\Ruqenai.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked
[Files]
Source: "..\release\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\Ruqenai"; Filename: "{app}\Ruqenai.exe"
Name: "{autodesktop}\Ruqenai"; Filename: "{app}\Ruqenai.exe"; Tasks: desktopicon
[Run]
Filename: "{app}\Ruqenai.exe"; Description: "Launch Ruqenai"; Flags: nowait postinstall skipifsilent; Check: not UpdateRestart
Filename: "{app}\Ruqenai.exe"; Flags: nowait; Check: UpdateRestart

[Code]
function UpdateRestart(): Boolean;
begin
  Result := Pos('/RESTARTAPP', Uppercase(GetCmdTail)) > 0;
end;
