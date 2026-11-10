# MyGMap (Google 我的地圖行動編輯器)

**MyGMap** 是一款專為 Android 手機打造的 **「Google 我的地圖 (Google My Maps)」原生行動編輯器**。
由於 Google 官方已下架 Android 版 My Maps App，且手機瀏覽器開啟桌面版編輯器 (`https://www.google.com/maps/d/`) 時會有左側圖層面板遮擋超過 60% 畫面、頂部工具列按鈕僅 `24px` 難以點擊、無法一鍵打卡目前 GPS 座標等痛點，本專案透過 **Jetpack Compose + 動態 User-Agent WebView + 模組化 CSS/JS 注入 + Android 原生工具列與高精準度 GPS 自動化狀態機**，實現 **100% 雲端零時差同步** 的單手行動編輯體驗。

---

## ✨ 核心功能亮點

1. **🔐 突破 Google OAuth `403 disallowed_useragent` 限制與登入持久化**
   - 智慧識別 `accounts.google.com` 登入流程與 `google.com/maps/d` 編輯流程，動態切換淨化版 Chrome UA 與完整桌面版 Chrome UA。
   - 支援第一方與第三方 Cookie 即時 `flush()` 寫入磁碟，登入一次即可長久保持工作階段。
2. **🗂️ 左側圖層面板抽屜化 & 原生單手底部工具列 (`BottomActionBar`)**
   - 預設將佔用畫面的左側圖層面板 (`#featurelist-pane`) 收合為滑出式抽屜，釋放 **100% 全螢幕地圖視野**。
   - 底部提供 `48dp+` 大尺寸原生按鈕：**🗂️ 圖層**、**🔍 搜尋**、**📌 插針**、**🏠 列表**、**⚙️ 模式**。
3. **📍 殺手級功能：一鍵新增目前 GPS 位置（全自動打卡狀態機）**
   - 點擊右下方懸浮按鈕 **「📍 標記目前位置」**，自動透過 `FusedLocationProviderClient` 與原生 `LocationManager` 雙重備援取得高精準度經緯度。
   - 輸入自訂「地點名稱」與「備註說明」後，由 `MutationObserver` 自動執行 **Step 1 確認圖層並搜尋座標 ➔ Step 2 自動點擊「新增至地圖」➔ Step 3 自動填入氣泡窗標題與備註並點擊儲存**（附帶剪貼簿自動複製保底機制）。
4. **🗺️ 一鍵跳轉官方 Google Maps App 導航 / 查看街景 / 載入雲端地圖**
   - 自動從目前網址提取 `mid`（地圖 ID）與 `ll`（地圖中心），或從目前選取的圖釘氣泡窗 / 搜尋框提取座標，直接喚起手機內的官方 **Google Maps App (`com.google.android.apps.maps`)** 執行路線導航、查看 360° 街景或載入雲端圖資（未安裝時自動降級以外部瀏覽器開啟）。
5. **📥 支援 KML / KMZ 匯出與系統 `DownloadManager` 下載**
   - 完整實作 `WebView.setDownloadListener`，同步帶入 `CookieManager` 認證 Cookie 與 `User-Agent`，自動解析 `Content-Disposition` 檔名（支援 UTF-8 中文檔名，預設副檔名為 `.kmz` 或 `.kml`），將圖資匯出儲存至手機系統 `Downloads`（下載）資料夾。
6. **🖥️ 原生排版逃生門 (CSS Bypass) & 🎯 開發者 DOM 探測工具**
   - 當開啟官方共用設定或匯入對話框時，可隨時一鍵切換回「🖥️ 原始桌面排版」。
   - 內建「🔍 DOM 探測除錯模式」，點擊網頁任意元素即可檢視並複製其推薦 CSS Selector 與完整屬性 JSON。

---

## 🛠️ 如何編譯 APK（支援 Windows 一鍵純開源編譯腳本 `build.bat`）

