@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

REM ============================================================================
REM MyGMap - Windows Open-Source Toolchain One-Click Build Script (build.bat)
REM License Policy: 100% Free & Open-Source (OpenJDK GPLv2+CE / Gradle Apache 2.0)
REM Strictly prohibits proprietary/commercial Oracle JDK distributions.
REM ============================================================================

set "PROJECT_ROOT=%~dp0"
if "%PROJECT_ROOT:~-1%"=="\" set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

set "NO_EXPLORER=0"
set "BOOTSTRAP_JDK=0"
set "NO_BUMP=0"
set "BUILD_MODE=debug"
set "GRADLE_TASKS="

:ParseArgs
if "%~1"=="" goto :ArgsDone
if /i "%~1"=="--no-explorer" (
    set "NO_EXPLORER=1"
    shift
    goto :ParseArgs
)
if /i "%~1"=="--bootstrap-jdk" (
    set "BOOTSTRAP_JDK=1"
    shift
    goto :ParseArgs
)
if /i "%~1"=="--no-bump" (
    set "NO_BUMP=1"
    shift
    goto :ParseArgs
)
if /i "%~1"=="--help" goto :ShowHelp
if /i "%~1"=="-h" goto :ShowHelp
if /i "%~1"=="/?" goto :ShowHelp

if /i "%~1"=="debug" (
    set "BUILD_MODE=debug"
    set "GRADLE_TASKS=!GRADLE_TASKS! assembleDebug"
    shift
    goto :ParseArgs
)
if /i "%~1"=="release" (
    set "BUILD_MODE=release"
    set "GRADLE_TASKS=!GRADLE_TASKS! assembleRelease"
    shift
    goto :ParseArgs
)
if /i "%~1"=="test" (
    set "BUILD_MODE=test"
    set "GRADLE_TASKS=!GRADLE_TASKS! testDebugUnitTest"
    shift
    goto :ParseArgs
)
if /i "%~1"=="clean" (
    set "BUILD_MODE=clean"
    set "GRADLE_TASKS=!GRADLE_TASKS! clean"
    shift
    goto :ParseArgs
)
if /i "%~1"=="check" (
    set "BUILD_MODE=debug"
    set "GRADLE_TASKS=!GRADLE_TASKS! testDebugUnitTest assembleDebug"
    shift
    goto :ParseArgs
)

set "GRADLE_TASKS=!GRADLE_TASKS! %~1"
shift
goto :ParseArgs

:ArgsDone
if "%GRADLE_TASKS%"=="" (
    set "BUILD_MODE=debug"
    set "GRADLE_TASKS=assembleDebug"
)

echo ================================================================================
echo  🚀 MyGMap (Google 我的地圖行動編輯器) - Windows 純開源一鍵編譯系統
echo ================================================================================
echo  📌 專案目錄 : %PROJECT_ROOT%
echo  📌 建置任務 : %GRADLE_TASKS%
echo  📌 合規策略 : 100%% 純開源免費工具鏈 (OpenJDK GPLv2+CE / Gradle Apache 2.0)
echo                [嚴格禁止並自動排除 Oracle 商業授權 JDK]
echo ================================================================================
echo.

REM ============================================================================
REM Step A - Detect or Bootstrap 100% Open-Source OpenJDK (Reject Oracle JDK)
REM ============================================================================
echo [Step A] 正在檢查並驗證純開源 OpenJDK 環境...

if exist "C:\ProgramData\Oracle\Java\javapath\java.exe" goto :WarnOraclePath
goto :AfterWarnOraclePath

:WarnOraclePath
echo   ⚠️  [合規攔截] 偵測到系統存在 "C:\ProgramData\Oracle\Java\javapath\java.exe"！
echo       依據本專案 100%% 開源授權規範（嚴禁 Oracle Commercial / NFTC 商業限制授權），
echo       已主動拒絕系統預設 Oracle Java 路徑，改用純開源 OpenJDK。

:AfterWarnOraclePath
if exist "C:\Program Files\Java" (
    for /d %%D in ("C:\Program Files\Java\jdk*") do call :WarnOracleDir "%%~fD"
)

set "SELECTED_JAVA_HOME="
set "JDK_IMPLEMENTOR="
set "JDK_IMPL_VERSION="
set "JDK_JAVA_VERSION="

