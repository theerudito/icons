#define MyAppName "Icons"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Between Bytes Software"
#define MyAppExeName "icons.exe"
#define ReleaseDir "build\bin"
#define AppIcon "build\windows\icon.ico"

#if !FileExists(AddBackslash(SourcePath) + ReleaseDir + "\" + MyAppExeName)
  #error "The Windows release executable is missing. Run 'go run github.com/wailsapp/wails/v2/cmd/wails@v2.16.0 build -platform windows/amd64' before compiling this installer."
#endif

#if !FileExists(AddBackslash(SourcePath) + AppIcon)
  #error "The installer icon is missing: build\windows\icon.ico"
#endif

[Setup]
AppId={{9B44F321-729D-4F8F-B501-D3EBBF857C0W}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}

; Developer / Publisher
AppPublisher={#MyAppPublisher}

; Install in:
; Uses the architecture-appropriate Program Files directory.
DefaultDirName={commonpf32}\{#MyAppPublisher}\Icons

DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes

ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin

OutputDir=build\installer
OutputBaseFilename=Icons-Setup-{#MyAppVersion}

SetupIconFile={#AppIcon}
UninstallDisplayIcon={app}\{#MyAppExeName}

Compression=lzma2
SolidCompression=yes
WizardStyle=modern

VersionInfoVersion=1.0.0.1
VersionInfoProductVersion=1.0.0.1
VersionInfoProductName={#MyAppName}
VersionInfoDescription={#MyAppName} Installer
VersionInfoCompany={#MyAppPublisher}

[Tasks]
Name: "desktopicon"; \
    Description: "Create a &desktop shortcut"; \
    GroupDescription: "Additional shortcuts:"; \
    Flags: unchecked

[Files]
Source: "{#ReleaseDir}\*"; \
    DestDir: "{app}"; \
    Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; \
    Filename: "{app}\{#MyAppExeName}"; \
    WorkingDir: "{app}"

Name: "{autodesktop}\{#MyAppName}"; \
    Filename: "{app}\{#MyAppExeName}"; \
    WorkingDir: "{app}"; \
    Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; \
    Description: "Launch {#MyAppName}"; \
    WorkingDir: "{app}"; \
    Flags: nowait postinstall skipifsilent
