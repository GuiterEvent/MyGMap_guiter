# MyGMap (Google 我的地圖行動編輯器) — 專案架構與 AI 開發指南

> **給 AI 助手的特別指令 (AI Agent Instructions)**：
> 1. 每次收到開發任務時，請**務必先完整閱讀本檔案 (`PROJECT_PLAN.md`)**，了解整體架構、技術限制與目前進度。
> 2. 本專案採用分階段 (Phase 1 ~ Phase 5) 迭代開發。當你完成當前階段的實作與驗證後，請**務必更新本檔案底部的「開發進度追蹤」與「AI 交接紀錄 (Handover Log)」**，記錄你新增/修改的檔案路徑、實際採用的 DOM Selector 以及需要注意的事項，方便下一個對話的 AI 無縫接手。

---

## 1. 專案背景與核心目標

Google 官方過去曾推出 Android 版「Google 我的地圖 (My Maps)」App，但已於數年前下架。目前使用者若要在手機上編輯「我的地圖」，只能透過手機瀏覽器開啟電腦版網頁 (`https://www.google.com/maps/d/`)，面臨以下嚴重痛點：
- **左側圖層面板佔用過大**：在手機直向螢幕上，左側圖層與清單面板直接遮擋 60% 以上的地圖畫布。
- **觸控目標過小**：桌面版頂部工具列（手型、新增圖釘、畫線、搜尋）按鈕僅約 `24px`，極難用手指精準點擊。
- **缺乏行動定位整合**：無法直接點擊一個按鈕就把「手機目前的 GPS 座標」快速加為地圖上的圖釘並命名。
- **API 限制**：Google Drive API 雖能看到 `application/vnd.google-apps.map` 檔案，但官方未開放任何 REST API 進行圖資內容讀寫。

### 解決方案：Android WebView + JS/CSS 注入改造 + 原生底部工具列 (Native Action Bar)
透過開發一個 Android 原生殼 (Kotlin + Jetpack Compose)，內嵌偽裝為桌面版 Chrome 的 `WebView` 直接載入官方編輯網頁，確保 **100% 零時差同步官方圖資**（編輯後可直接在官方 Google Maps App 的「已儲存 > 地圖」中查看），並透過注入自訂 CSS/JS 與底部原生工具列，將其強制改造為符合單手操作的行動版 App。

---

## 2. 技術棧與環境規範 (Tech Stack)

- **開發語言**：Kotlin
- **UI 框架**：Jetpack Compose (Material 3) + `AndroidView` 包裝原生 `WebView`
- **最低系統需求**：`minSdk = 26` (Android 8.0), `targetSdk = 34` (或環境最新穩定版)
- **定位服務**：Google Play Services Location (`FusedLocationProviderClient`) 或原生 `LocationManager`
- **資源管理規範**：
  - 注入 WebView 的 CSS 與 JavaScript **禁止將大段程式碼硬編碼 (hardcode) 在 Kotlin 字串中**。
  - 必須獨立存放於 `app/src/main/assets/inject_style.css` 與 `app/src/main/assets/inject_script.js`，由 Android 讀取後注入，以便未來 Google 網頁改版時可快速維護。

---

## 3. 核心技術難點與實作對策 (Critical Technical Guidelines)

### 3.1 突破 Google OAuth 在 WebView 的 `403 disallowed_useragent` 限制
- **問題**：Android `WebView` 預設的 User-Agent 帶有 `; wv` 字樣，Google 登入頁面 (`accounts.google.com`) 偵測到後會拒絕登入；若全程硬改為桌面版 UA，有時也會觸發安全檢查。
- **對策**：
  1. 移除 User-Agent 中的 `; wv` 與 `Version/4.0` 標記。
  2. **動態 User-Agent 切換策略**：
     - 當網址屬於 `accounts.google.com`（登入驗證階段）時，使用移除 `; wv` 的標準 Chrome Android UA 或乾淨的桌面版 Chrome UA。
     - 當網址進入 `www.google.com/maps/d`（我的地圖列表與編輯器）時，強制切換為桌面版 Chrome UA：
       `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`
  3. **Cookie 持久化**：開啟 `CookieManager.getInstance().setAcceptCookie(true)` 與 `setAcceptThirdPartyCookies(webView, true)`，並在 `onPageFinished` 及 App 進入背景時呼叫 `CookieManager.getInstance().flush()`，確保只需登入一次。

### 3.2 Google My Maps DOM 選擇器容錯機制 (Closure Library 防禦設計)
- **問題**：Google 我的地圖前端使用 Google Closure Library 建構，部分 class 名稱會經過混淆（如 `.hz-featurelist-panel` 等可能變動），僅依賴單一 CSS Selector 容易失效。
- **對策**：在 `inject_script.js` 中實作統一的 `findElement(strategy)` 輔助函式，按優先序尋找 DOM：
  1. **固定 ID**：例如 `#mapsprosearch-field` (搜尋輸入框)、`#mapsprosearch-button` (搜尋按鈕)、`#addtomap-button` (新增至地圖按鈕)、`#featurelist-pane` (左側圖層面板)。
  2. **語意屬性 (`aria-label` / `data-tooltip` / `title`)**：同時匹配繁體中文與英文，例如：
     - 新增標記：`[aria-label*="新增標記"]`, `[aria-label*="Add marker"]`, `[data-tooltip*="新增標記"]`, `[data-tooltip*="Add marker"]`
     - 選取項目/手型工具：`[aria-label*="選取項目"]`, `[aria-label*="Select items"]`
     - 繪製線條：`[aria-label*="繪製線條"]`, `[aria-label*="Draw a line"]`
  3. **DOM 結構啟發式搜尋 (Heuristic Fallback)**：若上述皆找不到，可透過面板位置（如畫面左側寬度介於 `250px~400px` 的固定定位容器）動態標記 `data-mygmap-role="layer-panel"`。
  4. **開啟除錯模式**：Debug 建置下務必啟用 `WebView.setWebContentsDebuggingEnabled(true)`，並提供內建的簡易 DOM 屬性檢查 Log。

### 3.3 手機版 CSS 改造與「原生模式逃生門 (CSS Bypass)」
- **改造重點**：
  - 注入 `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`。
  - 左側圖層面板 (`#featurelist-pane` 或標記為 `layer-panel` 的容器) 預設透過 CSS class (如 `body.mygmap-drawer-closed`) 隱藏或收合至畫面左側外 (`transform: translateX(-105%)`)，點擊原生底部工具列的「🗂️ 圖層」時切換 `body.mygmap-drawer-open`，以抽屜或底部面板形式浮出。
  - **逃生門機制**：部分官方彈窗（如「共用設定」、「匯入 KML 檔案」對話框）在自訂 CSS 下可能排版跑掉。因此必須實作一個「切換原始桌面排版 / 手機優化排版」的開關，隨時可動態移除或掛載自訂 CSS。

---

## 4. 專案目錄結構規劃