if "%BOOTSTRAP_JDK%"=="1" goto :BootstrapOpenJdk17

REM 1. Check local .toolchain directory first
if exist "%PROJECT_ROOT%\.toolchain" (
    for /d %%D in ("%PROJECT_ROOT%\.toolchain\jdk*" "%PROJECT_ROOT%\.toolchain\openjdk*") do (
        if "!SELECTED_JAVA_HOME!"=="" call :TryCandidateJdk "%%~fD"
        if "!SELECTED_JAVA_HOME!"=="" (
            for /d %%S in ("%%~fD\jdk*") do (
                if "!SELECTED_JAVA_HOME!"=="" call :TryCandidateJdk "%%~fS"
            )
        )
    )
)

REM 2. Check existing JAVA_HOME environment variable
if "!SELECTED_JAVA_HOME!"=="" (
    if defined JAVA_HOME call :TryCandidateJdk "%JAVA_HOME%"
)

REM 3. Search approved 100% Open-Source OpenJDK distributions
REM    (Eclipse Temurin / Microsoft / Amazon Corretto / Azul Zulu / BellSoft Liberica)
if "!SELECTED_JAVA_HOME!"=="" (
    for %%P in (
        "C:\Program Files\Eclipse Adoptium"
        "%LOCALAPPDATA%\Programs\EclipseAdoptium"
        "%LOCALAPPDATA%\Programs\Eclipse Adoptium"
        "C:\Program Files\Microsoft"
        "%LOCALAPPDATA%\Programs\Microsoft"
        "C:\Program Files\Amazon Corretto"
        "C:\Program Files\Zulu"
        "C:\Program Files\BellSoft"
    ) do (
        if exist "%%~P" (
            for /d %%D in ("%%~P\jdk*" "%%~P\zulu*" "%%~P\LibericaJDK*") do (
                if "!SELECTED_JAVA_HOME!"=="" call :TryCandidateJdk "%%~fD"
            )
        )
    )
)

if not "!SELECTED_JAVA_HOME!"=="" goto :JdkFound

:BootstrapOpenJdk17
echo   🌐 正在從 Eclipse Adoptium 官方開源 API 自動下載免安裝 OpenJDK 17...
echo   📥 來源網址 : https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse
set "TOOLCHAIN_DIR=%PROJECT_ROOT%\.toolchain"
set "BOOTSTRAP_DEST=%TOOLCHAIN_DIR%\jdk-17"
set "BOOTSTRAP_ZIP=%TOOLCHAIN_DIR%\temurin-openjdk17.zip"
set "ADOPTIUM_URL=https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"

if not exist "%TOOLCHAIN_DIR%" mkdir "%TOOLCHAIN_DIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%ADOPTIUM_URL%' -OutFile '%BOOTSTRAP_ZIP%' -UseBasicParsing; if (Test-Path '%BOOTSTRAP_DEST%') { Remove-Item '%BOOTSTRAP_DEST%' -Recurse -Force }; $extractTmp = Join-Path '%TOOLCHAIN_DIR%' 'extract_tmp'; if (Test-Path $extractTmp) { Remove-Item $extractTmp -Recurse -Force }; Expand-Archive -Path '%BOOTSTRAP_ZIP%' -DestinationPath $extractTmp -Force; $innerDir = Get-ChildItem -Path $extractTmp -Directory | Select-Object -First 1; if ($innerDir) { Move-Item -Path $innerDir.FullName -Destination '%BOOTSTRAP_DEST%' -Force } else { Move-Item -Path $extractTmp -Destination '%BOOTSTRAP_DEST%' -Force }; if (Test-Path $extractTmp) { Remove-Item $extractTmp -Recurse -Force }; if (Test-Path '%BOOTSTRAP_ZIP%') { Remove-Item '%BOOTSTRAP_ZIP%' -Force }"
if errorlevel 1 goto :BootstrapJdkError

call :TryCandidateJdk "%BOOTSTRAP_DEST%"
if "!SELECTED_JAVA_HOME!"=="" goto :BootstrapJdkError
goto :JdkFound

:BootstrapJdkError
echo   ❌ [錯誤] 自動下載或驗證免安裝 Eclipse Temurin OpenJDK 17 失敗！請檢查網路連線。
exit /b 1

:JdkFound
set "JAVA_HOME=%SELECTED_JAVA_HOME%"
set "PATH=%JAVA_HOME%\bin;%PATH%"

