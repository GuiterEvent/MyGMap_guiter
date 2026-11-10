# MyGMap 分階段開發 Prompt 手冊 (`PROMPTS_GUIDE.md`)

本文件收錄了完成「MyGMap (Google 我的地圖行動編輯器 Android App)」所需的 **5 個階段完整 Prompt**。
你可以按照順序，將每個階段的 Prompt 複製貼上到新的 AI 對話視窗中執行。每個 Prompt 都已內建指令，要求 AI 先讀取 `PROJECT_PLAN.md` 並在完成後更新交接紀錄。

---

## 【Phase 1 Prompt】專案骨架建立、WebView 偽裝與 Google 登入突破

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`，了解本專案「MyGMap (Google 我的地圖行動編輯器)」的整體架構、目錄規範與核心技術對策。

現在請執行 **Phase 1：Android 專案初始化、WebView 偽裝與 Google 登入突破**。

### 本階段實作要求：
1. **建立 Android 專案結構 (`d:\CodeBase\GuiterEvent\MyGMap_guiter`)**：
   - 使用 Kotlin + Jetpack Compose (Material 3)，套件名稱設為 `com.guiterevent.mygmap`。
   - 配置 `settings.gradle.kts`、`build.gradle.kts` (Project 與 App 層級)、`gradle.properties` 與 Gradle Wrapper，確保專案結構完整可編譯。
   - 在 `AndroidManifest.xml` 中宣告 `INTERNET`、`ACCESS_NETWORK_STATE` 以及未來會用到的 `ACCESS_FINE_LOCATION`、`ACCESS_COARSE_LOCATION` 權限，並設定 `android:usesCleartextTraffic="false"` 與硬體加速。

2. **實作核心 WebView 與突破 Google OAuth 登入限制 (`webview/MyMapWebViewClient.kt` & `ui/MyMapScreen.kt`)**：
   - 載入目標網址：`https://www.google.com/maps/d/`。
   - **解決 Google `403 disallowed_useragent` 問題**：
     - 絕對不可包含 Android WebView 預設的 `; wv` 標記。
     - 實作動態 User-Agent 策略：當處於 `accounts.google.com` 登入流程時，使用移除 `; wv` 的乾淨 Chrome UA；當進入 `google.com/maps/d` 時，強制使用桌面版 Chrome UA (`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`)，以避開手機瀏覽器的閹割版檢視畫面，進入完整編輯模式。
   - **Cookie 與 Session 持久化**：
     - 啟用 `CookieManager.getInstance().setAcceptCookie(true)` 與 `setAcceptThirdPartyCookies(webView, true)`。
     - 啟用 `domStorageEnabled = true`、`databaseEnabled = true`、`javaScriptEnabled = true`、`setSupportZoom(true)`、`builtInZoomControls = true`、`displayZoomControls = false`。
     - 在 `onPageFinished` 及 Activity `onPause`/`onStop` 時呼叫 `CookieManager.getInstance().flush()`，確保重開 App 不需重複登入。
   - **基礎導航與狀態 UI**：
     - 頂部顯示細長載入進度條 (`LinearProgressIndicator`)。
     - 整合 Compose `BackHandler`：當 `webView.canGoBack()` 為 true 時返回上一頁，否則詢問或退出。
     - 開啟 `WebView.setWebContentsDebuggingEnabled(true)` 以便 Chrome DevTools 除錯。

3. **驗證與交接**：
   - 檢查所有檔案語法與 Gradle 配置是否正確（若環境有 SDK 可嘗試執行 Gradle 檢查）。
   - 完成後，請**務必更新 `PROJECT_PLAN.md`**：將 Phase 1 勾選為 `[x]`，並在「Phase 1 交接紀錄」中詳細記錄建立的檔案清單與實作細節。