### ⚠️ 100% 開源免費工具鏈合規聲明 (Open-Source Toolchain Compliance)
本專案建置流程嚴格遵循 **100% 開源免費且可商用授權規範**，**絕不依賴或使用任何受商業授權限制之軟體工具**：
- **🚫 嚴禁使用 Oracle JDK**：`build.bat` 內建 `<JAVA_HOME>\release` 發行商 (`IMPLEMENTOR`) 檢核與路徑掃描機制，主動攔截並拒絕受 Oracle Commercial License / NFTC 限制之 `Oracle Corporation` JDK（如 `C:\Program Files\Java\jdk-*` 或 `C:\ProgramData\Oracle\Java\javapath`）。
- **✅ 僅限使用 GPLv2 + Classpath Exception 開源授權之 OpenJDK**：
  - **Eclipse Temurin (Adoptium OpenJDK)**
  - **Microsoft Build of OpenJDK**
  - **Amazon Corretto OpenJDK**
  - **Azul Zulu Community OpenJDK**
  - **BellSoft Liberica OpenJDK**
  - 若本機未安裝上述開源 OpenJDK，`build.bat` 支援自動從 **Eclipse Adoptium 官方開源 API** 下載免安裝版 Temurin OpenJDK 17 至專案 `.toolchain\jdk-17` 目錄。
- **✅ 純開源建置工具**：全程使用 **Apache License 2.0** 開源授權之 **Gradle Wrapper (`gradlew.bat`)** 與開源 Android SDK Build-Tools 進行命令列建置。

---

### 方法一：使用 Windows 一鍵純開源自動編譯腳本 (`build.bat`)【推薦】

在專案根目錄下直接雙擊執行 `build.bat`，或在終端機 (CMD / PowerShell) 執行：

```bat
:: 預設一鍵編譯 Debug APK，完成後自動複製至 dist\MyGMap-debug.apk 並開啟檔案總管定位
build.bat

:: 編譯 Debug APK 但不自動彈出檔案總管視窗（適合 CI / 自動化環境）
build.bat --no-explorer

:: 同時執行單元測試與編譯 Debug APK
build.bat check

:: 僅執行單元測試 (testDebugUnitTest)
build.bat test

:: 編譯 Release APK (複製至 dist\MyGMap-release.apk)
build.bat release

:: 強制從 Eclipse Adoptium 官方開源 API 自動下載免安裝 OpenJDK 17 至 .toolchain\jdk-17
build.bat --bootstrap-jdk
```

#### 📦 APK 產出路徑一覽
編譯成功後，`build.bat` 會於終端機清楚印出工具鏈開源授權確認、檔案大小與以下兩個 APK 完整路徑：
1. **快捷提取 APK 路徑（已自動歸檔命名）**：
   ```text
   d:\CodeBase\GuiterEvent\MyGMap_guiter\dist\MyGMap-debug.apk
   ```
2. **Gradle 原始產出 APK 路徑**：
   ```text
   d:\CodeBase\GuiterEvent\MyGMap_guiter\app\build\outputs\apk\debug\app-debug.apk
   ```

---

### 方法二：使用 Android Studio 或手動 Gradle 指令

#### 1. 環境需求
- **OpenJDK 版本**：OpenJDK 17 或 21（推薦 Eclipse Temurin / Adoptium OpenJDK，GPLv2+CE）
- **Android SDK**：`compileSdk = 34`、`minSdk = 26` (Android 8.0+)、`targetSdk = 34`

#### 2. 透過終端機手動執行 Gradle Wrapper
```bash
# Windows PowerShell / CMD
.\gradlew.bat assembleDebug

# macOS / Linux
./gradlew assembleDebug

# 執行單元測試
.\gradlew.bat testDebugUnitTest
```

---

## 📱 手機版專屬功能操作指南