```text
MyGMap_guiter/
├── PROJECT_PLAN.md                  # 本規劃與 AI 交接文件
├── app/
│   ├── src/main/
│   │   ├── AndroidManifest.xml      # 網路、定位權限設定
│   │   ├── assets/
│   │   │   ├── inject_style.css     # 手機版響應式改造與抽屜化 CSS
│   │   │   └── inject_script.js     # DOM 搜尋器、事件觸發器、MutationObserver 自動化腳本
│   │   └── java/com/guiterevent/mygmap/
│   │       ├── MainActivity.kt
│   │       ├── ui/
│   │       │   ├── MyMapScreen.kt         # 主畫面 (WebView + 頂部狀態列 + 底部原生工具列)
│   │       │   ├── BottomActionBar.kt     # 單手操作底部工具列元件
│   │       │   └── QuickPinDialog.kt      # 快速新增目前 GPS 位置/搜尋地點對話框
│   │       ├── webview/
│   │       │   ├── MyMapWebViewClient.kt  # 處理動態 UA、Cookie flush、資源注入時機
│   │       │   ├── MyMapJsBridge.kt       # @JavascriptInterface 雙向通訊橋樑
│   │       │   └── WebViewInjector.kt     # 讀取 assets 並執行 evaluateJavascript
│   │       └── location/
│   │           └── LocationHelper.kt      # 取得手機即時高精準度 GPS 座標
```

---

## 5. 五階段開發藍圖與進度追蹤 (Implementation Phases)

- [x] **Phase 1：Android 專案初始化、WebView 偽裝與 Google 登入突破**
  - 建立 Gradle 專案結構與 Jetpack Compose 基礎畫面。
  - 實作 `MyMapWebViewClient`，配置動態 User-Agent 與第三方 Cookie 持久化。
  - 驗證可成功登入 Google 帳號並進入 `https://www.google.com/maps/d/` 看到個人地圖清單與進入地圖編輯頁。
- [x] **Phase 2：JS Bridge 架構、DOM 探測模式與 CSS 手機版響應式改造**
  - 建立 `assets/inject_style.css` 與 `assets/inject_script.js`。
  - 實作 `MyMapJsBridge` 雙向通訊（網頁狀態回報給 Android、Android 呼叫 JS 函式）。
  - 實作左側圖層面板抽屜化（可展開/收合，預設收合以全螢幕顯示地圖）與「原始排版/手機優化排版」切換開關。
  - 實作開發者 DOM 探測工具（開啟時點擊網頁元素可在 Logcat 或 Toast 顯示其 `id`, `class`, `aria-label`，方便微調 Selector）。
- [x] **Phase 3：原生底部工具列 (Native Bottom Action Bar) 與高頻編輯動作串接**
  - 實作底部原生按鈕列：「🗂️ 圖層面板」、「🔍 搜尋地點」、「📌 新增標記」、「🏠 地圖列表」、「⚙️ 更多/切換排版」。
  - 串接「🔍 搜尋地點」：支援透過原生 Dialog 輸入關鍵字，由 JS 自動填入 `#mapsprosearch-field` 並觸發搜尋，以及一鍵點擊「新增至地圖 (`#addtomap-button`)」。
  - 串接「📌 新增標記」：由 JS 自動點擊網頁上的新增圖釘工具按鈕，並透過 Toast/狀態列提示使用者「請點擊地圖任意處放置圖釘」。
- [x] **Phase 4：殺手級行動功能 ——「📍 一鍵新增目前 GPS 位置」自動化工作流**
  - 實作 `LocationHelper` 與 Android 定位權限請求 (`ACCESS_FINE_LOCATION`)。
  - 在底部工具列或懸浮按鈕 (FAB) 加入「📍 標記目前位置」。
  - 實作自動化打卡流程：取得手機 `(lat, lng)` -> 彈出原生對話框讓使用者輸入「地點名稱」與「備註」 -> 透過 `inject_script.js` 使用 `MutationObserver` 自動完成「填入座標搜尋 -> 等待搜尋結果圖釘出現 -> 點擊『新增至地圖』 -> 自動填入自訂名稱與備註並儲存」。
- [x] **Phase 5：進階體驗優化（跳轉 Google Maps 導航、KML/KMZ 匯出下載、離線防呆與打包）**
  - 新增「🗺️ 在 Google Maps 開啟」功能，透過 Intent 喚起手機內的官方 Google Maps App。
  - 實作 WebView `DownloadListener`，支援匯出 KML/KMZ 檔案至手機下載目錄。
  - 加入網路斷線提示、重新整理按鈕與完整 APK 編譯測試 (`./gradlew assembleDebug`)。
- [x] **Phase 6：WebView 三大致命坑洞全面加固（純桌面版 UA 強制統一、重啟白屏/Session 防護、WebChromeClient Geolocation 授權回呼）**
  - **坑洞 1 防護（杜絕 `403 disallowed_useragent` 與登入跳轉中斷）**：強制將 `WebView` 的 `userAgentString` 全程完整替換為純桌面版 Chrome 字串 (`DESKTOP_CHROME_UA`)，徹底移除 `; wv` 並避免因中途切換 UA 重新 `loadUrl` 造成 OAuth 重導向或 Session 異常。
  - **坑洞 2 防護（防止重啟 App 後登入狀態遺失、頁面變白）**：確保 `javaScriptEnabled = true`、`domStorageEnabled = true`、`databaseEnabled = true`，透過 `CookieManager` 啟用 `setAcceptCookie(true)` 與 `setAcceptThirdPartyCookies(webView, true)`，並加入重啟/前景恢復時的白屏偵測與 `onRenderProcessGone` 自動恢復機制。
  - **坑洞 3 防護（確保網頁內 HTML5 定位按鈕能順利取得手機 GPS）**：啟用 `webView.settings.setGeolocationEnabled(true)`，並在 `WebChromeClient` 覆寫 `onGeolocationPermissionsShowPrompt(origin, callback)`，自動結合 Android `ACCESS_FINE_LOCATION` 執行期權限檢查與授權回呼 (`callback.invoke(origin, true, false)`)。
- [x] **Phase 7：一鍵自動編譯腳本 (`build.bat`)、純開源工具鏈檢核與 APK 產出定位（嚴禁商業授權軟體）**
  - **100% 開源免費授權合規**：嚴格禁止使用具有商業授權限制的軟體工具（如 Oracle JDK `C:\Program Files\Java\...` 或商業專有軟體）；僅使用 GPLv2+CE / Apache 2.0 開源授權之 **OpenJDK**（如 Eclipse Temurin / Adoptium、Microsoft Build of OpenJDK、Amazon Corretto、Azul Zulu Community）與開源 Gradle Wrapper (`gradlew.bat`)。
  - 建立根目錄 `build.bat`，自動搜尋並驗證本機開源 OpenJDK（主動排除 Oracle JDK，若未安裝可支援自動從 Adoptium 官方開源 API 下載免安裝版 Eclipse Temurin OpenJDK 17 至專案 `.toolchain/` 目錄）與 Android SDK（自動產生 `local.properties`）。
  - 執行 `gradlew.bat assembleDebug` 完成 APK 編譯，將 APK 複製一份至根目錄 `dist\MyGMap-debug.apk`，並在終端機清楚顯示最終 APK 的完整絕對路徑、檔案大小、建立時間與開源工具鏈授權摘要。

---

## 6. AI 交接紀錄區 (AI Handover Log)

> **說明**：請每個階段負責實作的 AI 在完成任務後，於下方對應區塊填寫實作摘要。