```

---

## 【Phase 2 Prompt】JS Bridge、DOM 探測器與 CSS 手機版響應式改造

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（特別注意核心技術規範與 Phase 1 的交接紀錄），並檢視目前已建立的程式碼。

現在請執行 **Phase 2：JS Bridge 架構、DOM 探測模式與 CSS 手機版響應式改造**。

### 本階段實作要求：
1. **建立模組化注入資源 (`app/src/main/assets/inject_style.css` 與 `inject_script.js`)**：
   - 請勿將大段 CSS/JS 硬編碼在 Kotlin 檔案內，統一放在 `assets/` 目錄並透過 `webview/WebViewInjector.kt` 讀取注入。
   - **Viewport 強制設定**：透過 JS 動態新增或覆寫 `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`。

2. **CSS 手機版介面重構 (`inject_style.css`)**：
   - **左側圖層面板抽屜化**：Google 我的地圖編輯頁左側的龐大圖層面板（如 `#featurelist-pane` 或透過 JS 識別出的左側面板容器 `[data-mygmap-role="layer-panel"]`），在手機直向螢幕會遮擋大半地圖。請將其改造為可收合的滑出式抽屜或底部面板：
     - 當 `body` 帶有 `mygmap-drawer-closed` class 時，隱藏或滑出畫面外 (`transform: translateX(-105%)`)，讓地圖畫布佔滿 100% 寬度。
     - 當 `body` 帶有 `mygmap-drawer-open` class 時，以適合手機閱讀的寬度（例如 `85vw`，最大 `340px`，高 `z-index`）平滑展開。
   - **放大觸控熱區**：將搜尋框 (`#mapsprosearch-field`)、新增至地圖按鈕 (`#addtomap-button`) 與頂部編輯工具列按鈕放大至適合手指點擊的尺寸（最小高度/寬度 `44px~48px`）。
   - **逃生門機制 (CSS Bypass)**：所有的自訂樣式請限定作用於 `body.mygmap-mobile-mode` 下，方便隨時透過切換 class 恢復原始桌面版排版（避免共用設定或匯入 KML 彈窗跑版）。

3. **智慧型 DOM 搜尋器與開發者 DOM 探測工具 (`inject_script.js` & `webview/MyMapJsBridge.kt`)**：
   - 在 `window.MyGMapHelper` 命名空間下建立多重容錯 DOM 匹配函式，支援：
     - 固定 ID（`#mapsprosearch-field`, `#mapsprosearch-button`, `#addtomap-button`, `#featurelist-pane`）
     - 語意屬性 `aria-label` / `data-tooltip` / `title`（同時支援繁體中文與英文，如 `"新增標記"` / `"Add marker"`、`"選取項目"` / `"Select items"`、`"繪製線條"` / `"Draw a line"`）
     - 啟發式結構搜尋（自動尋找畫面左側固定寬度的圖層容器並標記 `data-mygmap-role="layer-panel"`）。
   - 實作 `MyMapJsBridge` (`@JavascriptInterface`，掛載名稱為 `AndroidBridge`)：
     - 提供 `onPageModeChanged(isEditorPage: Boolean)` 回報目前是在「地圖列表首頁」還是「地圖編輯頁」。
     - 提供 `onDomInspected(infoJson: String)`：當開啟「DOM 探測模式 (Inspect Mode)」時，使用者點擊網頁任意按鈕，JS 會攔截或紀錄該元素的 `tagName`, `id`, `className`, `aria-label`, `data-tooltip` 並傳回 Android 顯示於頂部除錯橫幅或對話框，方便隨時校準 Selector。

4. **驗證與交接**：
   - 完成後，請**務必更新 `PROJECT_PLAN.md`**：將 Phase 2 勾選為 `[x]`，並在「Phase 2 交接紀錄」中記錄新增/修改的檔案、JS API 介面規格與 CSS 抽屜控制方式。