| 功能項目 | 操作方式 |
| :--- | :--- |
| **🗂️ 展開 / 收合圖層抽屜** | 點擊底部工具列最左側的 **「🗂️ 圖層」** 按鈕，或點擊抽屜展開後的右側半透明遮罩（亦支援在遮罩上向左滑動收合）。 |
| **🔍 快速搜尋地點並加入地圖** | 點擊底部 **「🔍 搜尋」** 輸入關鍵字或座標送出；點選地圖上的綠色搜尋圖釘後，點擊底部浮動面板的 **「➕ 加入地圖」** 即可一鍵加入當前圖層。 |
| **📌 手動插針模式** | 點擊底部 **「📌 插針」** 啟動新增標記工具，直接點擊地圖任意處放置圖釘；點擊頂部琥珀色橫幅的 **「🖐️ 手型選取/平移」**（或按手機返回鍵）可隨時退回平移模式。 |
| **📍 一鍵新增目前 GPS 位置** | 點擊右下角綠色懸浮按鈕 **「📍 標記目前位置」** ➔ 授權定位權限 ➔ 輸入「地點名稱」與「備註說明」 ➔ 點擊 **「📍 一鍵加入我的地圖 (自動命名儲存)」**，系統將全自動完成搜尋、加入圖層、填入氣泡窗文字與儲存。 |
| **🗺️ 在 Google Maps App 開啟 (導航/街景)** | 點擊頂部導航列的 **🗺️ 地圖圖示** 或底部 **「⚙️ 模式 ➔ 🗺️ 在 Google Maps App 開啟」**，系統會自動提取目前地圖 `mid` 與選取圖釘/搜尋框座標，可一鍵選擇 **「🧭 路線導航」**、**「🏙️ 查看 360° 街景」** 或 **「🗺️ 載入整張雲端地圖」**。 |
| **📥 匯出下載 KML / KMZ** | 可直接於地圖頁面點擊 **「⚙️ 模式 ➔ 📥 匯出為 KML / KMZ 檔案」**，或在網頁圖層面板點擊三點選單的「匯出成 KML/KMZ」，檔案將自動下載至系統 `Downloads` 目錄。 |
| **🖥️ 切換原始桌面排版 (CSS 逃生門)** | 當需要操作複雜的桌面版彈窗（如匯入檔案、共用權限管理）時，點擊 **「⚙️ 模式 ➔ 📱/🖥️ 切換排版」** 即可立即卸載行動版 CSS 恢復原始桌面視圖。 |

---

## 📂 專案結構總覽

```text
MyGMap_guiter/
├── build.bat                        # Windows 100% 純開源工具鏈一鍵編譯與 APK 歸檔腳本
├── dist/
│   └── MyGMap-debug.apk             # 一鍵編譯完成後自動歸檔提取之 APK 檔案
├── PROJECT_PLAN.md                  # 專案七階段開發藍圖與 AI 交接紀錄
├── README.md                        # 專案編譯與手機版操作說明文件
└── app/src/main/
    ├── AndroidManifest.xml          # 網路、GPS 定位、下載與外部 Google Maps 套件查詢設定
    ├── assets/
    │   ├── inject_style.css         # 行動版抽屜化、觸控熱區放大、手勢防衝突與逃生門樣式
    │   └── inject_script.js         # 多重容錯 DOM 搜尋器、Closure 事件模擬、GPS 打卡狀態機與導航資訊提取
    └── java/com/guiterevent/mygmap/
        ├── MainActivity.kt                  # App 進入點與 Cookie 持久化生命週期管理
        ├── location/LocationHelper.kt       # FusedLocation + LocationManager 雙重備援高精準度定位
        ├── ui/
        │   ├── MyMapScreen.kt               # 主畫面 (WebView + 狀態列 + 底部工具列 + 離線防呆 + 手勢防衝突)
        │   ├── BottomActionBar.kt           # 單手操作底部工具列、快速搜尋與 Google Maps 跳轉對話框
        │   └── QuickPinDialog.kt            # 快速標記目前 GPS 位置對話框與自動化進度橫幅
        └── webview/
            ├── MyMapWebViewClient.kt        # 動態 User-Agent 偽裝、Cookie Flush 與網路連線檢查
            ├── MyMapJsBridge.kt             # @JavascriptInterface (window.AndroidBridge) 雙向通訊
            ├── WebViewInjector.kt           # 模組化 CSS/JS 讀取快取與 JS API 呼叫封裝
            └── MapExportAndIntentHelper.kt  # Google Maps App 導航/街景 Intent 跳轉與 KML/KMZ DownloadManager 處理器
```