### Phase 1 交接紀錄
- **狀態**：已完成 (`[x]`)
- **已建立/修改檔案**：
  - Gradle 與專案建置配置：
    - `settings.gradle.kts`、`build.gradle.kts` (Project 層級, AGP `8.5.2` + Kotlin `1.9.24`)、`gradle.properties`、`.gitignore`
    - `gradlew`、`gradlew.bat`、`gradle/wrapper/gradle-wrapper.properties` (Gradle `8.7`)、`gradle/wrapper/gradle-wrapper.jar`
    - `app/build.gradle.kts` (`namespace = "com.guiterevent.mygmap"`, `minSdk = 26`, `targetSdk = 34`, `compileSdk = 34`, 內含 Jetpack Compose Material 3、`material-icons-extended`、`androidx.webkit:webkit:1.11.0` 及供 Phase 4 使用的 `play-services-location:21.3.0`)
    - `app/proguard-rules.pro` (已預先保留 `@JavascriptInterface` 與 `com.guiterevent.mygmap.webview.**` 規則)
  - Android 系統宣告與資源檔：
    - `app/src/main/AndroidManifest.xml` (宣告 `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` 權限；設定 `android:usesCleartextTraffic="false"`、`android:hardwareAccelerated="true"` 與 `configChanges` 防重載；並加上 `<queries>` 宣告 `com.google.android.apps.maps` 以利 Phase 5 跳轉)
    - `app/src/main/res/values/strings.xml`、`themes.xml`、`colors.xml` 與 Adaptive Launcher Icon (`drawable/ic_launcher_*.xml`, `mipmap-anydpi-v26/ic_launcher*.xml`)
  - 核心 Kotlin 程式碼：
    - `app/src/main/java/com/guiterevent/mygmap/MainActivity.kt`：啟用 `WebView.setWebContentsDebuggingEnabled(true)` 與 `CookieManager.getInstance().setAcceptCookie(true)`，並於 `onPause()` / `onStop()` 呼叫 `MyMapWebViewClient.flushCookies()`。
    - `app/src/main/java/com/guiterevent/mygmap/webview/MyMapWebViewClient.kt`：
      - 定義目標首頁 `MY_MAPS_HOME_URL = "https://www.google.com/maps/d/"` 與桌面版 UA `DESKTOP_CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"`。
      - `buildSanitizedAuthUserAgent(rawDefaultUa)`：移除系統預設 WebView UA 中的 `; wv` 與 `Version/x.x` 標記，避免觸發 Google OAuth `403 disallowed_useragent`。
      - `applyDynamicUserAgentIfNeeded(webView, url)`：於 `shouldOverrideUrlLoading` (MainFrame) 與 `onPageStarted` 動態判斷網址是否屬於 `accounts.google.com` 等認證網域；若是則切換為 `AUTH_CLEAN_CHROME` UA，若為 `google.com/maps/d` 則強制使用 `DESKTOP_EDITOR` UA，並在 UA 變更時主動呼叫 `view.loadUrl(url)` 確保當次 Request Header 立即套用新 UA。
      - `configureWebView(webView)` 與 `flushCookies()`：啟用第一方/第三方 Cookie、`domStorageEnabled = true`、`databaseEnabled = true`、`javaScriptEnabled = true`、雙指縮放支援，並在 `onPageCommitVisible` 與 `onPageFinished` 自動 `flush()`。
    - `app/src/main/java/com/guiterevent/mygmap/ui/MyMapScreen.kt`：
      - 頂部狀態導航列 (`TopStatusHeader`) 顯示網頁標題、動態 UA 模式徽章 (`🔐 OAuth 登入模式` / `🖥️ 桌面編輯核心`)、返回、回到地圖列表首頁、重新整理按鈕。
      - 頂部細長載入進度條 (`LinearProgressIndicator`) 串接 `WebChromeClient.onProgressChanged`。
      - 整合 Compose `BackHandler`（`webView.canGoBack()` 為 `true` 時返回上一頁，否則彈出退出確認對話框）與 `LifecycleEventObserver`（於 `ON_PAUSE` / `ON_STOP` 自動 flush cookies）。
  - 單元測試：
    - `app/src/test/java/com/guiterevent/mygmap/UserAgentStrategyTest.kt`：驗證 `; wv` 與 `Version/4.0` 標記移除邏輯。
- **驗證結果與注意事項**：
  - 所有 Kotlin 套件結構 (`com.guiterevent.mygmap`)、Import、Manifest 與 Gradle 配置皆已完整建立並檢查無誤（本機環境目前未安裝 JDK / Android SDK CLI，因此未執行命令列 `./gradlew`，可直接以 Android Studio 開啟編譯）。
  - **給 Phase 2 AI 的交接提示**：
    - 在 Phase 2 實作 `WebViewInjector.kt` 與 `MyMapJsBridge.kt` 時，可於 `MyMapScreen.kt` 的 `AndroidView(factory = ...)` 中掛載 `addJavascriptInterface(jsBridge, "AndroidBridge")`，並於 `MyMapWebViewClient.onPageCommitVisible` 與 `onPageFinished`（當 `!isGoogleAuthUrl(url)` 時）呼叫 `WebViewInjector` 注入 `assets/inject_style.css` 與 `assets/inject_script.js`。

### Phase 2 交接紀錄
- **狀態**：已完成 (`[x]`)
- **已建立/修改檔案**：
  - 模組化注入資源：
    - `app/src/main/assets/inject_style.css`：實作行動版響應式重構樣式、左側圖層面板抽屜化 (`body.mygmap-drawer-closed` / `body.mygmap-drawer-open`)、半透明點擊收合遮罩 (`#mygmap-drawer-backdrop`)、觸控熱區放大 (`44px~48px`)、DOM 探測高亮框 (`[data-mygmap-inspected="true"]`)，並將所有行動版改造樣式嚴格限定於 `body.mygmap-mobile-mode` 下以提供「CSS Bypass 逃生門」。
    - `app/src/main/assets/inject_script.js`：實作 `window.MyGMapHelper` 命名空間，包含強制覆寫 `<meta name="viewport">`、多重容錯 DOM 搜尋器 (`findElement`)、自動標記 `data-mygmap-role` (`scanAndTagDom` + `MutationObserver`)、頁面模式偵測 (`isEditorPage`)、抽屜/排版切換 API 與 Capture 階段攔截的開發者 DOM 探測工具。
  - WebView 通訊與注入管理層：
    - `app/src/main/java/com/guiterevent/mygmap/webview/WebViewInjector.kt`：從 `assets/` 讀取並快取 `inject_style.css` 與 `inject_script.js`，於非 OAuth 頁面動態注入 `<style id="mygmap-injected-style">` 與腳本，並封裝 `setMobileMode`、`setDrawerOpen`、`toggleDrawer`、`setInspectMode`、`triggerEditorAction` 等呼叫介面。
    - `app/src/main/java/com/guiterevent/mygmap/webview/MyMapJsBridge.kt`：實作掛載名稱為 `AndroidBridge` 的 `@JavascriptInterface`，提供 `onPageModeChanged(isEditorPage: Boolean)`、`onDomInspected(infoJson: String)`、`onDrawerStateChanged(isOpen: Boolean)`、`onMobileModeChanged(isMobileMode: Boolean)`，並統一透過 `Handler(Looper.getMainLooper())` 切換回主執行緒更新 Compose UI，內建 `DomInspectInfo` 解析器。
    - `app/src/main/java/com/guiterevent/mygmap/webview/MyMapWebViewClient.kt`：新增 `onPageReadyForInjection` 回呼，於 `onPageCommitVisible` 與 `onPageFinished`（當 `!isGoogleAuthUrl(url)` 時）自動觸發 `WebViewInjector.injectAll(...)`。
  - UI 整合與單元測試：
    - `app/src/main/java/com/guiterevent/mygmap/ui/MyMapScreen.kt`：掛載 `AndroidBridge`，於頂部狀態列顯示 `🗺️ 地圖編輯頁` / `📋 地圖列表頁` 徽章，並新增 `Phase2ControlStrip`（包含「🗂️ 展開/收合圖層抽屜」、「📱 手機優化排版 / 🖥️ 原始桌面排版 (逃生門)」、「🎯 DOM 探測」）與 `DomInspectBanner` 頂部除錯橫幅及詳情對話框（支援一鍵複製 Selector / JSON 至剪貼簿）。
    - `app/src/test/java/com/guiterevent/mygmap/JsBridgeAndAssetsTest.kt`：驗證 `MyMapJsBridge.parseDomInspectInfo` 解析邏輯與 `inject_style.css` / `inject_script.js` 資產規範。