```

---

## 【Phase 3 Prompt】原生底部工具列 (Native Action Bar) 與高頻編輯動作串接

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（包含 Phase 1 & Phase 2 的交接紀錄），並檢視現有的 `MyMapScreen.kt`、`inject_script.js` 與 `MyMapJsBridge.kt`。

現在請執行 **Phase 3：原生底部工具列 (Native Bottom Action Bar) 與高頻編輯動作串接**。

### 本階段實作要求：
1. **打造單手操作友善的 `ui/BottomActionBar.kt`**：
   - 在 `MyMapScreen` 底部設計一排 Material 3 原生控制列（所有按鈕觸控區域至少 `48dp`）：
     1. **🗂️ 圖層 (`Layers`)**：點擊時呼叫 `window.MyGMapHelper.toggleLayerDrawer()`，展開或收合左側圖層面板，並同步更新按鈕的高亮狀態。
     2. **🔍 搜尋 (`Search`)**：點擊時彈出 Android 原生快速搜尋對話框（或底部輸入列），讓使用者用手機鍵盤流暢輸入地點名稱 -> 點擊搜尋後透過 JS 自動將文字填入 `#mapsprosearch-field` 並觸發搜尋（模擬輸入事件與點擊 `#mapsprosearch-button` 或 Enter 鍵事件）。同時在搜尋後提供一鍵「➕ 加入地圖 (`clickAddToMap()`)」快捷浮動按鈕！
     3. **📌 插針 (`Add Marker`)**：點擊時呼叫 `window.MyGMapHelper.activateAddMarkerTool()`，自動點擊網頁頂部工具列的「新增標記」按鈕，並在畫面上方顯示醒目提示：「📌 請點擊地圖任意位置以放置圖釘」。
     4. **🏠 列表 (`Home`)**：快速返回 `https://www.google.com/maps/d/` 地圖總覽頁或重新整理。
     5. **⚙️ 模式 (`More / Mode`)**：展開選單，支援：
        - 切換「📱 手機優化排版 / 🖥️ 原始桌面排版」(呼叫 `window.MyGMapHelper.toggleMobileCssMode()`)
        - 開關「🔍 DOM 探測除錯模式」(方便檢查網頁元素 Selector)
        - 觸發「↩️ 復原 (Undo)」與「↪️ 重做 (Redo)」

2. **強化 JS 模擬點擊事件 (`inject_script.js`)**：
   - 注意 Google Closure Library 的按鈕通常監聽完整的滑鼠/指標事件序列（`mousedown` -> `mouseup` -> `click` 或 `pointerdown` -> `pointerup`），單純呼叫 `el.click()` 有時不會觸發。請在 `window.MyGMapHelper.simulateClick(element)` 中依序派發完整的 `MouseEvent` (`mousedown`, `mouseup`, `click`, `bubbles: true`)，確保網頁工具列 100% 可被觸發。

3. **驗證與交接**：
   - 完成後，請**務必更新 `PROJECT_PLAN.md`**：將 Phase 3 勾選為 `[x]`，並在「Phase 3 交接紀錄」中記錄所有實作的 JS 橋接方法與 UI 互動流程。