echo   ✅ [開源合規驗證通過] 已選定純開源 OpenJDK：
echo      - JAVA_HOME   : %JAVA_HOME%
echo      - 發行商      : %JDK_IMPLEMENTOR% (%JDK_IMPL_VERSION%)
echo      - Java 版本   : %JDK_JAVA_VERSION%
echo      - 開源授權    : GNU General Public License v2 with Classpath Exception (GPLv2+CE)
echo.

REM ============================================================================
REM Step B - Detect and Configure Android SDK (local.properties)
REM ============================================================================
echo [Step B] 正在檢查並配置 Android SDK 環境...

set "DETECTED_SDK_DIR="
set "LOCAL_PROPS=%PROJECT_ROOT%\local.properties"

if exist "%LOCAL_PROPS%" (
    for /f "usebackq tokens=1,* delims==" %%A in ("%LOCAL_PROPS%") do (
        if "%%A"=="sdk.dir" (
            set "RAW_SDK_VAL=%%B"
            set "RAW_SDK_VAL=!RAW_SDK_VAL:\:=:!"
            set "RAW_SDK_VAL=!RAW_SDK_VAL:\\=\!"
            if exist "!RAW_SDK_VAL!" set "DETECTED_SDK_DIR=!RAW_SDK_VAL!"
        )
    )
)

if "!DETECTED_SDK_DIR!"=="" (
    if defined ANDROID_HOME (
        if exist "%ANDROID_HOME%" set "DETECTED_SDK_DIR=%ANDROID_HOME%"
    )
)
if "!DETECTED_SDK_DIR!"=="" (
    if defined ANDROID_SDK_ROOT (
        if exist "%ANDROID_SDK_ROOT%" set "DETECTED_SDK_DIR=%ANDROID_SDK_ROOT%"
    )
)

if "!DETECTED_SDK_DIR!"=="" (
    for %%S in (
        "%PROJECT_ROOT%\.toolchain\android-sdk"
        "%LOCALAPPDATA%\Android\Sdk"
        "C:\Android\Sdk"
        "D:\Android\Sdk"
        "D:\Tool\AndroidSDK"
        "C:\Tool\AndroidSDK"
    ) do (
        if "!DETECTED_SDK_DIR!"=="" (
            if exist "%%~S\platforms" set "DETECTED_SDK_DIR=%%~fS"
            if exist "%%~S\platform-tools" set "DETECTED_SDK_DIR=%%~fS"
            if exist "%%~S\cmdline-tools" set "DETECTED_SDK_DIR=%%~fS"
        )
    )
)

if "!DETECTED_SDK_DIR!"=="" goto :NoAndroidSdkFound

set "ANDROID_HOME=%DETECTED_SDK_DIR%"
set "ANDROID_SDK_ROOT=%DETECTED_SDK_DIR%"
if exist "%ANDROID_HOME%\platform-tools" set "PATH=%ANDROID_HOME%\platform-tools;%PATH%"

set "ESCAPED_SDK_DIR=!DETECTED_SDK_DIR:\=\\!"
set "ESCAPED_SDK_DIR=!ESCAPED_SDK_DIR::=\:!"
(
    echo ## Automatically generated by MyGMap open-source build.bat
    echo sdk.dir=!ESCAPED_SDK_DIR!
) > "%LOCAL_PROPS%"

echo   ✅ 已配置開源 Android SDK Build-Tools：
echo      - ANDROID_HOME     : %ANDROID_HOME%
echo      - local.properties : sdk.dir=!ESCAPED_SDK_DIR!
echo.
goto :StepCBuild

:NoAndroidSdkFound
echo   ❌ [未偵測到 Android SDK] 找不到本機 Android SDK 目錄！
echo   ----------------------------------------------------------------------------
echo   💡 開源 Android SDK Command-Line Tools 安裝指引：
echo      1. 下載官方免費 Command-line tools 解壓至 %%LOCALAPPDATA%%\Android\Sdk\cmdline-tools\latest
echo      2. 執行指令安裝 Build-Tools 34 與 Platform 34：
echo         sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
echo      3. 或設定環境變數 ANDROID_HOME 指向您的 Android SDK 路徑後重新執行 build.bat。
echo   ----------------------------------------------------------------------------
exit /b 1