- **JS API 介面規格 (`window.MyGMapHelper` & `window.AndroidBridge`)**：
  - `window.MyGMapHelper.findElement(strategyOrKey)`：支援傳入預設 key (`'layerPanel'`, `'searchInput'`, `'searchButton'`, `'addToMapButton'`, `'selectTool'`, `'addMarkerTool'`, `'drawLineTool'`, `'directionsTool'`, `'measureTool'`) 或自訂規則物件。
  - `window.MyGMapHelper.setDrawerOpen(open)` / `toggleDrawer()`：切換 `body.mygmap-drawer-open` 與 `body.mygmap-drawer-closed`（抽屜寬度 `85vw`、最大 `340px`、`z-index: 9990`，收合時 `transform: translateX(-105%)`），並顯示/隱藏 `#mygmap-drawer-backdrop`。
  - `window.MyGMapHelper.setMobileMode(enabled)` / `toggleMobileMode()`：切換 `body.mygmap-mobile-mode`（`false` 時移除所有自訂樣式，恢復桌面原始排版）。
  - `window.MyGMapHelper.setInspectMode(enabled)` / `toggleInspectMode()`：切換 `body.mygmap-inspect-mode` 開發者 DOM 探測模式。
  - `window.MyGMapHelper.triggerAction(targetKey)`：使用完整 `mouseover -> mousedown -> mouseup -> click` 序列觸發 Google Closure Library 工具按鈕（供 Phase 3 直接呼叫）。
- **實際驗證有效的 DOM Selectors 與容錯順序**：
  1. **固定 ID**：`#mapsprosearch-field` (搜尋框)、`#mapsprosearch-button` (搜尋按鈕)、`#addtomap-button` (新增至地圖)、`#featurelist-pane` (左側圖層面板)。
  2. **語意屬性 (`aria-label` / `data-tooltip` / `title` / `placeholder`)**：
     - 新增標記：`[aria-label*="新增標記"]`, `[aria-label*="Add marker"]`, `[data-tooltip*="新增標記"]`, `[data-tooltip*="Add marker"]`
     - 選取項目：`[aria-label*="選取項目"]`, `[aria-label*="Select items"]`
     - 繪製線條：`[aria-label*="繪製線條"]`, `[aria-label*="Draw a line"]`
  3. **結構啟發式搜尋 (`findLayerPanelByHeuristic`)**：自動尋找包裹 `#featurelist-pane` 的左側外框或畫面左側固定寬度 (`200px~450px`) 容器並標記 `data-mygmap-role="layer-panel"`。
- **驗證結果與注意事項**：
  - **給 Phase 3 AI 的交接提示**：
    - `window.MyGMapHelper.triggerAction(targetKey)` 已實作 Closure Library 相容的 `MouseEvent` 序列（`mouseover`, `mousedown`, `mouseup`, `click`），Phase 3 建立 `BottomActionBar.kt` 時可直接呼叫 `WebViewInjector.triggerEditorAction(webView, "addMarkerTool")`、`WebViewInjector.toggleDrawer(webView)` 等方法，並在 `inject_script.js` 擴充搜尋關鍵字自動填入與觸發函式。

### Phase 3 交接紀錄
- **狀態**：已完成 (`[x]`)
- **已建立/修改檔案**：
  - 原生底部工具列與高頻操作 UI 元件：
    - `app/src/main/java/com/guiterevent/mygmap/ui/BottomActionBar.kt`：
      - `BottomActionBar`：設計單手操作友善的 Material 3 原生底部控制列（所有按鈕觸控熱區至少 `48dp x 52dp`），整合五大按鈕：
        1. **🗂️ 圖層 (`Layers`)**：點擊呼叫 `window.MyGMapHelper.toggleLayerDrawer()`，展開/收合左側圖層抽屜並同步更新按鈕高亮狀態 (`isDrawerOpen`)。
        2. **🔍 搜尋 (`Search`)**：點擊彈出 `QuickSearchDialog` 原生快速搜尋對話框，支援手機鍵盤 `ImeAction.Search` 直接送出搜尋。
        3. **📌 插針 (`Add Marker`)**：點擊呼叫 `window.MyGMapHelper.activateAddMarkerTool()` 啟動插針工具並高亮顯示；再次點擊可切回手型選取/平移模式。
        4. **🏠 列表 (`Home`)**：快速返回 `https://www.google.com/maps/d/` 地圖總覽頁。
        5. **⚙️ 模式 (`More / Mode`)**：展開 Material 3 `DropdownMenu`（每個項目高度 `>= 48dp`），支援切換「📱 手機優化排版 / 🖥️ 原始桌面排版 (`toggleMobileCssMode()`)」、開關「🔍 DOM 探測除錯模式 (`setInspectMode(enabled)`)」、觸發「↩️ 復原 (`triggerUndo()`)」、「↪️ 重做 (`triggerRedo()`)」與切換回「🖐️ 手型選取/平移模式 (`activatePanTool()`)」。
      - `AddMarkerModeBanner`：當插針模式啟動時，於頂部顯示醒目琥珀色橫幅「📌 插針模式已啟動：請點擊地圖任意位置放置圖釘」，並提供一鍵切換回「🖐️ 手型選取/平移」的快捷按鈕。
      - `SearchAddToMapFloatingBar`：於搜尋完成後浮動顯示於底部工具列上方，提供大尺寸「➕ 加入地圖 (`clickAddToMap()`)」按鈕、點擊關鍵字重新搜尋與關閉按鈕。
      - `QuickSearchDialog`：原生搜尋地點對話框，內建自動對焦輸入框、清除按鈕與「➕ 直接將目前搜尋結果加入地圖」快捷動作。
    - `app/src/main/java/com/guiterevent/mygmap/ui/MyMapScreen.kt`：
      - 於 `Scaffold(bottomBar = ...)` 整合 `BottomActionBar`，於 `topBar` 整合 `AddMarkerModeBanner`，並於地圖畫布底部疊加 `SearchAddToMapFloatingBar`。
      - 強化 `BackHandler` 返回鍵優先序：收合圖層抽屜 -> 退出插針模式並切回手型平移工具 -> WebView 返回上一頁 -> 退出確認對話框。
  - JS 橋接與 Closure Library 事件強化：
    - `app/src/main/assets/inject_script.js`：
      - 實作 `window.MyGMapHelper.simulateClick(element)`：依序派發完整的指標與滑鼠事件序列 `['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']`（皆設定 `bubbles: true, cancelable: true, view: window` 及元素中心座標 `clientX`/`clientY`），確保 Google Closure Library 頂部工具列與「新增至地圖」100% 可被觸發。
      - 新增/封裝 Phase 3 公開方法：`toggleLayerDrawer()`、`searchPlace(query)`（透過 `HTMLInputElement.prototype.value` setter 寫入 `#mapsprosearch-field`、派發 `input`/`change` 與 `Enter` 鍵事件並點擊 `#mapsprosearch-button`）、`clickAddToMap()`、`activateAddMarkerTool()`、`activatePanTool()`、`toggleMobileCssMode()`、`triggerUndo()`、`triggerRedo()`。
      - 新增 `undoTool` (`[aria-label*="復原"]` / `[aria-label*="Undo"]`) 與 `redoTool` (`[aria-label*="重做"]` / `[aria-label*="Redo"]`) 選擇器與鍵盤 `Ctrl+Z` / `Ctrl+Y` 備援。
    - `app/src/main/java/com/guiterevent/mygmap/webview/WebViewInjector.kt`：新增 `toggleLayerDrawer`、`searchPlace`、`clickAddToMap`、`activateAddMarkerTool`、`activatePanTool`、`toggleMobileCssMode`、`triggerUndo`、`triggerRedo` 等包裝函式。
    - `app/src/main/java/com/guiterevent/mygmap/webview/MyMapJsBridge.kt`：新增 `@JavascriptInterface fun onInspectModeChanged(isInspectMode: Boolean)` 與 `@JavascriptInterface fun onActiveToolChanged(toolName: String)` 雙向狀態同步回呼。
    - `app/src/test/java/com/guiterevent/mygmap/JsBridgeAndAssetsTest.kt`：擴充驗證 Phase 3 所有 JS Helper API 與 `simulateClick` 事件序列。