```

---

## 【Phase 4 Prompt】殺手級行動功能 ——「📍 一鍵新增目前 GPS 位置」與快速打卡工作流

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（包含前三個階段的交接紀錄），了解目前已完成的 WebView 注入與底部工具列架構。

現在請執行 **Phase 4：殺手級行動功能 ——「📍 一鍵新增目前 GPS 位置」自動化工作流**。

### 本階段實作要求：
1. **實作 Android 原生高精準度定位 (`location/LocationHelper.kt`)**：
   - 整合定位權限請求 (`ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`)，若使用者尚未授權或未開啟 GPS，提供清楚的引導提示。
   - 支援取得手機即時經緯度 `(latitude, longitude)`（可使用 Google Play Services `FusedLocationProviderClient` 的 `getCurrentLocation` 或原生 `LocationManager` 雙重備援，確保在各種設備上都能快速拿到座標）。

2. **設計「📍 快速新增目前位置」原生對話框 (`ui/QuickPinDialog.kt`)**：
   - 在畫面右下方加入醒目的 FloatingActionButton (FAB) 或於底部工具列加入「📍 標記目前位置」按鈕。
   - 點擊後先取得目前 GPS 座標 `(lat, lng)`，並彈出 `QuickPinDialog`：
     - 顯示目前取得的經緯度座標（例如 `25.033964, 121.564468`）。
     - 讓使用者選填「📌 地點名稱（標題）」（例如：「街頭演出點 A - 廣場出口」，若留空則預設使用座標或時間戳記）與「📝 備註說明」。
     - 提供兩個動作按鈕：
       1. **「僅定位搜尋」**：將 `"lat, lng"` 填入搜尋框並將地圖移至目前位置。
       2. **「一鍵加入我的地圖」**：自動完成搜尋 + 加入圖層 + 填入名稱與備註！

3. **實作 JS 自動化打卡狀態機 (`inject_script.js` 中的 `addGpsPinToMap(lat, lng, title, description)`)**：
   - 使用 `MutationObserver`（搭配合理的 timeout 防呆）依序自動執行以下步驟，並透過 `AndroidBridge` 回報進度狀態：
     - **Step 1**：確保目前至少有一個選取中的圖層（若無則點擊第一個圖層標題），接著將 `"lat, lng"` 填入 `#mapsprosearch-field` 並觸發搜尋。
     - **Step 2**：監聽 DOM 等待搜尋結果資訊卡與 `#addtomap-button`（或含 `"新增至地圖"` / `"Add to map"` 的按鈕）出現，一旦出現立即呼叫 `simulateClick()` 將該座標轉為正式圖釘。
     - **Step 3**：若使用者有輸入自訂 `title` 或 `description`，等待圖釘編輯氣泡窗 (InfoWindow) 內的標題輸入框（如 `#map-infowindow-attr-名稱-value` 或氣泡窗內可編輯的 input/textarea/`contenteditable` 欄位）出現，自動填入標題與備註，並自動點擊「儲存 (Save)」按鈕！
     - **容錯設計**：若 Step 3 因氣泡窗結構差異未能自動改名，至少確保圖釘已成功加入地圖，並將使用者輸入的「名稱與備註」自動複製到手機剪貼簿 (`ClipboardManager`)，提示使用者可直接貼上！

4. **驗證與交接**：
   - 完成後，請**務必更新 `PROJECT_PLAN.md`**：將 Phase 4 勾選為 `[x]`，並在「Phase 4 交接紀錄」中詳細記錄定位模組與自動化打卡腳本的實作細節。
```

---

## 【Phase 5 Prompt】進階體驗優化（跳轉 Google Maps 導航、KML/KMZ 下載、離線防呆與打包）

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（包含 Phase 1 ~ Phase 4 的交接紀錄），檢視目前整體專案程式碼。

現在請執行最後一個階段 **Phase 5：進階體驗優化（跳轉 Google Maps App 導航、KML/KMZ 匯出下載、離線防呆與最終檢查）**。

### 本階段實作要求：
1. **一鍵跳轉官方 Google Maps App 導航/查看**：
   - 在更多選單或工具列新增「🗺️ 在 Google Maps App 開啟」功能：
     - 若目前網頁 URL 包含 `mid=` (地圖 ID) 或已選取特定座標，可透過 Android `Intent(Intent.ACTION_VIEW, Uri.parse(...))` 直接喚起手機內的官方 Google Maps App 進行路線導航或查看街景。

2. **支援 KML / KMZ 匯出與檔案下載 (`DownloadListener`)**：
   - 當使用者在「我的地圖」中點擊「匯出為 KML/KMZ」時，WebView 預設不會處理下載。
   - 請為 WebView 註冊 `setDownloadListener`，同步帶入 `CookieManager.getInstance().getCookie(url)` 與目前的 `User-Agent`，交由 Android `DownloadManager` 下載至系統 `Downloads` 資料夾，並顯示 Toast 通知下載完成。

3. **網路連線防呆、網頁錯誤恢復與 UX 細節打磨**：
   - 監聽網路狀態或 WebView `onReceivedError`，當手機在戶外信號不佳斷線時，顯示友善的重試覆蓋層，而非空白錯誤頁。
   - 防止手勢衝突：當使用者在地圖上雙指縮放或拖曳時，避免誤觸系統邊緣返回或畫面抖動。
   - 進行全專案程式碼檢查，確認沒有遺漏的 import、未處理的權限崩潰或記憶體洩漏（確保 `WebView` 在 Activity 銷毀時妥善清理）。

4. **最終驗證與交接**：
   - 若環境支援，執行 `./gradlew assembleDebug` 驗證編譯通過（或確認所有 Gradle 與 Kotlin 檔案零語法錯誤）。
   - 完成後，請**更新 `PROJECT_PLAN.md`**：將 Phase 5 勾選為 `[x]`，並在「Phase 5 交接紀錄」中寫下最終架構總結、APK 建置方式與使用說明。
```

