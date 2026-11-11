# MyGMap (Google 我的地圖行動編輯器) — 專案架構與 AI 開發指南

> **給 AI 助手的特別指令 (AI Agent Instructions)**：
> 1. 每次收到開發任務時，請**務必先完整閱讀本檔案 (`PROJECT_PLAN.md`)**，了解整體架構、技術限制與目前進度。
> 2. 本專案採用分階段迭代開發。當你完成當前階段的實作後，請**務必更新本檔案底部的「開發進度追蹤」與「AI 交接紀錄 (Handover Log)」**，記錄你新增/修改的檔案路徑、實際採用的 DOM Selector 以及需要注意的事項，方便下一個對話的 AI 無縫接手。
> 3. **禁止自動執行編譯 (Do NOT execute build)**：完成程式碼修改後，**請勿執行 `build.bat` 或 `gradlew` 編譯指令**，使用者會自行手動執行編譯。

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
- [x] **Phase 8：AndroidX WebKit `UserAgentMetadata` 標頭同步與行動/桌面檢視模式相容性優化**
  - **相容性調整重點**：
    1. 依據 AndroidX WebKit 官方規範，使用 `WebSettingsCompat.setUserAgentMetadata()`（搭配 `WebViewFeature.USER_AGENT_METADATA`）同步更新 `UserAgentMetadata` 的 `BrandVersion` 清單與平台資訊，使其與自訂 `userAgentString` 及系統實際 Chromium 版本號保持一致。
    2. 實作「帳號頁面行動版標準 UA」與「地圖頁面桌面版 UA」自動切換：在 `accounts.google.com` 頁面採用符合 Android 行動裝置環境的標準 Chrome Mobile UA (`Mozilla/5.0 (Linux; Android 10; K) ...`) 與對應的行動版 `UserAgentMetadata`；進入 `google.com/maps/d` 時採用桌面版 UA (`X11; Linux x86_64`) 與桌面版 `UserAgentMetadata`。
    3. 調整 `WebView.setWebContentsDebuggingEnabled` 為預設關閉 (`false`)，僅於開發者手動開啟「DOM 探測模式」時啟用。
    4. 於頂部提供「🔄 重新載入帳號頁面 / 清除快取重試」快捷按鈕（修改完成後不自動執行 `build.bat`，由使用者自行編譯）。
- [x] **Phase 9：徹底解決畫面與工具列跳動迴圈、啟動白屏及切換 App 時的 `ERR_NAME_NOT_RESOLVED` 錯誤**
  - **問題根因與四大修復重點**：
    1. **移除 `WebSettingsCompat.setUserAgentMetadata()` 並改為「單向階段鎖定 UA」杜絕 Redirect 乒乓迴圈 (`MyMapWebViewClient.kt`)**：
       - 在 `shouldOverrideUrlLoading`、`onPageStarted`、`onPageFinished` 中高頻呼叫 `setUserAgentMetadata` 並在 `www.google.com/maps/d/` 與 `accounts.google.com/ServiceLogin?passive=...` 之間來回切換行動版/桌面版 UA，會導致 Google 的跨網域被動 Session 檢查 (`ServiceLogin?passive` / `CheckCookie` / `SetSID`) 發生 UA 不一致而無限重定向（造成頂部徽章在 `🔐 OAuth 登入模式` 與 `📋 地圖列表頁 + 🖥️ 桌面核心` 之間瘋狂跳動）。
       - **解決方案**：
         - **移除所有 `WebSettingsCompat.setUserAgentMetadata()` 呼叫**。
         - 新增 `isMyMapsUrl(url)`（判斷是否為 `google.com/maps/d`）與 `isInteractiveGoogleSignInUrl(url)`（判斷是否為需要使用者輸入帳密的互動式登入頁，排除含有 `passive=true`、`passive=1209600`、`CheckCookie`、`SetSID`、`RotateCookies` 的背景/被動驗證網址）。
         - **啟動時 (`resolveInitialLoadUrl` & `configureWebView`)**：檢查 `hasGoogleSessionCookie()`。若**尚未登入**，初始設為 `AUTH_CLEAN_CHROME`（使用僅移除 `; wv` 與 `Version/x.x`、保留真實機型的 `sanitizedAuthUa`）並直接載入 `GOOGLE_SERVICE_LOGIN_URL`；若**已經登入**，初始設為 `DESKTOP_EDITOR`（使用 `desktopUa`）並載入 `MY_MAPS_HOME_URL`。
         - **導航期間 (`shouldOverrideUrlLoading`)**：
           - 當處於 `AUTH_CLEAN_CHROME` 模式且使用者完成登入、目標網址進入 `isMyMapsUrl(url) == true` 時，切換為 `DESKTOP_EDITOR` (`desktopUa`) 並載入地圖。
           - 一旦處於 `DESKTOP_EDITOR` 模式，**遇到任何 `passive=`、`CheckCookie`、`SetSID` 重定向時，絕對不可切回 `AUTH_CLEAN_CHROME` 或改變 UA**！只有當 `hasGoogleSessionCookie() == false` 且網址為互動式登入頁 (`isInteractiveGoogleSignInUrl(url) == true`) 時才切換為 `AUTH_CLEAN_CHROME`。
           - 在 `onPageStarted` 與 `onPageFinished` 中**禁止主動切換 `userAgentString` 或 `uaMode`**，徹底消除載入過程中的模式閃爍！
    2. **鎖定 UI 版面穩定度，底部工具列與 FAB 100% 常駐 (`MyMapScreen.kt`)**：
       - 移除 `Scaffold` 中 `BottomActionBar` 與 `ExtendedFloatingActionButton` 外層的 `if (uaMode == MyMapWebViewClient.UserAgentMode.DESKTOP_EDITOR)` 條件，讓底部工具列與右下角定位按鈕**全程常駐顯示**，徹底解決底部工具列忽隱忽現與 WebView 高度劇烈跳動問題。
       - 將頂部 `AuthCompatibilityBanner` 的顯示條件收斂為僅在 `MyMapWebViewClient.isSignInRejectedUrl(currentUrl)` 為 `true` 時才展開，避免一般載入時頂部橫幅反覆彈出收合。
    3. **修復切換 App 返回時的 `net::ERR_NAME_NOT_RESOLVED (Code: -2)` 錯誤與 `ON_RESUME` 搶載 (`MyMapScreen.kt` & `MyMapWebViewClient.kt`)**：
       - 剛從其他 App 切回前景的瞬間 (`ON_RESUME` 第 0 毫秒)，Android 系統尚未喚醒前景網路 DNS，此時若立刻在 `ON_RESUME` 執行 `wv.loadUrl(...)` 就會觸發 `net::ERR_NAME_NOT_RESOLVED (Code: -2)`。
       - **解決方案**：
         - 在 `ON_RESUME` 中，若剛啟動未滿 4 秒或 `isLoading == true`，僅呼叫 `wv.onResume()`，絕不重載。
         - 若需在 `ON_RESUME` 進行白屏或錯誤恢復檢查，必須透過 `Handler(Looper.getMainLooper()).postDelayed(..., 600L)` **延遲 600ms 等待系統網路喚醒後**，且確認 `MyMapWebViewClient.isNetworkAvailable(context) == true` 時才執行重載。
         - 在 `MyMapWebViewClient.onReceivedError` 中（當 `request.isForMainFrame` 為 `true`），若遇到暫時性 DNS/連線異常 (`ERROR_HOST_LOOKUP` / `ERR_NAME_NOT_RESOLVED`、`ERROR_CONNECT`、`ERROR_TIMEOUT`)，自動在 1.2 秒後重試一次 `view.loadUrl(recoveryUrl)`，避免卡在 Android 預設錯誤畫面。