REM ============================================================================
REM Step C - Resolve App Version & Execute Gradle Wrapper (Apache 2.0) Build
REM ============================================================================
:StepCBuild
set "VERSION_PROPS=%PROJECT_ROOT%\version.properties"
set "CUR_MAJOR=1"
set "CUR_MINOR=0"
set "CUR_PATCH=0"
set "CUR_CODE=1"

if exist "%VERSION_PROPS%" (
    for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%VERSION_PROPS%") do (
        if "%%A"=="VERSION_MAJOR" set "CUR_MAJOR=%%B"
        if "%%A"=="VERSION_MINOR" set "CUR_MINOR=%%B"
        if "%%A"=="VERSION_PATCH" set "CUR_PATCH=%%B"
        if "%%A"=="VERSION_CODE" set "CUR_CODE=%%B"
    )
)

set "APP_VERSION_PATCH=%CUR_PATCH%"
set "APP_VERSION_CODE=%CUR_CODE%"
set "APP_VERSION_NAME=%CUR_MAJOR%.%CUR_MINOR%.%CUR_PATCH%"
set "VERSION_GRADLE_ARGS="
set "WILL_BUMP_VERSION=0"

if /i "%BUILD_MODE%"=="debug" set "WILL_BUMP_VERSION=1"
if /i "%BUILD_MODE%"=="release" set "WILL_BUMP_VERSION=1"
if "%NO_BUMP%"=="1" set "WILL_BUMP_VERSION=0"

if "%WILL_BUMP_VERSION%"=="1" (
    set /a APP_VERSION_PATCH=CUR_PATCH + 1
    set /a APP_VERSION_CODE=CUR_CODE + 1
    set "APP_VERSION_NAME=%CUR_MAJOR%.%CUR_MINOR%.!APP_VERSION_PATCH!"
    set "VERSION_GRADLE_ARGS=-PnextVersionCode=!APP_VERSION_CODE! -PnextVersionName=!APP_VERSION_NAME!"
    echo [Step C] 正在透過 Gradle Wrapper ^(Apache 2.0^) 執行建置任務: %GRADLE_TASKS% ...
    echo   🏷️  目前版本 : v%CUR_MAJOR%.%CUR_MINOR%.%CUR_PATCH% ^(versionCode=%CUR_CODE%^)
    echo   🚀 目標版本 : v!APP_VERSION_NAME! ^(versionCode=!APP_VERSION_CODE!^) [編譯成功後自動寫回 version.properties]
) else (
    echo [Step C] 正在透過 Gradle Wrapper ^(Apache 2.0^) 執行建置任務: %GRADLE_TASKS% ...
    echo   🏷️  目前版本 : v%APP_VERSION_NAME% ^(versionCode=%APP_VERSION_CODE%^)
)
echo --------------------------------------------------------------------------------

pushd "%PROJECT_ROOT%"
call "%PROJECT_ROOT%\gradlew.bat" %GRADLE_TASKS% %VERSION_GRADLE_ARGS% -Dorg.gradle.java.home="%JAVA_HOME%" --console=plain
set "GRADLE_EXIT_CODE=%ERRORLEVEL%"
popd

echo --------------------------------------------------------------------------------
if not "%GRADLE_EXIT_CODE%"=="0" goto :GradleBuildFailed

if /i "%BUILD_MODE%"=="clean" goto :CleanSuccess
if /i "%BUILD_MODE%"=="test" goto :TestSuccess
goto :StepDPackageApk

:GradleBuildFailed
echo.
echo ================================================================================
echo  ❌ 編譯失敗 (Gradle Exit Code: %GRADLE_EXIT_CODE%)
echo  請檢查上方錯誤訊息，或嘗試執行：build.bat clean debug
echo ================================================================================
exit /b %GRADLE_EXIT_CODE%

:CleanSuccess
echo.
echo ================================================================================
echo  ✅ 清理完成 (gradlew clean) — 100%% 純開源工具鏈
echo ================================================================================
exit /b 0

:TestSuccess
echo.
echo ================================================================================
echo  ✅ 單元測試全部通過 (gradlew testDebugUnitTest) — 100%% 純開源工具鏈
echo  📜 使用 JDK : %JDK_IMPLEMENTOR% (%JDK_IMPL_VERSION%) [GPLv2+CE]
echo ================================================================================
exit /b 0