---

## 【Phase 6 Prompt】三大致命坑洞全面加固（純桌面版 UA 強制統一、重啟白屏防護、WebChromeClient Geolocation 授權）

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（包含 Phase 1 ~ Phase 5 的交接紀錄），並檢視現有的 `MyMapWebViewClient.kt`、`MyMapScreen.kt` 與單元測試。

現在請執行 **Phase 6：Android WebView 載入 Google 我的地圖「三大致命坑洞」全面加固與驗證**。

請務必在程式碼中逐一檢查並實作以下三個關鍵防護機制：

### 1. 徹底避免 Google 登入被阻擋（`403 disallowed_useragent`）與重定向中斷
- **原因**：Google 會封鎖預設帶有 `; wv` 字樣的 Android WebView User-Agent；且在 OAuth 跳轉過程中若中途變更 UA 並強制重呼叫 `loadUrl` 可能導致重定向 Session 中斷。
- **實作對策 (`webview/MyMapWebViewClient.kt` & `UserAgentStrategyTest.kt`)**：
  - 將 `WebView` 的 `settings.userAgentString` **強制且一致地完整替換為純桌面版 Chrome 瀏覽器字串**（`DESKTOP_CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"`），確保全程絕不出現 `; wv` 或 `Version/4.0` 字樣，讓 Google 帳號能正常登入並全程保持完整桌面版編輯介面。
  - 移除或避免在 `shouldOverrideUrlLoading` 中因切換 UA 而中斷 OAuth POST/Redirect 鏈的 `view.loadUrl(url)` 強制重載行為，確保登入後順暢跳回 `https://www.google.com/maps/d/`。

### 2. 防止重啟 App 後登入狀態遺失、頁面變白
- **原因**：WebView 若未啟用完整的網頁儲存與 Cookie 穿透機制，或前景恢復時 WebView 渲染程序被系統回收，會導致 Google 驗證狀態無法持久化或重開呈現白屏。
- **實作對策 (`webview/MyMapWebViewClient.kt` & `ui/MyMapScreen.kt`)**：
  - 在 `configureWebView(webView)` 中確保明確開啟：
    - `javaScriptEnabled = true`
    - `domStorageEnabled = true`
    - `databaseEnabled = true`
    - `CookieManager.getInstance().setAcceptCookie(true)` 與 `CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)`
  - **防白屏恢復機制**：
    - 在 `MyMapWebViewClient` 覆寫 `onRenderProcessGone`，當系統在背景回收 WebView 渲染程序時安全攔截並重新載入頁面，防止 App 崩潰或停留在空白畫面。
    - 在 `MyMapScreen.kt` 的 `ON_RESUME` 生命週期與 `onPageFinished` 中加入白屏防呆檢查（例如若 `webView.url.isNullOrBlank()` 或停留在 `about:blank` 則自動重新載入 `MY_MAPS_HOME_URL`），並確保 `CookieManager.getInstance().flush()` 在每次頁面載入完成與退至背景時確實執行。