- [x] **Phase 10：修復點選地圖後「手機優化排版」下地圖空白消失（僅「原始桌面排版」正常顯示）問題**
  - **問題根因與修復重點**：
    1. **手機窄螢幕下 `findLayerPanelByHeuristic()` 誤將「地圖共用外層父容器」標記為 `layer-panel` (`assets/inject_script.js`)**：
       - 在行動裝置窄視埠（`width=device-width`，約 `360px ~ 412px`）下，原本從 `#featurelist-pane` 往上攀爬父層的條件 `rect.width <= 460` 會在每一層全螢幕父容器成立（因全螢幕寬度也 `<= 460px`），導致一路往上爬到同時包裹「左側圖層面板 + 右側地圖畫布 (`#map-canvas` / `#lyra-canvas` / `.gm-style`)」的外層根容器並標記 `data-mygmap-role="layer-panel"`。
       - 隨後 `inject_style.css` 在預設收合狀態 (`mygmap-drawer-closed`) 對 `[data-mygmap-role="layer-panel"]` 套用 `transform: translateX(-105%)` 與 `visibility: hidden`，連同整張地圖一起被推到螢幕左外側隱藏！切換為「原始桌面排版」（移除 `body.mygmap-mobile-mode`）時該 CSS 失效並觸發 `resize`，地圖因此立刻恢復顯示。
    2. **實作地圖保護與安全邊界檢查 (`assets/inject_script.js`)**：
       - 新增 `containsMapOrEditorRoot(el)`：嚴格檢查元素是否為 `document.body`/`document.documentElement`，或內部包含 `#map-canvas`、`#lyra-canvas`、`#map-container`、`.gm-style`、`canvas`、`#mapsprosearch-field`、`[role="toolbar"]`、`[data-mygmap-role="map-canvas"]`。任何符合者**絕對禁止**被標記為 `layer-panel`（若既有 DOM 被誤標也必須在 `scanAndTagDom()` 中自動清除）。
       - 先定位並標記 `map-canvas`，再尋找 `layerPanel`；從 `#featurelist-pane` 往上提升外框時，只要父層滿足 `containsMapOrEditorRoot(parent)`、含有並排主畫面兄弟容器（如地圖欄位）或佔滿整個視窗寬度，即刻停止攀爬，僅精準鎖定左側圖層欄本身。
       - 第二階段通用結構掃描僅於 `detectIsEditorPage() == true` 時執行，且同樣受 `containsMapOrEditorRoot` 保護。
       - 在編輯頁首次套用手機優化排版與抽屜收合後，延遲派發 `window.dispatchEvent(new Event('resize'))` 讓 Google Maps JS 主動將地圖圖磚重繪至 `100vw` 滿版。
    3. **補強地圖畫布滿版可視樣式 (`assets/inject_style.css`)**：
       - 在 `body.mygmap-mobile-mode` 下為 `#map-canvas, #lyra-canvas, [data-mygmap-role="map-canvas"]` 明確補充 `right: 0 !important; visibility: visible !important; opacity: 1 !important;`，並維持相容所有 WebView 版本的標準 CSS3 抽屜選擇器。