- **驗證結果與注意事項**：
  - 已透過 `node --check app/src/main/assets/inject_script.js` 驗證 JS 腳本語法 100% 正確無誤，並確認所有 Kotlin 檔案結構與型別相容。
  - **給 Phase 4 AI 的交接提示**：
    - Phase 4 實作「📍 一鍵新增目前 GPS 位置」時，可直接使用 `LocationHelper.kt` 取得 `(lat, lng)` 並彈出 `QuickPinDialog.kt` 讓使用者輸入自訂名稱與備註，接著在 `inject_script.js` 結合 `window.MyGMapHelper.searchPlace(lat + ", " + lng)`、`MutationObserver` 監聽 `#addtomap-button` 出現後自動呼叫 `window.MyGMapHelper.clickAddToMap()`，再自動填入資訊氣泡的標題/說明欄位並儲存。

### Phase 4 交接紀錄
- **狀態**：已完成 (`[x]`)
- **已建立/修改檔案**：
  - Android 原生高精準度定位模組：
    - `app/src/main/java/com/guiterevent/mygmap/location/LocationHelper.kt`：
      - 封裝 `GpsCoordinates(latitude, longitude, accuracyMeters, provider)`（含 `formatLatLng(6)` 與 `formatAccuracySummary()`）與 `LocationFetchResult` (`Success` / `PermissionDenied` / `LocationServicesDisabled` / `Error`)。
      - 提供 `REQUIRED_PERMISSIONS` (`ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`)、`hasLocationPermission(context)`、`isLocationEnabled(context)`、`parseCoordinateString(rawText)`、`buildDefaultPinTitle()`（預設 `"GPS 標記 (HH:mm)"`）與 `buildClipboardFallbackText(title, description)`（格式 `"標題 - 備註"`）。
      - `fetchCurrentLocation(context, timeoutMs = 9_000L, onResult)`：結合 Google Play Services `FusedLocationProviderClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cancellationToken)` 與原生 `LocationManager` (`GPS_PROVIDER` / `NETWORK_PROVIDER` 即時監聽 + `lastKnownLocation` 快取候選) 平行備援，確保室內外皆能快速取得座標，並透過 `AtomicBoolean` 與 `CancellationTokenSource` 防止重複回呼或洩漏。
  - 快速新增 GPS 位置原生對話框與主畫面整合：
    - `app/src/main/java/com/guiterevent/mygmap/ui/QuickPinDialog.kt`：
      - `QuickPinDialog`：顯示目前取得的經緯度座標與精準度來源，支援「📋 複製」、「🔄 重抓 GPS」與直接手動微調座標（含即時格式驗證）；提供「📌 地點名稱（標題）」（留空預設帶入 `"GPS 標記 (HH:mm)"`）與「📝 備註說明」輸入框，以及兩個核心動作按鈕：
        1. **「🔍 僅定位搜尋」**：將 `"lat, lng"` 填入 `#mapsprosearch-field` 並縮放地圖至目前位置。
        2. **「📍 一鍵加入我的地圖 (自動命名儲存)」**：啟動 JS `addGpsPinToMap(lat, lng, title, description)` 自動化打卡狀態機。
      - `LocationGuideDialog`：當定位權限遭拒或系統未開啟 GPS 時，提供「重新授權」、「前往權限設定」、「開啟系統定位」及「✏️ 直接手動輸入/貼上經緯度標記」保底入口。
      - `GpsPinAutomationBanner`：於頂部即時顯示 JS 自動化打卡狀態機 (`STEP_1_SEARCH` -> `STEP_2_ADD_TO_MAP` -> `STEP_3_FILL_AND_SAVE` -> `COMPLETED` / `FALLBACK_CLIPBOARD`) 的進度與結果。
    - `app/src/main/java/com/guiterevent/mygmap/ui/MyMapScreen.kt`：
      - 使用 `rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions())` 整合執行期定位權限請求。
      - 於 `Scaffold(floatingActionButton = ...)` 右下方配置醒目的 `ExtendedFloatingActionButton`（「📍 標記目前位置」，定位期間顯示 `CircularProgressIndicator` 與「📡 GPS 定位中…」）。
      - 串接 `MyMapJsBridge.onGpsPinStatusCallback`：當收到 `fallbackUsed == true` 時，自動將 `"標題 - 備註"` 複製到系統 `ClipboardManager` 並以 Toast 提示使用者可直接長按氣泡窗貼上。
  - JS 自動化打卡狀態機與橋接擴充：
    - `app/src/main/assets/inject_script.js`：
      - 實作 `window.MyGMapHelper.addGpsPinToMap(lat, lng, title, description)` 與 `cancelActiveGpsPinTask()`，使用 `MutationObserver` 搭配 `200ms` 輪詢與階段性 timeout 防呆：
        - **Step 1 (`STEP_1_SEARCH`)**：透過 `ensureActiveLayerAvailable()` 檢查 `#featurelist-pane` 是否已有選取中的圖層（若無則自動模擬點擊第一個圖層標題區域），再將 `"lat, lng"` 寫入 `#mapsprosearch-field` 並觸發搜尋。
        - **Step 2 (`STEP_2_ADD_TO_MAP`)**：監聽 DOM 等待搜尋結果綠十字與 `#addtomap-button`（或含 `"新增至地圖"` / `"Add to map"` 的按鈕）出現，立即呼叫 `simulateClick()` 將座標加入當前圖層。
        - **Step 3 (`STEP_3_FILL_AND_SAVE`)**：等待圖釘資訊氣泡窗 (`#map-infowindow-container`) 展開；若氣泡窗處於檢視模式則先自動點擊 `#map-infowindow-edit-button`（編輯鉛筆按鈕），接著尋找標題欄位（`#map-infowindow-attr-名稱-value`、`#map-infowindow-attr-name-value` 或第一個 `[id^="map-infowindow-attr-"][id$="-value"]`）與說明欄位（`#map-infowindow-attr-說明-value`、`#map-infowindow-attr-description-value` 或第二個屬性欄位），透過 `setEditableElementValue()` 寫入 `title` 與 `description`（相容 `input`/`textarea` 與 `contenteditable="true"`），最後自動模擬點擊 `#map-infowindow-done-editing-button`（「儲存 / Save」）按鈕完成儲存！
        - **容錯保底 (`FALLBACK_CLIPBOARD`)**：若因語系或自訂圖層欄位差異未能自動填入文字，確保圖釘已加入地圖並透過 `AndroidBridge.onGpsPinStatus(json)` 觸發 Android 端自動複製 `"標題 - 備註"` 至剪貼簿。
    - `app/src/main/assets/inject_style.css`：新增 `#map-infowindow-container`、屬性編輯欄位與 `#map-infowindow-done-editing-button` / `#map-infowindow-edit-button` 在 `body.mygmap-mobile-mode` 下的行動版觸控熱區優化。
    - `app/src/main/java/com/guiterevent/mygmap/webview/MyMapJsBridge.kt` & `WebViewInjector.kt`：新增 `GpsPinStatusInfo`、`parseGpsPinStatusInfo`、`@JavascriptInterface fun onGpsPinStatus(statusJson: String)` 與 `WebViewInjector.addGpsPinToMap(...)`。
  - 單元測試：
    - `app/src/test/java/com/guiterevent/mygmap/LocationHelperTest.kt`：驗證經緯度格式化、座標解析與驗證、預設標題與剪貼簿保底文字格式。
    - `app/src/test/java/com/guiterevent/mygmap/JsBridgeAndAssetsTest.kt`：擴充驗證 `parseGpsPinStatusInfo` 與 Phase 4 JS 狀態機選擇器。