### 3. 確保網頁內建定位按鈕（HTML5 Geolocation）能順利取得手機 GPS 目前位置
- **原因**：除了原生底部按鈕外，Google 我的地圖網頁內部也會透過 W3C `navigator.geolocation` 請求定位；若未開啟 `setGeolocationEnabled(true)` 且未在 `WebChromeClient` 覆寫 `onGeolocationPermissionsShowPrompt`，網頁內的定位功能會直接失敗。
- **實作對策 (`webview/MyMapWebViewClient.kt` & `ui/MyMapScreen.kt`)**：
  - 在 `MyMapWebViewClient.configureWebView(webView)` 中明確啟用：`webView.settings.setGeolocationEnabled(true)`。
  - 在 `MyMapScreen.kt` 的 `WebChromeClient` 中覆寫 `onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?)`：
    - 若 App 目前已具備 `ACCESS_FINE_LOCATION` 或 `ACCESS_COARSE_LOCATION` 權限（`LocationHelper.hasLocationPermission(context)` 為 `true`），立即呼叫 `callback?.invoke(origin, true, false)` 自動允許該 origin 的定位請求。
    - 若 App 尚未取得定位權限，先暫存該筆 `(origin, callback)` 並自動觸發 `locationPermissionLauncher.launch(LocationHelper.REQUIRED_PERMISSIONS)`；待使用者授權結果返回後，再自動呼叫 `callback.invoke(origin, granted, false)`，讓網頁內的定位請求無縫接通！