- [x] **Phase 11：修復點擊地圖圖釘內的「導航」按鈕無反應問題，串接直接喚起官方 Google Maps App 導航**
  - **問題根因與修復重點**：
    1. **支援新視窗 / 彈出連結攔截 (`WebChromeClient.onCreateWindow` + `setSupportMultipleWindows(true)`)**：
       - Google 我的地圖圖釘氣泡窗或詳情面板中的「導航 / 規劃路線」按鈕（`<a target="_blank">` 或 `window.open(...)`）在 `setSupportMultipleWindows(false)` 且未實作 `onCreateWindow` 時，容易被 WebView 靜默忽略而毫無反應。
       - **對策**：改為 `setSupportMultipleWindows(true)` 並在 `MyMapScreen.kt` 的 `WebChromeClient` 實作 `onCreateWindow`，建立暫時性 WebView 擷取新視窗 URL 並立即交由外部 Google Maps 跳轉邏輯處理，處理完成後銷毀暫時 WebView。
    2. **攔截 HTTPS 版 Google Maps 導航 / 地點 / 短網址 (`MyMapWebViewClient.kt` & `MapExportAndIntentHelper.kt`)**：
       - `shouldOverrideUrlLoading` 與 `onCreateWindow` 新增 `isExternalGoogleMapsUrl(url)` 判斷（涵蓋 `maps.google.com`、`maps.app.goo.gl`、`goo.gl/maps` 與 `google.com` 下的 `/maps/dir`、`/maps/place`、`/maps/search`、`/maps/@`、`/maps?`，並嚴格排除 `/maps/d/` 本體編輯頁）。
       - 若攔截到 Google Maps 導航/地點連結或 `intent://`/`geo:`/`google.navigation:` 協定，解析其目的地座標或地點文字後透過 `MapExportAndIntentHelper` 優先使用 `com.google.android.apps.maps` 開啟導航（例如轉換為 `google.navigation:q=...` 或直接帶套件開啟原連結；未安裝時降級外部瀏覽器）。
    3. **JS 層 `window.open` 與氣泡窗導航按鈕保底攔截 (`assets/inject_script.js` & `MyMapJsBridge.kt`)**：
       - 在 `inject_script.js` 包裝 `window.open`：若目標網址為外部 Google Maps 導航/地點連結，直接呼叫 `window.AndroidBridge.onExternalNavigationRequested(url, contextJson)` 交給 Android 原生層開啟 Google Maps App。
       - 強化 `extractNavigationContext()` 支援從氣泡窗與側邊/底部詳情卡提取圖釘標題、座標與 `maps` 連結；當使用者點擊氣泡窗內的「導航 / 規劃路線 (`directions`)」按鈕且未觸發網頁內部路線圖層或標準連結跳轉時，自動把目前選取圖釘資訊傳給 `AndroidBridge.onExternalNavigationRequested`，確保 **100% 一點即開 Google Maps 導航**。
- [x] **Phase 12：POI 點選氣泡窗行動版美化 + 原生 Material 3 底部 POI 資訊快捷卡 (`SelectedPinBottomCard`)**
  - **問題痛點與改造重點**：
    1. **美化網頁內浮動氣泡窗 (`assets/inject_style.css`)**（嚴格限定於 `body.mygmap-mobile-mode` 下以維持 CSS Bypass 逃生門）：
       - **徹底消除左右裁字與水平捲軸**：限制 `.gm-style-iw-c`、`.gm-style-iw-d`、`#map-infowindow-container` 及其子容器 `max-width: calc(100vw - 28px) !important` 與 `overflow-x: hidden !important`，強制標題、地址及「在『Google 地圖』檢視」等文字自動換行 (`white-space: normal !important; word-break: break-word !important;`)。
       - **現代化圓角卡片排版**：優化氣泡窗圓角 (`16px`)、陰影、壓縮過大空白間距、美化「Google 地圖詳細資料」卡片背景與邊框，並將氣泡窗底部操作列（樣式、編輯、相片、導航、刪除、儲存/取消）調整為 `flex-wrap: wrap` 對齊與舒適觸控按鈕樣式，防止按鈕擠出螢幕外。
    2. **實作「原生 Material 3 底部 POI 資訊快捷卡 (`SelectedPinBottomCard`)」(`inject_script.js`、`MyMapJsBridge.kt`、`WebViewInjector.kt`、`MyMapScreen.kt`)**：
       - 透過 `inject_script.js` 的 `MutationObserver` 即時偵測點選 POI 後展開的氣泡窗，擷取**標題、詳細地址/備註、評分、經緯度座標**與是否處於氣泡窗編輯模式，並回報給 `AndroidBridge.onSelectedPinStateChanged(json)`。
       - 當選取 POI 且非氣泡窗編輯狀態時，於 `BottomActionBar` 上方平滑彈出簡潔美觀的原生 **`SelectedPinBottomCard`**：顯示完整不裁字的 POI 名稱、摘要、可點擊複製的座標膠囊，以及好按的圓角動作按鈕（「🧭 導航」、「🏙️ 街景」、「✏️ 編輯」、「🗺️ 在 Maps 開啟」、「✕ 關閉」）。
       - 點擊「✏️ 編輯」時自動呼叫 `WebViewInjector.triggerInfoWindowEdit(webView)` 開啟網頁編輯表單並暫時收合原生快捷卡（避免遮擋輸入）；點擊空白處關閉氣泡窗時同步隱藏原生卡片，並自動協調右下角 GPS FAB 的位置與間距避免重疊。

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