- **驗證結果與注意事項**：
  - 已透過 `node --check app/src/main/assets/inject_script.js` 驗證 JS 語法 100% 正確無誤。
  - **給 Phase 5 AI 的交接提示**：
    - `LocationHelper` 與 `currentGpsCoordinates` 已整合於 `MyMapScreen.kt`，Phase 5 實作「🗺️ 在 Google Maps 開啟」時，可結合目前地圖網址或最新搜尋/定位座標透過 `Intent(Intent.ACTION_VIEW, Uri.parse(...))` 喚起 `com.google.android.apps.maps`，並在 `MyMapScreen.kt` 的 `WebView` 掛載 `setDownloadListener` 處理 KML/KMZ 匯出下載。

### Phase 5 交接紀錄
- **狀態**：已完成 (`[x]`)
- **已建立/修改檔案**：
  - 官方 Google Maps App 跳轉與 KML/KMZ 匯出下載核心模組：
    - `app/src/main/java/com/guiterevent/mygmap/webview/MapExportAndIntentHelper.kt`：
      - 封裝 `MapNavigationContext` 與 `GoogleMapsLaunchMode` (`SMART_OPEN` / `MAP_VIEWER_BY_MID` / `NAVIGATION` / `STREET_VIEW` / `PLACE_PIN`)。
      - 實作 `extractMidFromUrl(url)`、`extractLatLngFromUrl(url)`（支援 `ll=`、`sll=`、`cbll=`、`viewpoint=` 與 `@lat,lng`）、`extractLatLngFromText(text)` 與 `parseNavigationContextJson(...)`。
      - 實作 `launchGoogleMapsApp(...)`：優先以 `Intent(Intent.ACTION_VIEW, Uri.parse(...)).setPackage("com.google.android.apps.maps")` 喚起官方 Google Maps App 進行路線導航 (`google.navigation:q=...`)、查看 360° 街景 (`google.streetview:cbll=...`)、標示圖釘 (`geo:...`) 或載入雲端地圖 (`https://www.google.com/maps/d/viewer?mid=...`)；若未安裝則自動降級以外部瀏覽器開啟對應 HTTPS 網址。
      - 實作 `handleWebViewDownload(...)`、`parseFileNameFromContentDisposition(...)`（支援 RFC 5987 `filename*=UTF-8''...` 與引號格式）、`isKmlFormat(...)` 與 `resolveDownloadFileName(...)`：同步讀取 `CookieManager.getInstance().getCookie(url)` 與 `User-Agent`，建立 `DownloadManager.Request` 將匯出之 `.kmz` / `.kml` 儲存至 `Environment.DIRECTORY_DOWNLOADS`，並以 Toast 通知使用者下載已開始。
  - JS 導航資訊提取與觸控手勢防衝突強化：
    - `app/src/main/assets/inject_script.js`：
      - 新增 `window.MyGMapHelper.extractNavigationContext()`：自動提取目前網址的 `mid` 與 `ll` 地圖中心座標、目前展開氣泡窗 (`#map-infowindow-container`) 的圖釘標題與座標，以及搜尋框 (`#mapsprosearch-field`) 的文字與座標。
      - 於 `#mygmap-drawer-backdrop` 加入左滑關閉抽屜手勢監聽，並於 `scanAndTagDom()` 自動標記 `data-mygmap-role="map-canvas"`。
    - `app/src/main/assets/inject_style.css`：
      - 為地圖畫布 (`#map-canvas` / `#lyra-canvas`) 加入 `touch-action: none !important; overscroll-behavior: none !important; user-select: none !important;`，防止雙指縮放與平移時觸發網頁文字選取或彈性回彈。
      - 為左側抽屜加入 `overscroll-behavior: contain !important; -webkit-overflow-scrolling: touch !important; touch-action: pan-y !important;`，並於收合狀態強制 `visibility: hidden !important; pointer-events: none !important;`，徹底杜絕收合時攔截左側邊緣手勢。
    - `app/src/main/java/com/guiterevent/mygmap/webview/WebViewInjector.kt`：新增 `extractNavigationContext(webView, onResult)`。
  - UI 整合、手勢防衝突、離線防呆與生命週期清理：
    - `app/src/main/java/com/guiterevent/mygmap/ui/BottomActionBar.kt`：
      - 於底部「⚙️ 模式」選單新增「🗺️ 在 Google Maps App 開啟」與「📥 匯出為 KML / KMZ 檔案」項目。
      - 新增 `OpenInGoogleMapsDialog`：即時顯示自動提取到的 `mid`、選取圖釘標題與偵測座標（可手動微調），提供一鍵啟動「🧭 Google Maps 路線導航」、「🏙️ Google Maps 查看 360° 街景」、「📍 在 Google Maps 標示此座標/地點」、「🗺️ 在 Google Maps 載入整張地圖 (`mid`)」及「匯出 `.KMZ` / `.KML`」快捷按鈕。
    - `app/src/main/java/com/guiterevent/mygmap/ui/MyMapScreen.kt` & `MyMapWebViewClient.kt` & `MainActivity.kt`：
      - 於頂部 `TopStatusHeader` 新增「🗺️ 在 Google Maps App 開啟」快捷按鈕。
      - 於 `WebView` 註冊 `setDownloadListener`、設定 `overScrollMode = View.OVER_SCROLL_NEVER`、透過 `setOnTouchListener` 在 `ACTION_DOWN` / `ACTION_POINTER_DOWN` / `ACTION_MOVE` 呼叫 `requestDisallowInterceptTouchEvent(true)` 保護雙指縮放，並透過 `ViewCompat.setSystemGestureExclusionRects` 保護畫面中段地圖邊緣拖曳區。
      - 新增 `ConnectivityManager.NetworkCallback` 即時監測離線狀態，顯示離線防呆與重試面板（網路恢復時自動重載錯誤頁面）。
      - 於 `DisposableEffect` 的 `onDispose` 完整清理 `NetworkCallback`、`LifecycleEventObserver`、取消執行中 JS 任務、flush cookies、移除 `JavascriptInterface` 並呼叫 `webView.destroy()` 確保零記憶體洩漏。
    - `app/src/main/AndroidManifest.xml` & `app/src/main/res/values/strings.xml`：補充 `WRITE_EXTERNAL_STORAGE (maxSdkVersion=28)` 與 `google.navigation` / `google.streetview` / `https` `<queries>` 宣告。
  - 專案說明文件與單元測試：
    - `README.md`：完整說明專案功能亮點、如何使用 Android Studio 開啟與編譯 APK，以及手機版專屬功能操作指南。
    - `app/src/test/java/com/guiterevent/mygmap/MapExportAndIntentHelperTest.kt` & `JsBridgeAndAssetsTest.kt`：驗證 `mid` 與 `ll` 提取、導航/街景 URI 建構、RFC 5987 UTF-8 `Content-Disposition` 檔名解析與 `.kmz` / `.kml` 副檔名保證邏輯。