REM ============================================================================
REM Step D - Verify APK Output, Persist Version Bump, Copy to dist\, and Print Summary
REM ============================================================================
:StepDPackageApk
set "RAW_APK_PATH=%PROJECT_ROOT%\app\build\outputs\apk\debug\app-debug.apk"
set "DIST_DIR=%PROJECT_ROOT%\dist"
set "DIST_APK_PATH=%DIST_DIR%\MyGMap-debug.apk"
set "DIST_VERSIONED_APK_PATH=%DIST_DIR%\MyGMap-debug-v%APP_VERSION_NAME%.apk"

if /i "%BUILD_MODE%"=="release" (
    if exist "%PROJECT_ROOT%\app\build\outputs\apk\release\app-release.apk" (
        set "RAW_APK_PATH=%PROJECT_ROOT%\app\build\outputs\apk\release\app-release.apk"
    ) else if exist "%PROJECT_ROOT%\app\build\outputs\apk\release\app-release-unsigned.apk" (
        set "RAW_APK_PATH=%PROJECT_ROOT%\app\build\outputs\apk\release\app-release-unsigned.apk"
    )
    set "DIST_APK_PATH=%DIST_DIR%\MyGMap-release.apk"
    set "DIST_VERSIONED_APK_PATH=%DIST_DIR%\MyGMap-release-v%APP_VERSION_NAME%.apk"
)

if not exist "%RAW_APK_PATH%" goto :MissingApkError

if "%WILL_BUMP_VERSION%"=="1" (
    (
        echo # MyGMap App Version Configuration ^(managed automatically by build.bat on successful APK builds^)
        echo VERSION_MAJOR=%CUR_MAJOR%
        echo VERSION_MINOR=%CUR_MINOR%
        echo VERSION_PATCH=%APP_VERSION_PATCH%
        echo VERSION_CODE=%APP_VERSION_CODE%
    ) > "%VERSION_PROPS%"
)

if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"
copy /y "%RAW_APK_PATH%" "%DIST_APK_PATH%" >nul
copy /y "%RAW_APK_PATH%" "%DIST_VERSIONED_APK_PATH%" >nul

set "APK_INFO_STR="
set "APK_INFO_TMP=%TEMP%\mygmap_apk_info.txt"
powershell -NoProfile -Command "$f = Get-Item -LiteralPath '%DIST_VERSIONED_APK_PATH%'; $mb = [math]::Round($f.Length / 1MB, 2); $kb = [math]::Round($f.Length / 1KB, 1); $ts = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'); Set-Content -LiteralPath '%APK_INFO_TMP%' -Value \"$mb MB ($kb KB / $($f.Length) bytes) -- Last Modified: $ts\" -Encoding Ascii"
if exist "%APK_INFO_TMP%" (
    set /p APK_INFO_STR=<"%APK_INFO_TMP%"
    del /q "%APK_INFO_TMP%" >nul 2>&1
)

echo.
echo ================================================================================
echo  ✅ 編譯結果：成功（100%% 純開源工具鏈建置）
echo --------------------------------------------------------------------------------
echo  🏷️  APK 版本號碼：v%APP_VERSION_NAME% ^(versionCode=%APP_VERSION_CODE%^)
if "%WILL_BUMP_VERSION%"=="1" (
    echo      （已自動遞增並寫回 version.properties）
)
echo --------------------------------------------------------------------------------
echo  📜 工具鏈授權確認：
echo     - OpenJDK 發行版 : %JDK_IMPLEMENTOR% (%JDK_IMPL_VERSION% / Java %JDK_JAVA_VERSION%)
echo     - OpenJDK 路徑   : %JAVA_HOME%
echo     - OpenJDK 授權   : GNU GPL v2 with Classpath Exception (GPLv2+CE) [非 Oracle 商業版]
echo     - 建置工具鏈授權 : Gradle Wrapper 8.7 ^& Android SDK Build-Tools (Apache License 2.0)
echo --------------------------------------------------------------------------------
echo  📂 Gradle 原始 APK 完整路徑：
echo     %RAW_APK_PATH%
echo.
echo  📂 快捷提取 APK（固定檔名）：
echo     %DIST_APK_PATH%
echo.
echo  📂 版號歸檔 APK（含版本號）：
echo     %DIST_VERSIONED_APK_PATH%
echo.
echo  📦 檔案大小 (MB/KB) 與最後修改時間：
echo     %APK_INFO_STR%
echo ================================================================================