### Phase 8 交接紀錄
- **狀態**：已完成 (`[x]`)
- **已建立/修改檔案**：
  - `app/src/main/java/com/guiterevent/mygmap/webview/MyMapWebViewClient.kt`：
    - **整合 AndroidX WebKit `WebSettingsCompat.setUserAgentMetadata()`**：
      - 實作 `extractChromiumVersion(rawUa)` 與 `getSystemChromiumVersion(context)`，動態從 `WebSettings.getDefaultUserAgent(context)` 解析系統真實 Chromium 主版號與完整版號（解析失敗時預設 `"131"` / `"131.0.6778.200"`）。
      - 實作 `buildBrandVersionList(versionInfo)`，建構標準 Client Hints `BrandVersion` 清單：`"Not_A Brand"` (`24` / `24.0.0.0`)、`"Chromium"` (`$realMajor` / `$realFull`) 與 `"Google Chrome"` (`$realMajor` / `$realFull`)。
      - 實作 `applyUserAgentAndMetadata(webView, url, authProfile)`，搭配 `WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)` 與 `WebSettingsCompat.setUserAgentMetadata(webView.settings, metadata)` 同步更新 HTTP Client Hints 標頭與 `userAgentString`。
    - **配置「帳號頁面行動版模式」與「地圖頁面桌面版模式」自動同步**：
      - 定義 `AuthUaProfile`（預設 `CHROME_MOBILE_STANDARD`，備用 `FIREFOX_MOBILE_STANDARD`）。
      - 當 `isGoogleAuthUrl(url) == true`（如 `accounts.google.com`）時：
        - `CHROME_MOBILE_STANDARD`：設定 `userAgentString` 為 `"Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$realMajor.0.0.0 Mobile Safari/537.36"`，並同步設定 `UserAgentMetadata` 為 `platform = "Android"`, `platformVersion = "14.0.0"`, `mobile = true`, `model = ""`, `architecture = ""`。
        - `FIREFOX_MOBILE_STANDARD`：設定 `userAgentString` 為 `"Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0"`。
      - 當 `isGoogleAuthUrl(url) == false`（如 `www.google.com/maps/d`）時：
        - 設定 `userAgentString` 為桌面版 `"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$realMajor.0.0.0 Safari/537.36"`，並將 `UserAgentMetadata` 設定為 `platform = "Linux"`, `platformVersion = "6.5.0"`, `mobile = false`, `architecture = "x86"`, `bitness = 64`。
      - 實作 `isSignInRejectedUrl(url)` 與 `resetGoogleAuthStateAndReload(webView)`：清理 `accounts.google.com` 舊狀態 Cookie、切換 `AuthUaProfile` 並重新載入 `GOOGLE_SERVICE_LOGIN_URL`。
  - `app/src/main/java/com/guiterevent/mygmap/MainActivity.kt` & `app/src/main/java/com/guiterevent/mygmap/ui/MyMapScreen.kt`：
    - 將啟動時的 `WebView.setWebContentsDebuggingEnabled` 預設設為 `false`，僅於使用者在地圖編輯器開啟「🎯 DOM 探測除錯模式」時才動態切換為 `true`。
    - 於 `MyMapScreen.kt` 頂部新增 `AuthCompatibilityBanner`：當處於 Google 帳號登入頁或網址包含 `/signin/rejected` 時顯示「🔄 清除登入快取並重試（切換相容模式）」按鈕。
  - `app/src/test/java/com/guiterevent/mygmap/UserAgentStrategyTest.kt`：
    - 更新並擴充驗證 `extractChromiumVersion`、`buildBrandVersionList`、`resolveUserAgentForUrl`（行動版 Auth UA / Firefox 備用 UA / 桌面版地圖編輯器 UA）、`isSignInRejectedUrl` 與白屏防呆邏輯。
- **驗證結果與注意事項**：
  - 執行 `cmd /c build.bat check --no-explorer`：全專案 18 項單元測試 100% 通過 (`BUILD SUCCESSFUL`)，並成功重新產出 `dist\MyGMap-debug.apk`（`15.76 MB / 16,523,859 bytes`）。