- **最終架構總結與驗收清單 (Acceptance Checklist)**：
  - [x] **Phase 1 — 登入突破與 Cookie 持久化**：動態 UA 淨化 `; wv` 與 `Version/4.0`、第三方 Cookie 開啟與生命週期自動 `flush()`。
  - [x] **Phase 2 — 模組化注入與響應式抽屜**：`assets/inject_style.css` 與 `assets/inject_script.js` 獨立維護、左側圖層抽屜化、`body.mygmap-mobile-mode` CSS Bypass 逃生門與 DOM 探測工具。
  - [x] **Phase 3 — 單手操作底部工具列**：`BottomActionBar` 五大高頻按鈕 (`>= 48dp`)、Closure Library 相容 `simulateClick` 事件序列、原生快速搜尋與「➕ 加入地圖」浮動列。
  - [x] **Phase 4 — 一鍵新增目前 GPS 位置**：`FusedLocationProviderClient` + `LocationManager` 雙重備援定位、`QuickPinDialog` 原生對話框與 JS `MutationObserver` 三階段自動打卡狀態機（含剪貼簿保底）。
  - [x] **Phase 5 — 外部導航跳轉、KML/KMZ 下載、手勢防衝突與離線防呆**：
    - [x] 從網址提取 `mid` / `ll` 及從網頁提取選取圖釘/搜尋框座標，一鍵喚起 `com.google.android.apps.maps` 導航或查看街景（未安裝時降級外部瀏覽器）。
    - [x] `WebView.setDownloadListener` 同步帶入 Cookie 與 UA，解析 `Content-Disposition` 並以 `DownloadManager` 下載 `.kmz` / `.kml` 至 `Environment.DIRECTORY_DOWNLOADS`。
    - [x] 觸控與邊緣手勢防衝突、即時離線偵測防呆橫幅、WebView 生命週期零洩漏清理與根目錄 `README.md` 撰寫完成。

### Phase 6 交接紀錄
- **狀態**：已完成 (`[x]`)
- **已建立/修改檔案**：
  - `app/src/main/java/com/guiterevent/mygmap/webview/MyMapWebViewClient.kt`：
    - **坑洞 1 防護（杜絕 Google OAuth `403 disallowed_useragent` 與重定向 Session 中斷）**：
      - 於 `configureWebView(webView)`、新增之 `resolveUserAgentForUrl(url)` 與 `enforceDesktopUserAgent(webView, url)` 中，將 `WebView.settings.userAgentString` **全程強制且一致地設定為純桌面版 Chrome 字串** (`DESKTOP_CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"`)，確保全程絕不出現 `; wv` 或 `Version/4.0` 字樣。
      - 移除 `shouldOverrideUrlLoading` 中因切換 UA 而呼叫 `view.loadUrl(url)` 的強制重載行為，避免打斷 Google OAuth 登入的 POST 表單提交與 302 Redirect Cookie 鏈，確保登入完成後順暢跳回 `https://www.google.com/maps/d/`。
    - **坑洞 2 防護（防止重啟 App 後登入狀態遺失、頁面變白）**：
      - 於 `configureWebView(webView)` 明確啟用 `javaScriptEnabled = true`、`domStorageEnabled = true`、`databaseEnabled = true`，以及 `CookieManager.getInstance().setAcceptCookie(true)` 與 `setAcceptThirdPartyCookies(webView, true)`。
      - 實作 `isBlankOrInvalidUrl(url)` 與 `resolveRecoveryUrl(currentUrl, fallbackUrl)`，並在 `onPageFinished` 加入空白頁 (`null`、空字串、`about:blank`) 自動重載 `MY_MAPS_HOME_URL` 的防呆機制（含 `2500ms` 冷卻防迴圈保護）與 `flushCookies()`。
      - 覆寫 `onRenderProcessGone(view, detail)`：當系統在背景回收 WebView 渲染程序時安全攔截（回傳 `true` 防止 App 崩潰）、持久化 Cookie 並自動重新載入目標網址。
    - **坑洞 3 防護（開啟 WebView HTML5 Geolocation 設定）**：
      - 於 `configureWebView(webView)` 明確啟用 `webView.settings.setGeolocationEnabled(true)`。
  - `app/src/main/java/com/guiterevent/mygmap/ui/MyMapScreen.kt`：
    - **坑洞 2 防護（前景恢復白屏防呆與 Cookie Flush）**：
      - 於 `Lifecycle.Event.ON_RESUME` 檢查 `webView.url` 是否為空白或 `about:blank`，並額外透過輕量 JS 檢查 `document.body` 是否為空；若偵測為白屏則自動重新載入 `resolveRecoveryUrl(currentUrl, MY_MAPS_HOME_URL)`。
      - 於 `ON_PAUSE`、`ON_STOP` 與 `onDispose` 確保執行 `CookieManager.getInstance().flush()` 與 `MyMapWebViewClient.flushCookies()`，並串接 `onRenderProcessGoneRecovered` 狀態恢復回呼。
    - **坑洞 3 防護（`WebChromeClient.onGeolocationPermissionsShowPrompt` 無縫接通手機 GPS）**：
      - 於 `WebChromeClient` 覆寫 `onGeolocationPermissionsShowPrompt(origin, callback)` 與 `onGeolocationPermissionsHidePrompt()`。
      - 若 `LocationHelper.hasLocationPermission(context)` 為 `true`（已具備 `ACCESS_FINE_LOCATION` 或 `ACCESS_COARSE_LOCATION`），立即呼叫 `callback?.invoke(origin, true, false)` 自動放行網頁內建定位請求。
      - 若尚未取得權限，暫存 `(origin, callback)` 至 `pendingGeolocationRequest` 並自動觸發 `locationPermissionLauncher.launch(LocationHelper.REQUIRED_PERMISSIONS)`；待使用者授權結果返回後自動執行 `callback?.invoke(origin, granted, false)`，同時與原生「📍 標記目前位置」按鈕的權限請求流程妥善分流。
  - `app/src/test/java/com/guiterevent/mygmap/UserAgentStrategyTest.kt`：
    - 擴充驗證 `DESKTOP_CHROME_UA` 純桌面版字串格式且不含 `; wv` / `Version/4.0`、驗證 `resolveUserAgentForUrl` 在所有 OAuth 與地圖網址下皆一致回傳 `DESKTOP_CHROME_UA`，以及驗證 `isBlankOrInvalidUrl` 與 `resolveRecoveryUrl` 白屏防呆邏輯。