where adb >nul 2>&1
if not errorlevel 1 goto :ShowAdbHint
goto :AfterAdbHint

:ShowAdbHint
echo.
echo  📱 [ADB 快捷安裝提示] 偵測到系統具備開源 Android Platform Tools (adb)：
echo     可連接手機並執行以下指令一鍵安裝 APK：
echo     adb install -r "%DIST_VERSIONED_APK_PATH%"

:AfterAdbHint
if "%NO_EXPLORER%"=="0" goto :OpenExplorerSelect
goto :BuildDone

:OpenExplorerSelect
echo.
echo  🗂️  正在開啟 Windows 檔案總管並定位至 APK 檔案...
explorer.exe /select,"%DIST_VERSIONED_APK_PATH%"

:BuildDone
echo.
exit /b 0

:MissingApkError
echo.
echo   ⚠️  Gradle 任務執行完成，但未在預期路徑找到 APK 檔案：%RAW_APK_PATH%
exit /b 1

REM ============================================================================
REM Subroutines
REM ============================================================================
:WarnOracleDir
echo   ⚠️  [合規攔截] 偵測到本機存在 "%~1"，疑似為受商業條款限制之 Oracle JDK，將檢查並排除。
exit /b 0

:TryCandidateJdk
set "CAND_DIR=%~1"
if "%CAND_DIR%"=="" exit /b 0
if "%CAND_DIR:~-1%"=="\" set "CAND_DIR=%CAND_DIR:~0,-1%"
if not exist "%CAND_DIR%\bin\java.exe" exit /b 0
if not exist "%CAND_DIR%\release" exit /b 0

set "CAND_IMPL="
set "CAND_IMPL_VER="
set "CAND_JAVA_VER="

for /f "usebackq tokens=1,* delims==" %%A in ("%CAND_DIR%\release") do (
    if "%%A"=="IMPLEMENTOR" set "CAND_IMPL=%%~B"
    if "%%A"=="IMPLEMENTOR_VERSION" set "CAND_IMPL_VER=%%~B"
    if "%%A"=="JAVA_VERSION" set "CAND_JAVA_VER=%%~B"
)

echo "!CAND_IMPL!" | findstr /i "Oracle" >nul 2>&1
if not errorlevel 1 goto :RejectOracleCandidate

echo "%CAND_DIR%" | findstr /i "\\Oracle\\ \\Java\\jdk" >nul 2>&1
if not errorlevel 1 goto :RejectOracleCandidate

if "!CAND_IMPL!"=="" exit /b 0
if "!CAND_IMPL_VER!"=="" set "CAND_IMPL_VER=OpenJDK-!CAND_JAVA_VER!"

set "SELECTED_JAVA_HOME=%CAND_DIR%"
set "JDK_IMPLEMENTOR=!CAND_IMPL!"
set "JDK_IMPL_VERSION=!CAND_IMPL_VER!"
set "JDK_JAVA_VERSION=!CAND_JAVA_VER!"
exit /b 0

:RejectOracleCandidate
echo   🚫 [合規拒絕] 發現受商業授權限制之 Oracle JDK: "%CAND_DIR%" (IMPLEMENTOR="!CAND_IMPL!") — 拒絕使用！
exit /b 0

:ShowHelp
echo.
echo 用法: build.bat [選項] [目標]
echo.
echo 目標 (預設為 debug):
echo   debug            編譯 Debug APK (assembleDebug) 並複製至 dist\MyGMap-debug.apk
echo   release          編譯 Release APK (assembleRelease) 並複製至 dist\MyGMap-release.apk
echo   test             執行單元測試 (testDebugUnitTest)
echo   check            同時執行單元測試與 Debug APK 編譯 (testDebugUnitTest assembleDebug)
echo   clean            清理建置快取 (clean)
echo.
echo 選項:
echo   --no-explorer    編譯完成後不自動彈出 Windows 檔案總管視窗
echo   --no-bump        編譯 APK 時不自動遞增 version.properties 版本號
echo   --bootstrap-jdk  強制從 Eclipse Adoptium 官方 API 自動下載免安裝 OpenJDK 17 至 .toolchain\jdk-17
echo   --help, -h       顯示本說明訊息
echo.
exit /b 0