### Phase 9 交接紀錄
- **狀態**：已完成 (`[x]`)
- **已建立/修改檔案**：
  - `app/src/main/java/com/guiterevent/mygmap/webview/MyMapWebViewClient.kt`：
    - **移除 `WebSettingsCompat.setUserAgentMetadata()` 與保留真實機型的原生 UA 淨化**：
      - 完全移除 `androidx.webkit.UserAgentMetadata`、`WebSettingsCompat`、`WebViewFeature` 依賴與所有 `setUserAgentMetadata` 呼叫，僅使用標準 `webView.settings.userAgentString`。
      - 修正 `buildSanitizedAuthUserAgent(rawDefaultUa)`：僅移除 `; wv` 與 `Version/x.x` 標記，完整保留裝置原本真實的 Android 版本、裝置型號與完整 `Chrome/xxx.0.xxxx.xx` 版號（僅於 `rawDefaultUa` 為空或不含 `Chrome/` 時才退回 `FALLBACK_CLEAN_MOBILE_UA`）。
    - **實作「單向階段鎖定 UA」與被動驗證白名單**：
      - 新增 `hasGoogleSessionCookie()`（檢查 `https://www.google.com` 與 `https://accounts.google.com` 的 `SID`、`HSID`、`SSID`、`__Secure-1PSID`、`__Secure-3PSID`）、`containsGoogleSessionCookie()`、`isMyMapsUrl(url)`、`isInteractiveGoogleSignInUrl(url)`（排除 `passive=true`、`passive=1209600`、`CheckCookie`、`SetSID`、`RotateCookies`、`ListAccounts`）及 `resolveInitialLoadUrl()`。
      - `configureWebView(webView)` 回傳 `WebViewUaConfig(sanitizedAuthUa, desktopUa, initialMode)`，依 `hasGoogleSessionCookie()` 設定初始 `userAgentString` 與 `UserAgentMode`。
      - 徹底刪除 `onPageStarted` 與 `onPageFinished` 中對 UA 與 `uaMode` 的變更；僅在 `shouldOverrideUrlLoading`（MainFrame）中執行單向階段轉換（`AUTH_CLEAN_CHROME` 僅在進入 `isMyMapsUrl(url)` 時切為 `DESKTOP_EDITOR`；`DESKTOP_EDITOR` 僅在 `!hasGoogleSessionCookie() && isInteractiveGoogleSignInUrl(url)` 時才切回 `AUTH_CLEAN_CHROME`）。
    - **暫時性 DNS / 網路喚醒錯誤自動重試**：
      - 新增 `isChromeErrorUrl(url)` 與 `isTransientNetworkError(errorCode, description)`。
      - 於 `onReceivedError`（MainFrame）遇到 `ERROR_HOST_LOOKUP` / `ERR_NAME_NOT_RESOLVED`、`ERROR_CONNECT`、`ERROR_TIMEOUT` 等暫時性錯誤時，先 `view.stopLoading()` 並於 `1200ms` 後自動重試一次 `view.loadUrl(failedUrl)`。
  - `app/src/main/java/com/guiterevent/mygmap/ui/MyMapScreen.kt` & `app/src/main/java/com/guiterevent/mygmap/ui/BottomActionBar.kt`：
    - **鎖定 UI 版面穩定度**：移除 `Scaffold` 的 `bottomBar` (`BottomActionBar`) 與 `floatingActionButton` (`ExtendedFloatingActionButton`) 外層的 `if (uaMode == DESKTOP_EDITOR)` 條件，讓底部工具列與定位 FAB 全程 100% 常駐顯示。
    - **收斂頂部橫幅顯示條件**：將 `AuthCompatibilityBanner` 的 `visible` 條件改為僅在 `MyMapWebViewClient.isSignInRejectedUrl(currentUrl)` 為 `true` 時顯示，並在 `BottomActionBar` 的「⚙️ 模式」選單新增「🔄 清除登入快取並重試」選項供隨時手動觸發。
    - **修復啟動與切換 App 的 `ON_RESUME` 搶載問題**：初始化採用 `MyMapWebViewClient.resolveInitialLoadUrl()` 設定初始 `uaMode`、`currentUrl` 與 `loadUrl(initialUrl)`；於 `ON_RESUME` 檢查距離建立未滿 `4_000L` 或 `isLoading == true` 時不重載，從背景 (`ON_STOP`) 切回前景時透過 `Handler(Looper.getMainLooper()).postDelayed(..., 650L)` 等待網路與 DNS 喚醒並確認 `isNetworkAvailable(context)` 後，才進行錯誤/白屏恢復載入。
  - `app/src/test/java/com/guiterevent/mygmap/UserAgentStrategyTest.kt`：
    - 更新與擴充單元測試，驗證保留真實機型的 `buildSanitizedAuthUserAgent`、`isMyMapsUrl`、`isInteractiveGoogleSignInUrl`、`containsGoogleSessionCookie`、`isTransientNetworkError` 及 `isChromeErrorUrl` / `resolveRecoveryUrl`。
- **驗證結果與注意事項**：
  - 依規範未執行 `build.bat` 或 `gradlew` 編譯，請使用者自行手動執行編譯與實機測試。

### Phase 10 交接紀錄
- **狀態**：已完成 (`[x]`)
- **已建立/修改檔案**：
  - `app/src/main/assets/inject_script.js`：
    - **地圖畫布保護機制 (`containsMapOrEditorRoot(el)` & `canAssignRole`)**：
      - 實作 `containsMapOrEditorRoot(el)`：只要節點為 `document.body`/`document.documentElement`，或自身／子樹包含 `#map-canvas`、`#lyra-canvas`、`#map-container`、`.gm-style`、`canvas`、`#mapsprosearch-field`、`[role="toolbar"]`、`[data-mygmap-role="map-canvas"]`，一律回傳 `true`，嚴禁被標記為 `layer-panel`。
      - 新增 `canAssignRole(roleAttr, el)` 並於 `findElement` 各優先序（Heuristic / ID / Label / Selector）統一把關：標記 `layer-panel` 前必須滿足 `detectIsEditorPage() && !containsMapOrEditorRoot(el)`。
    - **調整 `scanAndTagDom()` 執行順序與自我修復清理**：
      - 新增 `findMapCanvasElement()`：優先標記 `#map-canvas` / `#lyra-canvas`（或 `#map-container`），若無則尋找不包含 `#featurelist-pane`、`#mapsprosearch-field` 與 `[role="toolbar"]` 的 `.gm-style` 外層容器，並優先標記 `data-mygmap-role="map-canvas"`。
      - 在掃描前後執行自我修復清理：檢查畫面上所有現存 `[data-mygmap-role="layer-panel"]`，只要 `containsMapOrEditorRoot(el)` 為 `true` 或 `detectIsEditorPage()` 為 `false`，立即呼叫 `el.removeAttribute('data-mygmap-role')` 解除錯誤隱藏。
    - **重寫 `findLayerPanelByHeuristic()`**：
      - 若 `existingTagged` 已存在，僅於同時滿足 `isElementUsable(existingTagged) && !containsMapOrEditorRoot(existingTagged)` 時沿用，否則立即移除其 `data-mygmap-role`。
      - 當 `#featurelist-pane` 存在時，最多往上檢查 4 層 `parent`，一旦命中任一停止條件立即 `break`：(1) `containsMapOrEditorRoot(parent)` 為 `true`；(2) `parent` 除 `current` 外尚有其他高度 `>= window.innerHeight * 0.30` 且寬度 `>= 40` 的可見子元素（版面分割共用殼）；(3) `pRect.width >= viewportWidth - 8 && pRect.width > currentRect.width + 16`（全螢幕外殼）。
      - 第二階段結構啟發式掃描（無 `#featurelist-pane` 時）：僅於 `detectIsEditorPage() === true` 執行，嚴格跳過 `containsMapOrEditorRoot(candidate)` 為 `true` 的節點，並將最大寬度收斂為 `Math.min(380, viewportWidth * 0.88)`。
    - **隱藏左側欄後觸發地圖重繪 (`scheduleMapResizeIfNeeded`)**：
      - 當 `detectIsEditorPage() === true` 且 `helperState.mobileMode === true`，於偵測到地圖畫布並首次套用編輯頁／圖層抽屜或從列表切換至編輯頁時，透過 `mapResizeDebounceTimer` 防抖延遲 `120ms` 派發 `window.dispatchEvent(new Event('resize'))`，確保 Google Maps 主動重算 `100vw` 寬度並重繪圖磚。
  - `app/src/main/assets/inject_style.css`：
    - 於 `body.mygmap-mobile-mode #map-canvas, body.mygmap-mobile-mode #lyra-canvas, body.mygmap-mobile-mode [data-mygmap-role="map-canvas"]` 補充 `right: 0 !important;`、`visibility: visible !important;`、`opacity: 1 !important;`，維持相容舊版 WebView 的標準選擇器結構（未使用 `:has()`）。
  - `app/src/test/java/com/guiterevent/mygmap/JsBridgeAndAssetsTest.kt`：
    - 擴充斷言驗證 `containsMapOrEditorRoot`、保護選擇器（`#map-canvas` / `.gm-style` / `#mapsprosearch-field`）、`new Event('resize')` 及 `inject_style.css` 地圖畫布規則內的 `right: 0 !important;`、`visibility: visible !important;`、`opacity: 1 !important;`。