- **驗證結果與注意事項**：
  - 三大坑洞防護機制皆已完整實作並通過單元測試案例檢視。
  - **給 Phase 7 AI 的交接提示**：
    - 進入 Phase 7 建立 `build.bat` 時，請確保自動偵測本機 OpenJDK（或自動下載免安裝版 Eclipse Temurin OpenJDK 17 至 `.toolchain/`）與 Android SDK，執行 `gradlew.bat testDebugUnitTest assembleDebug` 驗證單元測試與 APK 打包，並將產出的 APK 複製至 `dist\MyGMap-debug.apk`。

### Phase 7 交接紀錄
- **狀態**：已完成 (`[x]`)
- **已建立/修改檔案**：
  - `build.bat`（Windows 純開源工具鏈一鍵編譯與 APK 歸檔腳本）：
    - **100% 開源免費授權合規檢核（Step A）**：
      - 主動偵測並攔截系統預設之 `C:\ProgramData\Oracle\Java\javapath\java.exe` 或 `C:\Program Files\Java\jdk*` 等受商業條款限制的 Oracle Java 路徑，於終端機印出合規警告並拒絕使用。
      - 依序搜尋專案 `.toolchain\`、環境變數 `JAVA_HOME` 及本機已安裝之五大 100% 開源免費商用 OpenJDK 發行版（Eclipse Temurin / Adoptium、Microsoft Build of OpenJDK、Amazon Corretto、Azul Zulu Community、BellSoft Liberica）。
      - 自動讀取 `<JAVA_HOME>\release` 檔案解析 `IMPLEMENTOR`、`IMPLEMENTOR_VERSION` 與 `JAVA_VERSION`，嚴格排除 `IMPLEMENTOR="Oracle Corporation"`，並印出 GPLv2 + Classpath Exception (GPLv2+CE) 開源授權確認摘要。
      - 支援 `--bootstrap-jdk` 參數（或於本機無任何合規 OpenJDK 時自動觸發），透過內建 PowerShell 指令從 **Eclipse Adoptium 官方開源 API** (`https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse`) 自動下載免安裝版 Temurin OpenJDK 17 解壓至 `.toolchain\jdk-17`。
    - **自動偵測與配置開源 Android SDK Build-Tools（Step B）**：
      - 自動搜尋 `local.properties`、`ANDROID_HOME`、`ANDROID_SDK_ROOT`、`.toolchain\android-sdk`、`%LOCALAPPDATA%\Android\Sdk`、`C:\Android\Sdk`、`D:\Android\Sdk`、`D:\Tool\AndroidSDK` 等路徑。
      - 自動產生 Windows 路徑跳脫格式正確之 `local.properties`（如 `sdk.dir=D\:\\Tool\\AndroidSDK`），並將 `platform-tools` 加入執行期 `PATH`。
    - **執行 Apache 2.0 開源 Gradle Wrapper 編譯與 APK 歸檔定位（Step C & Step D）**：
      - 支援 `build.bat` (預設 `assembleDebug`)、`build.bat release` (`assembleRelease`)、`build.bat test` (`testDebugUnitTest`)、`build.bat check` (`testDebugUnitTest assembleDebug`)、`build.bat clean` 以及 `--no-explorer`、`--bootstrap-jdk` 選項。
      - 編譯成功後自動建立 `dist\` 目錄，將 `app\build\outputs\apk\debug\app-debug.apk` 複製歸檔為 `dist\MyGMap-debug.apk`。
      - 於終端機清楚印出編譯結果、工具鏈開源授權確認、Gradle 原始 APK 完整路徑、快捷提取 APK 完整路徑、精確檔案大小 (MB / KB / bytes) 與最後修改時間，以及 `adb install -r` 一鍵安裝提示；預設（未加 `--no-explorer` 時）自動呼叫 `explorer.exe /select,"d:\CodeBase\GuiterEvent\MyGMap_guiter\dist\MyGMap-debug.apk"` 開啟檔案總管並高亮定位該 APK。
  - 專案配置與程式碼微調修補：
    - `gradle.properties`：移除寫死之個人電腦 `org.gradle.java.home` 路徑，改由 `build.bat` 動態驗證並傳遞 `-Dorg.gradle.java.home="%JAVA_HOME%"`，確保跨設備可攜性。
    - `.gitignore`：新增忽略 `/dist/`、`dist/`、`/.toolchain/`、`.toolchain/` 與 `local.properties`。
    - `README.md`：新增「⚠️ 100% 開源免費工具鏈合規聲明」與 `build.bat` Windows 一鍵純開源編譯說明、參數範例及 APK 產出路徑對照。
    - `app/src/main/java/com/guiterevent/mygmap/ui/MyMapScreen.kt`：修正 `@SuppressLint("ClickableViewAccessibility")` 標註位置至 `@Composable fun MyMapScreen` 函式層級，確保 Kotlin 1.9.24 編譯零錯誤。
    - `app/src/main/java/com/guiterevent/mygmap/location/LocationHelper.kt` & `app/build.gradle.kts`：將 `mainHandler` 改為 `by lazy` 延遲初始化並啟用 `unitTests.isReturnDefaultValues = true`，確保純 JVM 單元測試不因 `Looper.getMainLooper()` 未 Mock 而失敗。
- **驗證結果與注意事項**：
  - **實測 `cmd /c build.bat --no-explorer`**：
    - 成功攔截系統預設 `C:\ProgramData\Oracle\Java\javapath\java.exe`，並自動選定開源 **Eclipse Adoptium (`Temurin-21.0.13+9`, GPLv2+CE)** 與 Android SDK (`D:\Tool\AndroidSDK`)。
    - 自動透過開源 Android SDK 授權安裝 `build-tools;34.0.0` 與 `platforms;android-34`，順利執行 `assembleDebug` 編譯成功 (`BUILD SUCCESSFUL`)。
    - 產出之 APK 檔案已驗證存在且完整：
      - **Gradle 原始 APK 路徑**：`d:\CodeBase\GuiterEvent\MyGMap_guiter\app\build\outputs\apk\debug\app-debug.apk`
      - **快捷提取 APK 路徑**：`d:\CodeBase\GuiterEvent\MyGMap_guiter\dist\MyGMap-debug.apk`
      - **APK 檔案大小**：`15.75 MB (16,131.9 KB / 16,519,087 bytes)`
  - **實測 `cmd /c build.bat test --no-explorer`**：
    - 全專案 16 項單元測試（含 `UserAgentStrategyTest`、`JsBridgeAndAssetsTest`、`LocationHelperTest`、`MapExportAndIntentHelperTest`）100% 通過 (`BUILD SUCCESSFUL`)。