### 4. 驗證與交接：
- 更新並擴充單元測試（如 `UserAgentStrategyTest.kt`），驗證純桌面版 UA 強制套用與無 `; wv` 檢查。
- 完成後，請**務必更新 `PROJECT_PLAN.md`**：將 Phase 6 勾選為 `[x]`，並在「Phase 6 交接紀錄」中詳細記錄這三大坑洞防護機制的修改檔案與實作細節。
```

---

## 【Phase 7 Prompt】一鍵自動編譯腳本 (`build.bat`)、純開源工具鏈檢核與 APK 產出定位（嚴禁商業授權軟體）

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（包含 Phase 1 ~ Phase 6 的交接紀錄），並檢查目前的 Gradle 與專案配置。

現在請執行 **Phase 7：建立 Windows 一鍵自動編譯腳本 (`build.bat`)、純開源工具鏈檢核與 APK 產出定位（嚴禁使用商業授權軟體工具）**。

### ⚠️ 核心合規原則（100% 開源免費授權，嚴禁商業授權軟體）：
1. **絕對禁止使用具商業授權限制的軟體工具**：
   - **禁止使用 Oracle JDK**（例如 `C:\Program Files\Java\jdk-*` 等受 Oracle Commercial License / NFTC 限制之發行版）。腳本在偵測 JDK 時，必須主動檢查 `<JAVA_HOME>\release` 檔案或 `java -version` 輸出，若發現屬於受商業限制之 `Oracle Corporation` 發行版，必須拒絕使用並印出合規警告。
   - **僅限使用 100% 開源且可免費商用之 OpenJDK (GPLv2 + Classpath Exception)**：
     - **Eclipse Temurin (Adoptium OpenJDK)** (`C:\Program Files\Eclipse Adoptium\jdk-*`)
     - **Microsoft Build of OpenJDK** (`C:\Program Files\Microsoft\jdk-*`)
     - **Amazon Corretto** (`C:\Program Files\Amazon Corretto\jdk*`)
     - **Azul Zulu Community OpenJDK** (`C:\Program Files\Zulu\zulu-*`)
     - **BellSoft Liberica OpenJDK** (`C:\Program Files\BellSoft\LibericaJDK-*`)
     - 或專案目錄下自動下載之免安裝開源 `.toolchain\openjdk-17`
   - **不依賴任何商業付費 IDE 或專有打包工具**：全程僅使用 Apache 2.0 開源授權之 **Gradle Wrapper (`gradlew.bat`)** 與開源 Android SDK Build-Tools 進行命令列建置。

### 本階段實作要求：
1. **建立智慧型純開源一鍵編譯腳本 (`d:\CodeBase\GuiterEvent\MyGMap_guiter\build.bat`)**：
   - 使用 UTF-8 (`chcp 65001 >nul`) 與清楚的繁體中文終端機輸出介面。
   - **Step A — 自動偵測/部署純開源 OpenJDK 17 (`JAVA_HOME`)**：
     - 優先檢查專案本地 `.toolchain\jdk` 或系統已安裝的開源 OpenJDK（Temurin / Microsoft / Corretto / Zulu / Liberica）。
     - 驗證 `<JAVA_HOME>\release` 中的 `IMPLEMENTOR`，確認為開源發行版（排除 Oracle 商業授權版）並於終端機印出目前使用的 OpenJDK 發行商與授權資訊（GPLv2+CE）。
     - **支援免安裝自動下載開源 OpenJDK**：若本機未找到任何開源 OpenJDK 17（或傳入 `--bootstrap-jdk`），腳本可透過內建 PowerShell 指令自動從 **Eclipse Adoptium 官方開源 API** (`https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse`) 下載免安裝 ZIP 解壓至專案 `.toolchain\jdk-17` 並直接使用！
   - **Step B — 自動偵測與配置 Android SDK (`local.properties`)**：
     - 若專案根目錄尚無 `local.properties` 且未設定 `ANDROID_HOME` / `ANDROID_SDK_ROOT`，自動搜尋常見路徑（如 `%LOCALAPPDATA%\Android\Sdk`、`C:\Android\Sdk`、`D:\Android\Sdk`、`.toolchain\android-sdk`）。
     - 找到後自動產生格式正確的 `local.properties`（注意 Windows 路徑反斜線跳脫 `sdk.dir=C\:\\Users\\...`）。
     - 若本機尚未安裝 Android SDK，請印出清楚的開源命令列工具建置指引。

2. **執行 Gradle 編譯並自動歸檔與顯示 APK 完整位置**：
   - 支援預設編譯 Debug APK（`call gradlew.bat assembleDebug`），也支援傳入參數（例如 `build.bat release` 編譯 `assembleRelease`，或 `build.bat test` 執行單元測試，或 `build.bat clean`）。
   - 當編譯成功時：
     - 檢查產出的 APK 檔案：`app\build\outputs\apk\debug\app-debug.apk`。
     - 自動建立根目錄下的 `dist\` 資料夾，並將編譯好的 APK 複製一份命名為 `dist\MyGMap-debug.apk`。
     - 在終端機以醒目的分隔線印出：
       - ✅ **編譯結果**：成功（100% 純開源工具鏈建置）
       - 📜 **工具鏈授權確認**：顯示所使用的 OpenJDK 發行版名稱與開源授權 (GPLv2+CE / Apache 2.0)
       - 📂 **Gradle 原始 APK 完整路徑**：`d:\CodeBase\GuiterEvent\MyGMap_guiter\app\build\outputs\apk\debug\app-debug.apk`
       - 📂 **快捷提取 APK 完整路徑**：`d:\CodeBase\GuiterEvent\MyGMap_guiter\dist\MyGMap-debug.apk`
       - 📦 **檔案大小 (MB/KB) 與最後修改時間**
     - 若未傳入 `--no-explorer` 參數，支援自動呼叫 `explorer.exe /select,"d:\CodeBase\GuiterEvent\MyGMap_guiter\dist\MyGMap-debug.apk"` 直接打開檔案總管並高亮選中該 APK！
     - 若偵測到系統有開源 `adb` (Android Platform Tools) 且已連接手機，額外提示可輸入 `adb install -r "dist\MyGMap-debug.apk"` 一鍵安裝。

3. **實測執行與錯誤修補**：
   - 建立好 `build.bat` 後，請實際在終端機執行一次 `cmd /c build.bat --no-explorer` 驗證腳本邏輯與輸出。
   - 同步更新 `README.md`（加入 `build.bat` 純開源一鍵編譯說明與開源授權聲明）與 `.gitignore`（忽略 `dist/`、`.toolchain/` 與 `local.properties`）。

4. **驗證與交接**：
   - 完成後，請**務必更新 `PROJECT_PLAN.md`**：將 Phase 7 勾選為 `[x]`，並在「Phase 7 交接紀錄」中記錄 `build.bat` 的開源合規設計細節與實測結果。
```