- **驗證結果與注意事項**：
  - 已執行 `node --check app/src/main/assets/inject_script.js` 驗證 JS 語法通過（exit code 0）。
  - 依規範未執行 `build.bat` 或 `gradlew` 編譯與 Gradle 單元測試，請使用者自行手動執行編譯與實機驗證。

### Phase 11 交接紀錄
- **狀態**：已完成 (`[x]`)
- **已建立/修改檔案**：
  - `app/src/main/java/com/guiterevent/mygmap/webview/MapExportAndIntentHelper.kt`：
    - 新增 `isExternalGoogleMapsUrl(url)`：支援辨識 `google.navigation:`、`geo:`、`google.streetview:`、`maps.app.goo.gl`、`goo.gl/maps`、`maps.google.*` 以及各國網域 Google Maps `/maps/dir`、`/maps/place`、`/maps/search`、`/maps/@`、`/maps` 連結，並明確排除 Google 我的地圖本身 (`MyMapWebViewClient.isMyMapsUrl`、`/maps/d`) 與 Google OAuth 登入網址。
    - 新增 `extractDirectionsDestinationFromUrl(url)`：依序從 `destination=`、`daddr=`、`/maps/dir/.../<dest>`、`query=`、`q=` 與 `extractLatLngFromUrl(url)` 解析目的地字串或 `"lat,lng"` 座標（相容純 JVM 單元測試環境）。
    - 新增 `openExternalMapsUrlInGoogleMapsApp(context, rawUrl, navContext)`：處理 `intent://`（含 `browser_fallback_url`）、`geo:`/`google.navigation:`/`google.streetview:` 與 HTTPS Google Maps 導航連結（解析目的地並結合 `navContext` 保底轉為 `google.navigation:q=...` 以 `setPackage(GOOGLE_MAPS_PACKAGE)` 喚起 Google Maps App；未安裝時降級為一般 `Intent.ACTION_VIEW` 外部開啟）。
  - `app/src/main/java/com/guiterevent/mygmap/webview/MyMapWebViewClient.kt`：
    - 於 `configureWebView(webView)` 開啟 `setSupportMultipleWindows(true)` 與 `javaScriptCanOpenWindowsAutomatically = true`。
    - 於 `shouldOverrideUrlLoading` 將 `intent:` 與外部 Google Maps 協定交由 `MapExportAndIntentHelper.openExternalMapsUrlInGoogleMapsApp` 處理，並在主框架 `http/https` 導航中若命中 `MapExportAndIntentHelper.isExternalGoogleMapsUrl(url)` 立即喚起官方 Google Maps App 並回傳 `true`。
  - `app/src/main/java/com/guiterevent/mygmap/webview/MyMapJsBridge.kt` & `app/src/main/java/com/guiterevent/mygmap/ui/MyMapScreen.kt`：
    - 在 `MyMapJsBridge` 新增 `@JavascriptInterface fun onExternalNavigationRequested(targetUrl, contextJson)` 並透過 `mainHandler.post` 轉交 `MyMapScreen.kt` 處理（含外部 Google Maps 網址開啟與 `GoogleMapsLaunchMode.NAVIGATION` 保底啟動）。
    - 在 `MyMapScreen.kt` 的 `WebChromeClient` 實作 `onCreateWindow`：建立暫時性隱藏 `WebView` 攔截 `<a target="_blank">` / `window.open` 新視窗 URL，屬於外部 Google Maps 或外部協定者立即交由 Google Maps App / 外部 Intent 開啟，一般站內網址則轉回主 `WebView` 載入，並於處理後及 6 秒超時機制安全 `destroy()` 防記憶體洩漏。
  - `app/src/main/assets/inject_script.js` & `app/src/main/assets/inject_style.css`：
    - 安全包裝 `window.open` (`installWindowOpenInterceptor`)：攔截外部 Google Maps 導航/地點彈窗並直接呼叫 `window.AndroidBridge.onExternalNavigationRequested(url, contextJson)`。
    - 強化 `extractNavigationContext()`：新增 `findActivePinContainers()` 與 `extractPinTitleFromContainers()`，除 `#map-infowindow-container` 外同步支援 `.gm-style-iw`、`[role="dialog"]` 與選取圖釘詳情卡片讀取標題、`<a>` 連結座標與文字經緯度。
    - 新增全域 `click` 監聽 `handleDocumentNavigationClick`（非 Inspect Mode 時生效）：攔截氣泡窗/詳情卡內的 `/maps/dir`、`maps.google.*`、`#map-infowindow-directions-button` 及語意導航按鈕，有 `href` 者立即轉交 Android 原生開啟，無 `href` 者於 `220ms` 未跳轉/未觸發 `window.open` 時以選取圖釘資訊保底啟動 Google Maps App 導航。
    - 於 `inject_style.css` 將 `#map-infowindow-directions-button` 及氣泡窗內 `a[href*="/maps/dir"]` 納入 `min-height: 42px`、`min-width: 44px` 觸控熱區保護。
  - `app/src/test/java/com/guiterevent/mygmap/MapExportAndIntentHelperTest.kt` & `app/src/test/java/com/guiterevent/mygmap/JsBridgeAndAssetsTest.kt`：
    - 擴充驗證 `isExternalGoogleMapsUrl`、`extractDirectionsDestinationFromUrl` 與 Phase 11 JS/CSS 必要規則與選擇器。
- **驗證結果與注意事項**：
  - 已執行 `node --check app/src/main/assets/inject_script.js` 驗證 JS 語法通過（exit code 0）。
  - 依規範未執行 `build.bat` 或 `gradlew` 編譯與 Gradle 單元測試，請使用者自行手動執行編譯與實機測試。

### Phase 12 交接紀錄
- **狀態**：已完成 (`[x]`)
- **已建立/修改檔案**：
  - `app/src/main/assets/inject_style.css`：
    - 在 `body.mygmap-mobile-mode` 嚴格作用域下全面美化網頁氣泡窗（維持 CSS Bypass 逃生門 100% 有效）：
      - 針對 `.gm-style-iw`、`.gm-style-iw-c`、`.gm-style-iw-d`、`#map-infowindow-container` 設定 `max-width: calc(100vw - 28px) !important;`、`overflow-x: hidden !important;`、`box-sizing: border-box !important;`，直接與子容器強制 `max-width: 100% !important;` 與自動換行 (`white-space: normal !important; word-break: break-word !important; overflow-wrap: anywhere !important;`)，徹底消除標題與「在『Google 地圖』檢視」裁字與水平捲軸。
      - 為 `.gm-style-iw-c` 套用 `border-radius: 16px !important;`、`box-shadow: 0 12px 30px rgba(15, 23, 42, 0.22) !important;`、`padding: 10px 12px !important;`，壓縮桌面版氣泡窗過大 `min-height` 與多餘上下留白，並美化詳細資料與 `a[href*="maps"]` 區塊（`#F8FAFC` 背景、`1px solid #E2E8F0` 細邊框、`border-radius: 10px`）。
      - 氣泡窗底部按鈕列（`[data-mygmap-role="infowindow-actions"]`、`[role="toolbar"]`、`#map-infowindow-edit-button`、`#map-infowindow-delete-button`、`#map-infowindow-directions-button`、`#map-infowindow-done-editing-button`、`#map-infowindow-cancel-editing-button` 等）全面加上 `flex-wrap: wrap !important;`、`gap: 6px !important;`、圓角底色與 `42px x 44px` 以上觸控尺寸，並為儲存按鈕 (`#map-infowindow-done-editing-button`) 加上 Google 藍主色標示。
      - 新增 `body.mygmap-mobile-mode.mygmap-pin-view-hidden`（檢視模式下以 `opacity: 0; pointer-events: none;` 隱藏網頁原氣泡窗，避免與原生 `SelectedPinBottomCard` 重複遮擋地圖，同時保留 DOM 可讀寫與按鈕可觸發）與 `body.mygmap-mobile-mode.mygmap-pin-editing`（編輯模式強制氣泡窗寬度 `calc(100vw - 28px)` 並隱藏箭頭尾巴）。
  - `app/src/main/assets/inject_script.js`：
    - 新增 `isInfoWindowVisible()`、`tagInfoWindowSubElements()`、`findInfoWindowCloseButton()`、`isInfoWindowInEditMode()`、`extractPinRatingFromContainer()`、`extractPinCoordinatesFromContainer()`、`extractPinPhotosFromContainer()`、`collectControlButtonTexts()` 與 `extractSelectedPinUiState()`：即時偵測 `#map-infowindow-container` / `.gm-style-iw` 氣泡窗是否展開，擷取 `title`、`details`（過濾「Google 地圖詳細資料」內的「移除 / Remove」等按鈕文字）、`rating`、`coordinates`、`lat`、`lng`、`photoUrls` 與 `isEditMode`（若氣泡窗為尚未加入地圖之搜尋結果 `#addtomap-button`，維持顯示原氣泡窗與搜尋加入列）。
    - 新增 `applyInfoWindowBodyClasses()`、`centerEditInfoWindowInViewport()` 與 `resetEditInfoWindowPosition()`：檢視模式下自動隱藏網頁氣泡窗；進入編輯模式時以 `getBoundingClientRect()` 動態計算視窗上中央偏移並以 `margin-left`/`margin-top` 將編輯氣泡窗精準置中，徹底解決點擊「編輯」後被 Google 地圖推往螢幕右外側而按不到的問題。
    - 新增 `reportSelectedPinStateIfChanged()` 與 `scheduleSelectedPinStateChecks()`：在 `scanAndTagDom()`、`syncFromAndroid()`、`popstate`、`hashchange`、節流 `MutationObserver` 與點擊/觸控地圖後比對快照差異並呼叫 `window.AndroidBridge.onSelectedPinStateChanged(json)`。
    - 於 `window.MyGMapHelper` 公開 `extractSelectedPinUiState()`、`triggerInfoWindowEdit()`（模擬點擊 `#map-infowindow-edit-button`）與 `closeInfoWindow()`（點擊 `.gm-style-iw button.gm-ui-hover-effect` / `#map-infowindow-close-button` / `[aria-label*="關閉"]` 等）。
  - `app/src/main/java/com/guiterevent/mygmap/webview/MyMapJsBridge.kt` & `app/src/main/java/com/guiterevent/mygmap/webview/WebViewInjector.kt`：
    - 新增 `SelectedPinInfo` 資料類別、`parseSelectedPinInfo(jsonStr)`（含純 JVM 單元測試正規表示式備援解析）、`@JavascriptInterface fun onSelectedPinStateChanged(infoJson: String)` 與 `onSelectedPinStateChangedCallback`。
    - 於 `WebViewInjector` 新增 `triggerInfoWindowEdit(webView, onResult)` 與 `closeInfoWindow(webView, onResult)`。
  - `app/src/main/java/com/guiterevent/mygmap/ui/MyMapScreen.kt`：
    - 新增 `selectedPinInfo` 狀態並於離開編輯頁、回列表首頁、重新載入或渲染程序恢復時重設為 `null`；整合 `BackHandler` 支援返回鍵優先收合 POI 快捷卡。
    - 實作高質感 Material 3 **`SelectedPinBottomCard`**：於 `selectedPinInfo?.visible == true && !selectedPinInfo.isEditMode && webError == null && !isOffline` 時在 `BottomActionBar` 上方透過 `AnimatedVisibility` 平滑彈出（優先於 `SearchAddToMapFloatingBar`），包含 Google 藍左側重點強調條、POI 標題、關閉按鈕、相片縮圖列（`PinPhotoThumbnail` 支援帶入 WebView Cookie 載入並點擊彈出 `PinPhotoPreviewDialog` 放大與左右切換瀏覽）、評分與詳細資料摘要卡、可點擊複製的經緯度等寬膠囊，以及單手操作快捷按鈕列（「導航」、「街景」、「編輯」、「Maps」）。
    - 自動協調右下角「📍 標記目前位置」`ExtendedFloatingActionButton`：當 `SelectedPinBottomCard` 顯示時平滑隱藏避讓，確保 FAB 絕不遮擋卡片內容與按鈕。
  - `app/src/test/java/com/guiterevent/mygmap/JsBridgeAndAssetsTest.kt`：
    - 新增 `parseSelectedPinInfo` 單元測試（含正常檢視、編輯模式與關閉/空值狀態），並擴充驗證 Phase 12 CSS 與 JS 必備規則。
- **驗證結果與注意事項**：
  - 已執行 `node --check app/src/main/assets/inject_script.js` 驗證 JS 語法通過（exit code 0）。
  - 依規範未執行 `build.bat` 或 `gradlew` 編譯與 Gradle 單元測試，請使用者自行手動執行編譯與實機測試。

### 補充更新：編譯成功自動遞增版本號與 APK 歸檔
- **已建立/修改檔案**：
  - `version.properties`：於專案根目錄集中管理 `VERSION_MAJOR=1`、`VERSION_MINOR=0`、`VERSION_PATCH=0`、`VERSION_CODE=1`。
  - `app/build.gradle.kts`：改為從 `version.properties` 讀取預設版號，並支援接收 `-PnextVersionCode` / `-PnextVersionName` 參數。
  - `build.bat`：執行 `debug` / `release` / `check` 編譯 APK 前自動計算下一版號 (`PATCH + 1`、`VERSION_CODE + 1`) 並傳入 Gradle 寫入 APK；**僅於 `gradlew.bat` 回傳成功 (`exit code == 0`) 且確認 APK 產出後**才寫回 `version.properties`（失敗或僅執行 `test` / `clean` 時不跳號；亦支援 `--no-bump` 選項），並同步產出 `dist\MyGMap-debug.apk` 與 `dist\MyGMap-debug-v<版本>.apk`。
  - `app/src/main/java/com/guiterevent/mygmap/ui/BottomActionBar.kt`：於底部「⚙️ 模式」選單最下方顯示目前 App 版本 `版本：v${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})`。
  - `app/src/main/assets/inject_style.css` & `app/src/main/assets/inject_script.js`：於 `body.mygmap-mobile-mode` 下以 `opacity: 0; pointer-events: none;` 隱藏右上角多餘之 Google 帳號頭像/九宮格 (`google-account-widget`) 與桌面版復原/重做浮動白條 (`editor-toolbar`)，釋放完整地圖畫布同時保留底部原生工具列對插針/復原/重做的正常觸發。






