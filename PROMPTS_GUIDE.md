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

---

## 【Phase 8 Prompt】AndroidX WebKit `UserAgentMetadata` 相容性設定與行動/桌面模式優化

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（包含 Phase 1 ~ Phase 7 的交接紀錄與 Phase 8 規格），並檢視現有的 `MyMapWebViewClient.kt`、`MyMapScreen.kt` 與 `MainActivity.kt`。

現在請執行 **Phase 8：實作 AndroidX WebKit `UserAgentMetadata` 標頭同步與行動/桌面檢視模式相容性優化**（注意：完成程式碼修改後**請勿執行 `build.bat` 或 `gradlew` 編譯**，我會自己執行）。

### 本階段實作要求：

1. **整合 AndroidX WebKit `WebSettingsCompat.setUserAgentMetadata()` (`webview/MyMapWebViewClient.kt`)**：
   - 依據 AndroidX WebKit (`androidx.webkit:webkit:1.11.0`) 官方最佳實踐，當自訂 `WebSettings.userAgentString` 時，應同步透過 `WebViewFeature.isFeatureSupported(WebViewFeature.USER_AGENT_METADATA)` 與 `WebSettingsCompat.setUserAgentMetadata(webView.settings, metadata)` 更新 Client Hints Metadata，確保 HTTP 標頭與 `userAgentString` 一致：
   - 從系統 `WebSettings.getDefaultUserAgent(context)` 動態解析目前裝置的 Chromium 主版號與完整版號（例如 `major = "131"`, `full = "131.0.6778.200"`，若解析失敗則使用預設值 `"131"` / `"131.0.6778.200"`）。
   - 設定 `UserAgentMetadata.BrandVersion` 清單為標準的 `"Not_A Brand"` (`24` / `24.0.0.0`)、`"Chromium"` (`$realMajor` / `$realFull`) 與 `"Google Chrome"` (`$realMajor` / `$realFull`)。

2. **配置「帳號頁面行動版模式」與「地圖頁面桌面版模式」自動同步 (`webview/MyMapWebViewClient.kt`)**：
   - 當網址屬於 `isGoogleAuthUrl(url) == true`（如 `accounts.google.com`）時：
     - 支援兩種標準行動瀏覽器相容設定 (`AuthUaProfile`)，預設使用 `CHROME_MOBILE_STANDARD`：
       - `CHROME_MOBILE_STANDARD`：設定 `userAgentString` 為標準 Chrome Android Reduced 格式 `"Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$realMajor.0.0.0 Mobile Safari/537.36"`，並將 `UserAgentMetadata` 設定為 `platform = "Android"`, `platformVersion = "14.0.0"`, `mobile = true`, `model = ""`, `architecture = ""`。
       - `FIREFOX_MOBILE_STANDARD`（備用選項）：設定 `userAgentString` 為 `"Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0"`。
   - 當網址屬於 `isGoogleAuthUrl(url) == false`（如 `www.google.com/maps/d`）時：
     - 設定 `userAgentString` 為桌面版格式 `"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$realMajor.0.0.0 Safari/537.36"`，並將 `UserAgentMetadata` 設定為 `platform = "Linux"`, `platformVersion = "6.5.0"`, `mobile = false`, `architecture = "x86"`, `bitness = 64`。

3. **調整 WebView 除錯模式預設值 (`MainActivity.kt` & `MyMapScreen.kt`)**：
   - 將 `MainActivity.kt` 與 `MyMapScreen.kt` 啟動時的 `WebView.setWebContentsDebuggingEnabled` 預設設為 `false`，僅在使用者於地圖編輯器開啟「🎯 DOM 探測除錯模式」時才動態切換為 `true`。

4. **新增帳號頁面「🔄 重整登入狀態 / 切換相容模式」輔助橫幅 (`ui/MyMapScreen.kt` & `webview/MyMapWebViewClient.kt`)**：
   - 當處於 `accounts.google.com` 或網址包含 `/signin/rejected` 時，於畫面頂部提供「🔄 清除登入快取並重試（切換相容模式）」按鈕：
     - 點擊時清理 `accounts.google.com` 的舊狀態 Cookie、切換 `AuthUaProfile`，並重新載入 `https://accounts.google.com/ServiceLogin?hl=zh-TW&continue=https%3A%2F%2Fwww.google.com%2Fmaps%2Fd%2F`。

5. **更新單元測試與交接紀錄（請勿執行 build）**：
   - 同步更新 `UserAgentStrategyTest.kt` 程式碼以對應新版函式。
   - **請勿執行 `build.bat` 或 `gradlew` 編譯指令**（使用者會自行手動編譯）。
   - 完成後更新 `PROJECT_PLAN.md`：將 Phase 8 勾選為 `[x]` 並填寫「Phase 8 交接紀錄」。
```

---

## 【Phase 9 Prompt】徹底解決畫面與工具列跳動迴圈、啟動白屏及切換 App 時的 `ERR_NAME_NOT_RESOLVED` 錯誤（不執行 build）

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（包含 Phase 1 ~ Phase 8 的交接紀錄與最新的 Phase 9 規格），並檢視現有的 `MyMapWebViewClient.kt`、`MyMapScreen.kt` 與 `UserAgentStrategyTest.kt`。

現在請直接修改專案中的檔案，執行 **Phase 9：徹底解決畫面與工具列跳動迴圈、啟動白屏及切換 App 時的 `ERR_NAME_NOT_RESOLVED` 錯誤**（注意：請務必直接寫入修改 `d:\CodeBase\GuiterEvent\MyGMap_guiter` 下的檔案；完成程式碼修改後**請勿執行 `build.bat` 或 `gradlew` 編譯**，我會自己執行）。

### 🔍 三大問題根因分析（務必全部修正）：
1. **為什麼頂部會在「🔐 OAuth 登入模式」與「📋 地圖列表頁 + 🖥️ 桌面核心」之間瘋狂跳動、底部工具列忽隱忽現？**
   - `www.google.com/maps/d/` 在載入時會與 `accounts.google.com/ServiceLogin?passive=...` / `CheckCookie` / `SetSID` 進行跨網域被動 Session 檢查與 302 Redirect。
   - 現有的 `MyMapWebViewClient` 在 `shouldOverrideUrlLoading`、`onPageStarted`、`onPageFinished` 中呼叫 `syncUserAgentAndMetadataForUrl`，只要網址一碰到 `accounts.google.com` 就改成行動版 UA + `AUTH_CLEAN_CHROME`（導致 `MyMapScreen` 把底部工具列跟 FAB 卸載隱藏），一回到 `www.google.com/maps/d/` 又改成桌面版 UA + `DESKTOP_EDITOR`（又把底部工具列掛載出來）。
   - 重定向中途切換 UA 與 `setUserAgentMetadata` 導致 Google Session 驗證失敗而再次導回 `accounts.google.com`，形成**無限乒乓跳動迴圈**！
2. **為什麼切換去其他程式再切回來會跳出 `net::ERR_NAME_NOT_RESOLVED (Code: -2)`？**
   - 從背景切回前景的瞬間 (`Lifecycle.Event.ON_RESUME` 第 0 毫秒)，Android 系統尚未喚醒 App 的前景網路與 DNS，但 `MyMapScreen.kt` 的 `ON_RESUME` 卻立刻在該瞬間執行 `wv.loadUrl(...)`，導致 DNS 解析直接失敗 (`ERR_NAME_NOT_RESOLVED`) 並顯示 Android 內建錯誤頁。
3. **`WebSettingsCompat.setUserAgentMetadata()` 在導航回呼中造成內部卡死**：
   - 導航期間呼叫 `setUserAgentMetadata` 會造成 WebView 重定向停滯。

---

### 🛠️ 本階段實作要求：

1. **移除 `WebSettingsCompat.setUserAgentMetadata()` 並恢復保留真實機型的原生 UA 淨化 (`webview/MyMapWebViewClient.kt`)**：
   - **移除所有 `WebSettingsCompat.setUserAgentMetadata` 相關呼叫**，僅使用標準的 `webView.settings.userAgentString`。
   - **修正 `buildSanitizedAuthUserAgent(rawDefaultUa: String?)`**：
     - 讀取系統預設 `rawDefaultUa`（來自 `WebSettings.getDefaultUserAgent(context)`），**僅移除 `; wv` 與 `Version/x.x` 標記**，**完整保留手機原本真實的 Android 版本、真實裝置型號與完整 `Chrome/xxx.0.xxxx.xx` 版號**（若 `rawDefaultUa` 為空或不含 `Chrome` 才退回 `FALLBACK_CLEAN_MOBILE_UA`）。

2. **實作「單向階段鎖定 UA」與被動驗證白名單，徹底終結乒乓迴圈 (`webview/MyMapWebViewClient.kt`)**：
   - 在 `MyMapWebViewClient.Companion` 新增：
     - `fun hasGoogleSessionCookie(): Boolean`：檢查 `CookieManager.getInstance().getCookie("https://www.google.com")` 或 `getCookie("https://accounts.google.com")` 是否包含已登入的 Session Cookie（`SID=`、`HSID=`、`SSID=`、`__Secure-1PSID=` 或 `__Secure-3PSID=`）。
     - `fun isMyMapsUrl(url: String?): Boolean`：判斷網址是否為 Google 我的地圖（host 包含 `google.com` 且 path 以 `/maps/d` 開頭）。
     - `fun isInteractiveGoogleSignInUrl(url: String?): Boolean`：判斷是否為「真正需要使用者輸入帳密的互動式登入頁」：
       - 必須屬於 `isGoogleAuthUrl(url) == true`
       - **且網址不得包含** `passive=true`、`passive=1209600`、`CheckCookie`、`SetSID`、`RotateCookies`、`ListAccounts` 等背景/被動驗證參數！
     - `fun resolveInitialLoadUrl(): String`：
       - 若 `hasGoogleSessionCookie() == true`：回傳 `MY_MAPS_HOME_URL` (`"https://www.google.com/maps/d/"`)。
       - 若 `hasGoogleSessionCookie() == false`：直接回傳 `GOOGLE_SERVICE_LOGIN_URL` (`"https://accounts.google.com/ServiceLogin?hl=zh-TW&continue=https%3A%2F%2Fwww.google.com%2Fmaps%2Fd%2F"`)。
   - **在 `configureWebView(webView)` 中**：
     - 若 `hasGoogleSessionCookie() == true`，初始 `userAgentString` 設為 `desktopUa`，初始模式為 `UserAgentMode.DESKTOP_EDITOR`。
     - 若 `hasGoogleSessionCookie() == false`，初始 `userAgentString` 設為 `sanitizedAuthUa`，初始模式為 `UserAgentMode.AUTH_CLEAN_CHROME`。
   - **在 `shouldOverrideUrlLoading`、`onPageStarted`、`onPageFinished` 中**：
     - **徹底刪除 `onPageStarted` 與 `onPageFinished` 裡面的 `syncUserAgentAndMetadataForUrl` 呼叫！** 絕不在頁面載入中途或完成時反覆改動 UA 與 `uaMode`！
     - 在 `MyMapWebViewClient` 內部維護 `private var currentUaMode: UserAgentMode`：
       - 當 `currentUaMode == UserAgentMode.AUTH_CLEAN_CHROME` 時：全程保持 `sanitizedAuthUa`（包含經過 `CheckCookie`、`SetSID` 等所有跳轉），**只有當目標網址進入 `isMyMapsUrl(url) == true` 時**，才切換為 `UserAgentMode.DESKTOP_EDITOR`、設定 `view.settings.userAgentString = desktopUa`、通知 `onUserAgentModeChanged(DESKTOP_EDITOR)`，並於 GET 請求時呼叫一次 `view.loadUrl(url)` 載入桌面版地圖！
       - 當 `currentUaMode == UserAgentMode.DESKTOP_EDITOR` 時：**即使遇到 `accounts.google.com/ServiceLogin?passive=...` 或 `SetSID` 重定向，也絕對不可切回 `AUTH_CLEAN_CHROME`！** 只有當 `!hasGoogleSessionCookie()` 且 `isInteractiveGoogleSignInUrl(url) == true` 時，才切換為 `AUTH_CLEAN_CHROME`。

3. **鎖定 `MyMapScreen.kt` 版面穩定度：底部工具列與 FAB 100% 常駐不跳動 (`ui/MyMapScreen.kt`)**：
   - **移除 `Scaffold` 的 `bottomBar` 與 `floatingActionButton` 中 `if (uaMode == MyMapWebViewClient.UserAgentMode.DESKTOP_EDITOR)` 的隱藏條件**，讓 `BottomActionBar` 與 `ExtendedFloatingActionButton` **全程 100% 常駐顯示**，徹底杜絕底部工具列忽隱忽現與 WebView 視窗高度跳動！
   - 將頂部 `AuthCompatibilityBanner` 的 `visible` 條件改為**僅在 `MyMapWebViewClient.isSignInRejectedUrl(currentUrl)` 為 `true` 時才顯示**（一般載入與登入時不彈出橫幅，確保頂部高度固定不跳動；同時在 `BottomActionBar` 的「⚙️ 模式」選單中也可隨時手動觸發清除登入快取重試）。
   - 在 `AndroidView(factory)` 初始化時，使用 `val initialUrl = MyMapWebViewClient.resolveInitialLoadUrl()` 設定對應的初始 `uaMode` 與 `currentUrl`，並呼叫 `loadUrl(initialUrl)`。

4. **修復切換 App 時的 `net::ERR_NAME_NOT_RESOLVED (Code: -2)` 錯誤 (`ui/MyMapScreen.kt` & `webview/MyMapWebViewClient.kt`)**：
   - 在 `MyMapScreen.kt` 的 `Lifecycle.Event.ON_RESUME` 中：
     - 記錄 `webViewCreatedTimestampMs`。若距離建立未滿 `4_000L` 或 `isLoading == true`，僅呼叫 `wv.onResume()`，**絕不執行任何 `loadUrl` 或重載**。
     - 當從背景切回前景時，使用 `Handler(Looper.getMainLooper()).postDelayed({ ... }, 650L)` **延遲 650ms 等待 Android 系統喚醒 App 網路與 DNS 後**，檢查若 `MyMapWebViewClient.isNetworkAvailable(context)` 為 `true` 且（`webError != null` 或 `wv.url` 為空白/`chrome-error`），自動清除 `webError = null` 並重新載入 `resolveRecoveryUrl(currentUrl, MyMapWebViewClient.resolveInitialLoadUrl())`。
   - 在 `MyMapWebViewClient.onReceivedError` 中（當 `request.isForMainFrame` 為 `true`）：
     - 若錯誤為暫時性 DNS / 網路喚醒延遲（`error.errorCode == ERROR_HOST_LOOKUP` / `-2` 或 `description` 包含 `ERR_NAME_NOT_RESOLVED`），先呼叫 `view.stopLoading()` 並透過 `view.postDelayed({ ... }, 1_200L)` 在網路可用時自動重試一次 `view.loadUrl(request.url.toString())`，避免畫面卡在 Android 預設的 `網頁無法使用` 錯誤頁。

5. **更新單元測試與交接紀錄（請勿執行 build）**：
   - 同步更新 `UserAgentStrategyTest.kt` 以驗證新版 `buildSanitizedAuthUserAgent`、`isMyMapsUrl` 與 `isInteractiveGoogleSignInUrl`。
   - **請勿執行 `build.bat` 或 `gradlew` 編譯指令**（使用者會自行手動編譯）。
   - 完成後更新 `PROJECT_PLAN.md`：將 Phase 9 勾選為 `[x]` 並填寫「Phase 9 交接紀錄」。
```

---

## 【Phase 10 Prompt】修復點選地圖後「手機優化排版」下地圖空白消失（僅「原始桌面排版」正常）問題（不執行 build）

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（包含 Phase 1 ~ Phase 9 的交接紀錄與最新的 Phase 10 規格），並檢視現有的 `app/src/main/assets/inject_script.js`、`app/src/main/assets/inject_style.css` 與 `app/src/test/java/com/guiterevent/mygmap/JsBridgeAndAssetsTest.kt`。

現在請直接修改專案中的檔案，執行 **Phase 10：修復點選地圖後在「手機優化排版」下看不到任何地圖（切換為「原始桌面排版」地圖就出現）的問題**（注意：請務必直接寫入修改 `d:\CodeBase\GuiterEvent\MyGMap_guiter` 下的檔案；完成程式碼修改後**請勿執行 `build.bat` 或 `gradlew` 編譯**，我會自己執行）。

### 🔍 問題根因分析（必須精準修正）：
1. **手機窄螢幕視埠導致 `findLayerPanelByHeuristic()` 把「整張地圖共用容器」當成左側圖層面板藏起來！**
   - 我們注入了 `<meta name="viewport" content="width=device-width, initial-scale=1.0, ...">`，在手機上 `window.innerWidth` 約為 `360px ~ 412px`。
   - 現有 `inject_script.js` 的 `findLayerPanelByHeuristic()` 從 `#featurelist-pane` 往上檢查父層時使用 `rect.width <= 460 && rect.height >= window.innerHeight * 0.35`（最多爬 5 層）。
   - 因為在手機視埠下，**連同時包裹「左側面板 + 地圖畫布 (`#map-canvas` / `#lyra-canvas` / `.gm-style`)」的共用根容器寬度也 <= 460px**，導致迴圈直接往上爬到地圖共用根容器並標記 `data-mygmap-role="layer-panel"`！
   - 接著 `inject_style.css` 在預設收合狀態 (`body.mygmap-mobile-mode.mygmap-drawer-closed`) 下套用 `transform: translateX(-105%) !important; visibility: hidden !important;`，直接把**整張地圖 + 整個介面**一起移出螢幕左外側隱藏！當使用者切換成「原始桌面排版」（移除 `body.mygmap-mobile-mode`）時該 CSS 失效且觸發 `resize`，地圖就馬上出現了。
2. **隱藏左側面板後，Google Maps 畫布需要觸發 `resize` 事件才會重算 `100vw` 寬度並重繪圖磚**。

---

### 🛠️ 本階段實作要求：

1. **為 `inject_script.js` 實作地圖畫布保護機制，嚴禁將含地圖的容器標為 `layer-panel` (`assets/inject_script.js`)**：
   - 新增 helper 函式 `containsMapOrEditorRoot(el)`：
     - 若 `!el || el === document.body || el === document.documentElement`，回傳 `true`。
     - 若 `el` 本身符合或內部包含以下任一節點：`#map-canvas`、`#lyra-canvas`、`#map-container`、`.gm-style`、`canvas`、`#mapsprosearch-field`、`[role="toolbar"]`、`[data-mygmap-role="map-canvas"]`，一律回傳 `true`（代表這是地圖畫布或其共用根容器，**絕對禁止**被標記為 `layer-panel`）。
   - **調整 `scanAndTagDom()` 的執行順序與自我修復**：
     - **先標記地圖畫布 `[data-mygmap-role="map-canvas"]`**：尋找 `#map-canvas` 或 `#lyra-canvas`，若找不到則找 `.gm-style` 的外層地圖容器（需確認該容器不包含 `#featurelist-pane`）。
     - **自我修復清理**：檢查畫面上所有現存的 `[data-mygmap-role="layer-panel"]`，只要 `containsMapOrEditorRoot(el)` 為 `true`（或 `detectIsEditorPage()` 為 `false`），立即呼叫 `el.removeAttribute('data-mygmap-role')` 解除錯誤隱藏！
   - **重寫 `findLayerPanelByHeuristic()`**：
     - 若 `existingTagged` 已存在，必須同時滿足 `isElementUsable(existingTagged) && !containsMapOrEditorRoot(existingTagged)` 才沿用，否則先移除其 `data-mygmap-role`。
     - 當 `#featurelist-pane` 存在時，往上檢查 `parent` 最多 4 層，但只要符合下列**任一條件**就**立即 `break` 停止攀爬**（寧可只標記 `#featurelist-pane` 本身，也絕不爬進外層地圖共用容器）：
       1. `containsMapOrEditorRoot(parent)` 為 `true`（`parent` 含地圖、`canvas`、搜尋框或工具列）。
       2. `parent` 除了 `current` 之外，還有其他高度 `>= window.innerHeight * 0.30`、寬度 `>= 40` 的可見子元素（表示 `parent` 是左右或上下分割的版面共用容器，另一個兄弟節點就是地圖畫布！）。
       3. `pRect.width >= viewportWidth - 8` 且 `pRect.width > currentRect.width + 16`（代表 `parent` 是比 `#featurelist-pane` 更寬的全螢幕外殼）。
     - 第二階段結構啟發式掃描（未找到 `#featurelist-pane` 時）：必須僅在 `detectIsEditorPage() === true` 時才執行，嚴格跳過 `containsMapOrEditorRoot(candidate)` 為 `true` 的所有元素，並限制 `cRect.width <= Math.min(380, viewportWidth * 0.88)`。
   - **確保隱藏左側欄後觸發地圖重繪 (`resize`)**：
     - 當 `detectIsEditorPage() === true` 且 `helperState.mobileMode === true`，若偵測到地圖畫布且剛完成首次圖層面板抽屜套用（或切換至編輯頁）時，延遲 `120ms` 觸發一次 `window.dispatchEvent(new Event('resize'))`（可搭配防抖避免頻繁重複觸發），讓 Google Maps 圖磚以 `100vw` 滿版正常顯示。

2. **補強 `inject_style.css` 地圖畫布滿版與可視性規則 (`assets/inject_style.css`)**：
   - 在 `body.mygmap-mobile-mode #map-canvas, body.mygmap-mobile-mode #lyra-canvas, body.mygmap-mobile-mode [data-mygmap-role="map-canvas"]` 規則中，補充：
     - `right: 0 !important;`
     - `visibility: visible !important;`
     - `opacity: 1 !important;`
   - 保持所有現有 CSS3 選擇器名稱（`body.mygmap-mobile-mode`、`mygmap-drawer-closed`、`mygmap-drawer-open`、`#mapsprosearch-field`、`#addtomap-button`、`overscroll-behavior: contain`），不要使用 `:has()` 等舊 WebView 可能不支援的選擇器，以免破壞整條 CSS 規則解析與單元測試斷言。

3. **更新測試與交接紀錄（請勿執行 build）**：
   - 檢查並視需要擴充 `JsBridgeAndAssetsTest.kt`（驗證 `containsMapOrEditorRoot` 與 `inject_style.css` 地圖畫布可視規則存在）。
   - **請勿執行 `build.bat` 或 `gradlew` 編譯指令**（使用者會自行手動編譯）。
   - 完成後更新 `PROJECT_PLAN.md`：將 Phase 10 勾選為 `[x]` 並填寫「Phase 10 交接紀錄」。
```

---

## 【Phase 11 Prompt】修復點擊地圖圖釘內的「導航」按鈕無反應問題，直接喚起官方 Google Maps App 導航（不執行 build）

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（包含 Phase 1 ~ Phase 10 的交接紀錄與最新的 Phase 11 規格），並檢視現有的 `MyMapWebViewClient.kt`、`MapExportAndIntentHelper.kt`、`MyMapJsBridge.kt`、`MyMapScreen.kt`、`assets/inject_script.js` 與 `MapExportAndIntentHelperTest.kt`。

現在請直接修改專案中的檔案，執行 **Phase 11：修復在 Google 我的地圖點選圖釘後，點擊網頁「導航」按鈕沒有反應的問題，使其穩定喚起官方 Google Maps App 進行導航**（注意：請務必直接寫入修改 `d:\CodeBase\GuiterEvent\MyGMap_guiter` 下的檔案；完成程式碼修改後**請勿執行 `build.bat` 或 `gradlew` 編譯**，我會自己執行）。

### 🔍 「點選地圖上的點，然後點選導航，沒有反應」根因分析：
1. **WebView 設定 `setSupportMultipleWindows(false)` 且未實作 `WebChromeClient.onCreateWindow`**：
   - Google 我的地圖圖釘氣泡窗或詳情卡的「導航 / 規劃路線」連結，常透過 `<a target="_blank">` 或 `window.open("https://www.google.com/maps/dir/...", "_blank")` 開啟新分頁，導致目前 WebView 設定靜默吞掉新視窗請求而毫無反應。
2. **`shouldOverrideUrlLoading` 僅攔截非 `http/https` 協定**：
   - 目前對於 `https://www.google.com/maps/dir/...`、`https://maps.google.com/maps?...`、`https://www.google.com/maps/place/...`、`https://maps.app.goo.gl/...` 等 HTTPS Google Maps 導航連結皆回傳 `false`，未轉交給手機內的官方 Google Maps App (`com.google.android.apps.maps`)。
3. **網頁氣泡窗「導航 / 規劃路線」按鈕在編輯/檢視模式下的 JS 行為備援**：
   - 若氣泡窗內按鈕由 JavaScript 處理點擊（例如 `window.open` 或 Closure Library 事件未帶出跳轉），也需要從 JS 端擷取選取圖釘座標/標題或目標網址並橋接至 Android 原生 `MapExportAndIntentHelper` 啟動導航。

---

### 🛠️ 本階段實作要求：

1. **實作外部 Google Maps URL 辨識與直接喚起導航邏輯 (`webview/MapExportAndIntentHelper.kt`)**：
   - 新增 `fun isExternalGoogleMapsUrl(url: String?): Boolean`：
     - **明確排除** Google 我的地圖本身（`MyMapWebViewClient.isMyMapsUrl(url) == true` 或路徑為 `/maps/d` / `/maps/d/...` 以及 Google OAuth 登入網址）。
     - 當符合以下任一條件時回傳 `true`：
       - scheme 為 `google.navigation`、`geo` 或 `google.streetview`
       - host 為 `maps.app.goo.gl`，或 `goo.gl` 且 path 以 `/maps` 開頭
       - host 為 `maps.google.com`（含各國 Google Maps 網域如 `maps.google.*`）
       - host 為 `www.google.com` / `google.com`（含各國網域 `www.google.com.tw` 等）且 path 以 `/maps/dir`、`/maps/place`、`/maps/search`、`/maps/@` 開頭或 `path == "/maps"` / `"/maps/"`。
   - 新增 `fun extractDirectionsDestinationFromUrl(url: String?): String?`：
     - 嘗試從 `https://www.google.com/maps/dir/?api=1&destination=...`、`daddr=...`、`/maps/dir/.../<dest>`、`q=...`、`query=...` 或 `extractLatLngFromUrl(url)` 解析出目的地字串或 `"lat,lng"` 座標。
   - 新增 `fun openExternalMapsUrlInGoogleMapsApp(context: Context, rawUrl: String, navContext: MapNavigationContext? = null): Boolean`：
     - 若為 `geo:`、`google.navigation:`、`google.streetview:`：優先指定 `setPackage(GOOGLE_MAPS_PACKAGE)` 開啟。
     - 若為 `intent://`：使用 `Intent.parseUri(rawUrl, Intent.URI_INTENT_SCHEME)` 解析後開啟（必要時嘗試 fallback URL）。
     - 若為 HTTPS Google Maps 導航連結（如包含 `/maps/dir`、`daddr=`、`destination=`）：優先將解析出的目的地（或從 `navContext` 解析出的選取圖釘座標/標題）轉換為 `"google.navigation:q=..."` 並以 `setPackage(GOOGLE_MAPS_PACKAGE)` 喚起 Google Maps App 直接進入導航；若無從解析目的地則直接帶 `setPackage(GOOGLE_MAPS_PACKAGE)` 開啟 `rawUrl`。若裝置未安裝 Google Maps App (`ActivityNotFoundException`)，則自動降級使用不指定套件的一般 `Intent.ACTION_VIEW` 開啟 `rawUrl`。

2. **打通 `WebChromeClient.onCreateWindow` 與 `shouldOverrideUrlLoading` (`webview/MyMapWebViewClient.kt` & `ui/MyMapScreen.kt`)**：
   - 在 [`MyMapWebViewClient.configureWebView(webView)`](file:///d:/CodeBase/GuiterEvent/MyGMap_guiter/app/src/main/java/com/guiterevent/mygmap/webview/MyMapWebViewClient.kt) 中，將 `setSupportMultipleWindows(true)` 與 `javaScriptCanOpenWindowsAutomatically = true` 開啟。
   - 在 `MyMapWebViewClient.shouldOverrideUrlLoading` 中（於外部協定處理後、`currentUaMode` 判斷前）：
     - 若 `MapExportAndIntentHelper.isExternalGoogleMapsUrl(url)` 為 `true`，呼叫 `MapExportAndIntentHelper.openExternalMapsUrlInGoogleMapsApp(view.context, url)` 並回傳 `true`！
   - 在 [`MyMapScreen.kt`](file:///d:/CodeBase/GuiterEvent/MyGMap_guiter/app/src/main/java/com/guiterevent/mygmap/ui/MyMapScreen.kt) 的 `webChromeClient` 實作 `override fun onCreateWindow(view: WebView?, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?): Boolean`：
     - 建立一個暫時性的隱藏 `WebView`，掛上簡易 `WebViewClient` 於 `shouldOverrideUrlLoading` 擷取新視窗的 URL：
       - 若該 URL 為 `MapExportAndIntentHelper.isExternalGoogleMapsUrl(url)` 或外部協定 (`intent:` / `geo:` / `google.navigation:`)，立即呼叫 `MapExportAndIntentHelper.openExternalMapsUrlInGoogleMapsApp(ctx, url)` 並安全 `destroy()` 該暫時 WebView。
       - 若該 URL 仍屬站內一般 `http/https` 網頁（如 Google 登入或我的地圖連結），則改以原本主 `view.loadUrl(url)`（或 `MyMapWebViewClient.loadUrlWithLockedUa(view, url)`）載入並 `destroy()` 暫時 WebView。
     - 將暫時 `WebView` 放入 `(resultMsg.obj as? WebView.WebViewTransport)?.webView`，執行 `resultMsg.sendToTarget()` 並回傳 `true`（搭配若數秒內未觸發載入則自動釋放暫時 WebView 防洩漏機制）。

3. **新增 JS 端 `window.open` 與氣泡窗「導航」點擊備援 (`assets/inject_script.js` & `webview/MyMapJsBridge.kt` & `ui/MyMapScreen.kt`)**：
   - 在 [`MyMapJsBridge.kt`](file:///d:/CodeBase/GuiterEvent/MyGMap_guiter/app/src/main/java/com/guiterevent/mygmap/webview/MyMapJsBridge.kt) 新增 `@JavascriptInterface fun onExternalNavigationRequested(targetUrl: String?, contextJson: String?)`，透過 `mainHandler.post` 傳遞給 `MyMapScreen.kt`：
     - 解析 `contextJson` 為 `MapNavigationContext`（使用現有 `MapExportAndIntentHelper.parseNavigationContextJson`）。
     - 若 `targetUrl` 非空且為外部 Google Maps 網址，呼叫 `MapExportAndIntentHelper.openExternalMapsUrlInGoogleMapsApp(context, targetUrl, navContext)`；否則呼叫 `MapExportAndIntentHelper.launchGoogleMapsApp(context, GoogleMapsLaunchMode.NAVIGATION, navContext, currentGpsCoordinates)` 直接開啟 Google Maps App 導航！
   - 在 [`inject_script.js`](file:///d:/CodeBase/GuiterEvent/MyGMap_guiter/app/src/main/assets/inject_script.js) 中：
     - 安全包裝一次 `window.open`：若第一個參數 `url` 屬於 Google Maps 導航/地點連結（非 `/maps/d/`），直接呼叫 `window.AndroidBridge.onExternalNavigationRequested(String(url), JSON.stringify(extractNavigationContext()))` 並回傳 `null`（其餘呼叫照常委派給原始 `window.open`）。
     - 增強 `extractNavigationContext()`：除了 `#map-infowindow-container`，同步支援從 `.gm-style-iw`、`[role="dialog"]` 或選取圖釘詳情卡片讀取標題、`<a>` 連結座標與經緯度文字。
     - 在全域 `click` 監聽（非 Inspect Mode 時）偵測氣泡窗 / 詳情卡內的導航連結與按鈕（例如：`a[href*="/maps/dir"]`、`a[href*="maps.google.com"]`、`#map-infowindow-directions-button` 或位於氣泡窗內的 `[aria-label*="導航"]` / `[aria-label*="規劃路線"]` / `[aria-label*="Directions"]` / `[data-tooltip*="導航"]` / `[data-tooltip*="規劃路線"]` / `[data-tooltip*="Directions"]`）：
       - 若點擊對象包含 `href` 指向外部 Google Maps 連結，直接 `preventDefault()` 並呼叫 `window.AndroidBridge.onExternalNavigationRequested(href, JSON.stringify(extractNavigationContext()))`。
       - 若該按鈕沒有直接 `href`（由網頁 JS 處理），延遲 `220ms` 檢查（若此期間網頁未發生跳轉且 `window.open` 未觸發），若目前成功擷取到選取圖釘的座標或標題，立刻呼叫 `window.AndroidBridge.onExternalNavigationRequested("", JSON.stringify(extractNavigationContext()))` 直接喚起 Google Maps App 導航！
   - 在 [`inject_style.css`](file:///d:/CodeBase/GuiterEvent/MyGMap_guiter/app/src/main/assets/inject_style.css) 的 InfoWindow 按鈕樣式區順手將 `#map-infowindow-directions-button` 與氣泡窗內 `a[href*="/maps/dir"]` 加入觸控熱區保護（`min-height: 42px`, `min-width: 44px`）。

4. **更新單元測試與交接紀錄（請勿執行 build）**：
   - 在 `MapExportAndIntentHelperTest.kt` 擴充測試 `isExternalGoogleMapsUrl`（確認 `/maps/dir/...`、`maps.google.com`、`maps.app.goo.gl` 回傳 `true`，而 `/maps/d/edit`、`/maps/d/viewer`、`accounts.google.com` 回傳 `false`）與 `extractDirectionsDestinationFromUrl`（解析 `destination=`、`daddr=`、`/maps/dir//25.033964,121.564468`）。
   - 更新 `JsBridgeAndAssetsTest.kt`（如有需要）。
   - **請勿執行 `build.bat` 或 `gradlew` 編譯指令**（使用者會自行手動編譯）。
   - 完成後更新 `PROJECT_PLAN.md`：將 Phase 11 勾選為 `[x]` 並填寫「Phase 11 交接紀錄」。
```

---

## 【Phase 12 Prompt】POI 點選氣泡窗行動版美化 + 原生 Material 3 底部 POI 資訊快捷卡（不執行 build）

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（包含 Phase 1 ~ Phase 11 的交接紀錄與最新的 Phase 12 規格），並檢視現有的 `app/src/main/assets/inject_style.css`、`app/src/main/assets/inject_script.js`、`MyMapJsBridge.kt`、`WebViewInjector.kt`、`MyMapScreen.kt` 與 `JsBridgeAndAssetsTest.kt`。

現在請直接修改專案中的檔案，執行 **Phase 12：美化點選地圖圖釘 (POI) 後的氣泡窗排版，並新增單手好按的原生 Material 3 底部 POI 資訊快捷卡 (`SelectedPinBottomCard`)**（注意：請務必直接寫入修改 `d:\CodeBase\GuiterEvent\MyGMap_guiter` 下的檔案；完成程式碼修改後**請勿執行 `build.bat` 或 `gradlew` 編譯**，我會自己執行）。

### 🔍 目前 POI 氣泡窗的視覺與操作痛點（務必全部改善）：
1. **桌面版氣泡窗 (`#map-infowindow-container` / `.gm-style-iw`) 在手機直向螢幕寬度溢出與裁字**：
   - 標題、地址及「在『Google 地圖』檢視」會被右邊緣切斷並出現底部水平捲軸；經緯度座標與底部小圖示按鈕（樣式、編輯、相片、導航、刪除）容易貼邊或被截斷，在手機上極難點擊。
   - 標題下方常有一段過大的空白區域，「Google 地圖詳細資料」區塊視覺較生硬。
2. **純網頁浮動氣泡窗受限於圖釘在畫布上的位置，不適合手機單手操作**：
   - 若結合**「網頁氣泡窗 CSS 淨化美化」＋「原生 Material 3 底部 POI 快捷資訊卡」**，點選地圖上的任意 POI 時，既能擁有滑順現代的底部卡片體驗（一指點選 🧭 導航 / 🏙️ 街景 / ✏️ 編輯 / 📋 複製座標），又能在進入編輯或切換成「原始桌面排版 (逃生門)」時完整保留官方功能！

---

### 🛠️ 本階段實作要求：

1. **全面美化網頁內浮動氣泡窗 CSS (`assets/inject_style.css`)**（所有規則仍必須嚴格限定於 `body.mygmap-mobile-mode` 下，確保「原始桌面排版」逃生門 100% 有效）：
   - **消除左右裁字與水平捲軸**：
     - 針對 `.gm-style-iw-c`、`.gm-style-iw-d`、`#map-infowindow-container` 與內部所有直接容器設定 `max-width: calc(100vw - 28px) !important`、子元素 `max-width: 100% !important`、`overflow-x: hidden !important`、`box-sizing: border-box !important`。
     - 對氣泡窗內的標題、內文與連結強制設定 `white-space: normal !important; word-break: break-word !important; overflow-wrap: anywhere !important;`（確保長標題與「在『Google 地圖』檢視」不再被右邊緣截斷）。
   - **卡片圓角、留白整理與詳細資料美化**：
     - 為 `.gm-style-iw-c` 加上 `border-radius: 16px !important`、`box-shadow: 0 12px 30px rgba(15, 23, 42, 0.22) !important`、`padding: 10px 12px !important`。
     - 精簡 `#map-infowindow-container` 內部過高的 `min-height` / 多餘上下 `margin` 與 `padding`（消除標題與「Google 地圖詳細資料」之間的大塊空白）。
     - 美化氣泡窗內的詳細資料區塊與 `a[href*="maps"]` 連結（柔和淺灰藍背景 `#F8FAFC`、細邊框 `#E2E8F0`、`border-radius: 10px`、清晰內距與行高）。
   - **氣泡窗底部按鈕列對齊與觸控美化**：
     - 針對氣泡窗底部按鈕所在列及按鈕（`#map-infowindow-edit-button`、`#map-infowindow-delete-button`、`#map-infowindow-directions-button`、`#map-infowindow-done-editing-button`、`#map-infowindow-cancel-editing-button` 等）設定 `flex-wrap: wrap !important`、`gap: 6px !important`、圓角底色與足夠觸控大小，確保所有圖示都能完整顯示在卡片內、不會突出螢幕外。

2. **偵測氣泡窗開啟並即時傳送 POI 詳細資訊給 Android (`assets/inject_script.js` & `webview/MyMapJsBridge.kt` & `webview/WebViewInjector.kt`)**：
   - 在 `inject_script.js` 新增 `extractSelectedPinUiState()`：
     - 檢查目前畫面上是否有展開且可見的氣泡窗（`#map-infowindow-container` / `.gm-style-iw`）。
     - 若氣泡窗未展開，回傳 `{ visible: false }`；若已展開，盡可能擷取：
       - `visible: true`
       - `title`: 圖釘名稱（優先從氣泡窗標題節點或第一個 `[id^="map-infowindow-attr-"]` 讀取，並過濾空白）
       - `details`: 整理後的詳細資料 / 地址 / 備註摘要（排除重複的標題、評分數字與經緯度純座標字串，保留如地址或自訂說明）
       - `rating`: 若氣泡窗內含 Google 地圖詳細資料評分（如 `4.6`），擷取出來（選填）
       - `coordinates`: 若擷取到座標，格式化為 `"lat, lng"` 字串；同時提供 `lat` 與 `lng` 數值
       - `isEditMode`: 判斷目前氣泡窗是否正在編輯輸入狀態（例如 `#map-infowindow-done-editing-button` 可見或氣泡窗內有可編輯 `input`/`textarea`/`contenteditable="true"`）
   - 新增 `reportSelectedPinStateIfChanged()`：在 `scanAndTagDom()`、點擊地圖後、以及既有的節流 `MutationObserver` 回呼中檢查序列化快照是否有變化，有變化才呼叫 `window.AndroidBridge.onSelectedPinStateChanged(json)`，避免無謂重複觸發。
   - 在 `inject_script.js` 公開 `window.MyGMapHelper.triggerInfoWindowEdit()`（尋找並 `simulateClick` `#map-infowindow-edit-button`）與 `window.MyGMapHelper.closeInfoWindow()`（點擊氣泡窗關閉按鈕，例如 `.gm-style-iw button.gm-ui-hover-effect`、`#map-infowindow-close-button` 或 `[aria-label*="關閉"]` / `[aria-label*="Close"]`）。
   - 在 `WebViewInjector.kt` 加入對應的 `triggerInfoWindowEdit(webView, onResult)` 與 `closeInfoWindow(webView)` 包裝方法。
   - 在 `MyMapJsBridge.kt` 新增：
     - `data class SelectedPinInfo(val visible: Boolean = false, val title: String = "", val details: String = "", val rating: String = "", val coordinates: String = "", val lat: Double? = null, val lng: Double? = null, val isEditMode: Boolean = false)`
     - `companion object` 新增 `fun parseSelectedPinInfo(jsonStr: String): SelectedPinInfo`（內建與 `parseDomInspectInfo` 相同的純 JVM 單元測試正規表示式備援解析！）。
     - 新增 `@JavascriptInterface fun onSelectedPinStateChanged(infoJson: String)` 與建構子回呼 `onSelectedPinStateChangedCallback: (SelectedPinInfo) -> Unit = {}`。

3. **實作「原生 Material 3 底部 POI 資訊快捷卡 (`SelectedPinBottomCard`)」(`ui/MyMapScreen.kt`)**：
   - 在 `MyMapScreen.kt` 新增狀態 `selectedPinInfo: SelectedPinInfo?`（當離開編輯頁或重新載入頁面時重設為 `null`）。
   - 當 `selectedPinInfo?.visible == true && !selectedPinInfo.isEditMode && webError == null && !isOffline`（且 `activeSearchQuery == null` 或優先於搜尋提示條）時，在畫布底部（`BottomActionBar` 正上方）透過 `AnimatedVisibility` 顯示質感極佳的 **`SelectedPinBottomCard`**：
     - 採用高質感 Material 3 `Surface` 卡片（圓角 `18.dp`、微陰影 `10.dp`、白色背景搭配 `#E2E8F0` 細邊框、左側 Google 藍重點強調條或小圖釘徽章）。
     - **標題區**：顯示 `selectedPinInfo.title`（粗體 `15.sp`，最多 2 行）＋ 右上角精緻關閉按鈕 (`Icons.Default.Close`，點擊時收合卡片並呼叫 `WebViewInjector.closeInfoWindow(wv)`）。
     - **資訊摘要區**：
       - 若有 `rating` 或 `details`，以淺灰小卡 (`#F8FAFC`) 呈現地址 / 詳細資料與 ⭐ 評分（最多 2 行，清爽不佔空間）。
       - 若有 `coordinates`（`lat, lng`），顯示為可點擊複製的等寬字型圓角小膠囊（點擊立即複製座標並 Toast 提示 `📋 已複製座標`）。
     - **單手快捷操作按鈕列**（圓角膠囊 / FilledTonal 按鈕，好按不誤觸）：
       1. **「🧭 導航」**（主色調醒目實心按鈕）：將 `selectedPinInfo` 組裝為 `MapNavigationContext`（帶入 `mid`、`selectedPinTitle`、`selectedPinLat`、`selectedPinLng`），一鍵呼叫 `MapExportAndIntentHelper.launchGoogleMapsApp(context, GoogleMapsLaunchMode.NAVIGATION, ...)` 直接開始 Google Maps 導航！
       2. **「🏙️ 街景」**（若有有效座標）：一鍵呼叫 `MapExportAndIntentHelper.launchGoogleMapsApp(context, GoogleMapsLaunchMode.STREET_VIEW, ...)` 查看 360° 街景！
       3. **「✏️ 編輯」**：呼叫 `WebViewInjector.triggerInfoWindowEdit(wv)` 進入網頁氣泡窗編輯模式（進入編輯模式後原生卡會自動暫時隱藏，讓出空間給鍵盤與輸入框）。
       4. **「🗺️ 在 Maps 開啟」**：一鍵呼叫 `GoogleMapsLaunchMode.PLACE_PIN` 在官方 Google Maps App 檢視該地點完整店家評價與資訊。
   - **排版避讓協調**：動態調整右下角 `ExtendedFloatingActionButton`（「📍 標記目前位置」）的 `bottom` padding（或當 `SelectedPinBottomCard` 顯示時，將 FAB 暫時向上移動或隱藏避讓，確保 FAB 絕對不會壓在 POI 卡片文字或按鈕上方！）。

4. **更新單元測試與交接紀錄（請勿執行 build）**：
   - 在 `JsBridgeAndAssetsTest.kt` 新增 `parseSelectedPinInfo` 單元測試（含正常顯示、編輯模式與空值狀態），並擴充檢查 `inject_style.css` 與 `inject_script.js` 新增的 POI 美化與 `onSelectedPinStateChanged` 規則。
   - **請勿執行 `build.bat` 或 `gradlew` 編譯指令**（使用者會自行手動編譯）。
   - 完成後更新 `PROJECT_PLAN.md`：將 Phase 12 勾選為 `[x]` 並填寫「Phase 12 交接紀錄」。
```

---

## 【Phase 13 Prompt】修正點選 Maps / 導航時地點微幅偏移問題（對齊純網頁版官方地標）（不執行 build）

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（包含 Phase 1 ~ Phase 12 的交接紀錄與最新的 Phase 13 規格），並檢視現有的 `app/src/main/assets/inject_script.js`、`MapExportAndIntentHelper.kt`、`MyMapJsBridge.kt`、`MyMapScreen.kt` 與 `MapExportAndIntentHelperTest.kt`。

現在請直接修改專案中的檔案，執行 **Phase 13：修正點選原生卡片「Maps」或「導航」按鈕時，Google Maps App 落點與純網頁版（「在 Google 地圖檢視」）存在微幅偏移的問題**（注意：請務必直接寫入修改 `d:\CodeBase\GuiterEvent\MyGMap_guiter` 下的檔案；完成程式碼修改後**請勿執行 `build.bat` 或 `gradlew` 編譯**，我會自己執行）。

### 🔍 落點存在微幅偏移的根因分析：
1. **Google Maps 網址中的 `/@lat,lng` 是攝影機視角中心，`!3dLAT!4dLNG` 才是真實地標座標**：
   - 目前 `inject_script.js` 的 `parseLatLngPairFromString()` 與 `MapExportAndIntentHelper.kt` 的 `extractLatLngFromUrl()` 掃描 `a[href]` 連結時，只要碰到網址前面的 `/@68.51...,17.01...` 就立刻回傳該畫面中心座標，完全忽略後面真正精確的 **`!3dLAT!4dLNG`** 圖釘座標！
2. **純網頁版點擊的是氣泡窗官方「在『Google 地圖』檢視」(`placeUrl`) 連結，但我們原生卡片把它簡化成了純座標**：
   - 在 Google 我的地圖中，連結到 Google 地點的圖釘在氣泡窗底部顯示的純文字經緯度經常只有 5 位小數或對應草點（例如截圖中的 `68.513580, 17.017830`），而卡片上藍色的 **`在「Google 地圖」檢視`** `<a>` 連結（含 `/maps/place/...`、`cid=`、`ftid=`、`!3d!4d`）才真正指向 Google 地圖上的官方地標實體（如左側的 `Bogen Hostel as`）。
   - 目前 `extractSelectedPinUiState()` 沒有保存這個 `placeUrl` / `directionsUrl`，導致「🗺️ Maps」與「🧭 導航」只送出 `geo:lat,lng` / `google.navigation:q=lat,lng`，與純網頁版直接開啟真實地標產生落差！

---

### 🛠️ 本階段實作要求：

1. **修正 Google Maps 網址座標解析優先序：永遠優先解析 `!3d...!4d...` (`assets/inject_script.js` & `webview/MapExportAndIntentHelper.kt`)**：
   - 在 `inject_script.js` 新增 **`extractExactCoordsFromMapsUrl(rawUrl)`**，並在 `MapExportAndIntentHelper.extractLatLngFromUrl(url)` 採用完全一致的優先順序：
     1. **第一順位（最高精度真實圖釘）**：擷取 `!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)`（若同一網址有多組，取最後一組最靠近實體的 `!3d...!4d...`）。
     2. **第二順位（明確目標參數）**：`destination=`、`daddr=`、`query=`、`q=`、`ll=`、`sll=`、`cbll=`、`viewpoint=`、`center=`。
     3. **第三順位（最後備援）**：路徑中的 `/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)`（畫面視角中心）。
   - 保持高精度座標小數（不要強制切斷成低位數，格式化字串可使用最多 7 位小數並去除無效尾零，或直接保留原小數精度）。

2. **從氣泡窗擷取官方 `placeUrl`、`directionsUrl` 與官方地標名稱 (`assets/inject_script.js` & `webview/MyMapJsBridge.kt`)**：
   - 在 `inject_script.js` 新增 `findInfoWindowActionUrls(container)`，遍歷 `#map-infowindow-container` / `.gm-style-iw` 內的所有 `a[href]`：
     - **`directionsUrl`**：符合 `/maps/dir`、`daddr=` 或 `destination=` 的連結。
     - **`placeUrl`**：文字包含 `Google 地圖` / `View in Google Maps` / `檢視`，或網址包含 `/maps/place`、`cid=`、`ftid=`、`ludocid=`、`maps.google.`、`maps.app.goo.gl`、`goo.gl/maps` 的連結（排除 `/maps/dir` 與 `/maps/d/`）。
   - 修改 `extractPinCoordinatesFromContainer(container)`：
     - **優先**從 `directionsUrl` 與 `placeUrl` 透過 `extractExactCoordsFromMapsUrl` 提取真實 `!3d!4d`（或明確查詢參數）座標；若官方連結僅含 `cid=`/`ftid=` 而無 `!3d!4d`，再檢查 `data-lat`/`data-lng`，最後才退回 `container.innerText` 中的座標文字（避免畫面視角 `/@lat,lng` 蓋過正確座標）。
   - 在 `extractSelectedPinUiState()` 與 `extractNavigationContext()` 回傳 JSON 中新增 **`placeUrl`** 與 **`directionsUrl`** 欄位（`extractSelectedPinUiState()` 也加入這兩欄供 `SelectedPinInfo` 接收，同時維持原有 JSON 欄位不變）。
   - 在 `MyMapJsBridge.kt` 的 `SelectedPinInfo` 新增 `val placeUrl: String = ""` 與 `val directionsUrl: String = ""`，並在 `parseSelectedPinInfo`（含 JVM fallback parser）完整解析之。

3. **在 `MapExportAndIntentHelper.kt` 與 `MyMapScreen.kt` 優先使用 `placeUrl` / `directionsUrl` 對齊純網頁版結果**：
   - 在 `MapNavigationContext` 新增 `val placeUrl: String = ""` 與 `val directionsUrl: String = ""`，並更新 `parseNavigationContextJson` 解析這兩個欄位。
   - 修改 `MapExportAndIntentHelper.resolveGoogleMapsTargetUris` 與 `launchGoogleMapsApp`：
     - **`GoogleMapsLaunchMode.PLACE_PIN`（「🗺️ 在 Maps 開啟」）**：
       - 若 `navContext.placeUrl` 非空且為有效的外部 Google Maps 網址（如 `/maps/place/...`、`cid=`、`ftid=`），**直接回傳並以 `setPackage(GOOGLE_MAPS_PACKAGE)` 開啟 `navContext.placeUrl`**（完全對齊純網頁版點擊「在 Google 地圖檢視」的真實地點目標，不再硬轉成可能偏差的 `geo:lat,lng`）！
       - 若沒有 `placeUrl` 時才退回原本的 `buildPlacePinUris(bestCoords, bestQuery)`。
     - **`GoogleMapsLaunchMode.NAVIGATION`（「🧭 導航」）**：
       - 若 `navContext.directionsUrl` 非空，優先從 `directionsUrl` 提取高精準 `!3d!4d` / `destination=` 建構導航（或直接開啟 `directionsUrl`）。
       - 若無 `directionsUrl` 但 `navContext.placeUrl` 非空：
         1. 若 `placeUrl` 內有明確 `!3dLAT!4dLNG` 或 `destination=` / `q=` 座標，優先使用該精確座標（避免氣泡窗純文字 5 位數座標微幅偏移）。
         2. 若 `placeUrl` 帶有 Google 地點識別（例如 `cid=` / `ftid=` / `/maps/place/<地點名稱>/`）而無 `!3d!4d` 座標，可從 `/maps/place/<PlaceName>/` 或 `details` 中的官方地址搭配 `bestCoords` / 官方地標連結確保對準同一地點：具體來說，若 `placeUrl` 僅有 `cid=`/`ftid=` 或 `/maps/place/` 而沒有 `!3d!4d` 時，優先以官方 Google 地圖詳情（如 `/maps/place/` 路徑解析出的官方地名＋地址）或直接改用 `https://www.google.com/maps/dir/?api=1&destination=...`（若無座標才用文字，若有 `!3d!4d` 則用 `google.navigation:q=!3dLat,!4dLng`；同時若使用者只是對某張有 `placeUrl` 但無 `!3d!4d` 的地標點導航且原座標與官方地標名不同，若 `extractDirectionsDestinationFromUrl(placeUrl)` 解析到精確座標則用精確座標，否則若只有 `cid=`/`ftid=` 可直接保留 `placeUrl` 內座標或文字搜尋輔助對齊）。
   - 在 `MyMapScreen.kt` 中 `SelectedPinBottomCard` 的 `buildNavContext` 內，將 `placeUrl = pin.placeUrl` 與 `directionsUrl = pin.directionsUrl` 傳入 `MapNavigationContext`！

4. **更新單元測試與交接紀錄（請勿執行 build）**：
   - 在 `MapExportAndIntentHelperTest.kt` 新增測試案例：
     - 驗證 `extractLatLngFromUrl` 在同時存在 `/@68.51358,17.01783,16z` 與 `!3d68.514123!4d17.012345` 時，**正確回傳 `!3d!4d`（`68.514123, 17.012345`）而非 `@` 畫面中心**！
     - 驗證 `resolveGoogleMapsTargetUris(PLACE_PIN, ...)` 在具備 `placeUrl`（例如 `https://maps.google.com/?cid=123456` 或 `/maps/place/...`）時優先使用 `placeUrl`。
   - 在 `JsBridgeAndAssetsTest.kt` 更新 `parseSelectedPinInfo` 測試驗證 `placeUrl` / `directionsUrl` 欄位解析。
   - **請勿執行 `build.bat` 或 `gradlew` 編譯指令**（使用者會自行手動編譯）。
   - 完成後更新 `PROJECT_PLAN.md`：將 Phase 13 勾選為 `[x]` 並填寫「Phase 13 交接紀錄」。
```

---

## 【Phase 14 Prompt】徹底修復圖層管理抽屜無法點擊、不能上下滑動、無法新增圖層與更改樣式問題（不執行 build）

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（包含 Phase 1 ~ Phase 13 的交接紀錄與最新的 Phase 14 規格），並檢視現有的 `app/src/main/assets/inject_style.css`、`app/src/main/assets/inject_script.js` 與 `app/src/test/java/com/guiterevent/mygmap/JsBridgeAndAssetsTest.kt`。

現在請直接修改專案中的檔案，執行 **Phase 14：徹底修復開啟「🗂️ 圖層」抽屜後，圖層管理頁面完全無法點擊、不能上下滑動、無法新增圖層、無法更改圖層樣式，也無法開啟/關閉圖層的問題**（注意：請務必直接寫入修改 `d:\CodeBase\GuiterEvent\MyGMap_guiter` 下的檔案；完成程式碼修改後**請勿執行 `build.bat` 或 `gradlew` 編譯**，我會自己執行）。

### 🔍 圖層管理抽屜完全無法互動與捲動的三大根因：
1. **CSS Stacking Context（堆疊上下文）陷阱導致 `#mygmap-drawer-backdrop` 蓋在整個圖層面板正上方！**
   - `#mygmap-drawer-backdrop` 直接附加於 `document.body`，設定了 `position: fixed; left: 0; width: 100vw; height: 100vh; z-index: 9985 !important; pointer-events: auto !important; touch-action: none !important;`。
   - 然而 `#featurelist-pane` (`[data-mygmap-role="layer-panel"]`) 位於 Google 我的地圖帶有獨立 `z-index`（如 `z-index: 1 ~ 10`）或 `transform` 的外層父容器中，導致抽屜就算設了 `z-index: 9990`，依然被父層鎖在較低堆疊層級！
   - 結果 `document.body > #mygmap-drawer-backdrop` (`9985`) **整片壓在圖層面板上**，吃光了所有點擊與上下滑動手勢（同時把抽屜灰暗化）！
2. **圖層內層的 `touch-action: none`、固定寫死高度與 `overflow: hidden` 鎖死了上下捲動**：
   - Google 我的地圖為了桌面滑鼠拖曳排序圖層，會在 `#featurelist-pane` 內部節點設定 `touch-action: none`、`overflow: hidden` 或固定高度，導致手機觸控上下滑動完全沒反應。
3. **Google Closure 選單、調色盤與樣式對話框 (`goog-menu` / `[role="menu"]` / `[role="dialog"]`) 的 `z-index` 低於抽屜 `9990`**：
   - 當點擊「新增圖層」、「圖層樣式」、「個別樣式」或「三點選單 (⋮)」時，Google 會把選單／彈窗加在 `document.body` 下，但預設 `z-index` 小於 `9990`，導致選單開在抽屜或遮罩背後完全看不到也點不到！

---

### 🛠️ 本階段實作要求：

1. **從物理位置徹底移除遮罩重疊，並解除私有外殼父層的堆疊/裁切鎖定 (`assets/inject_style.css` & `assets/inject_script.js`)**：
   - **讓 `#mygmap-drawer-backdrop` 永遠只覆蓋抽屜右側的空隙區域**：
     - 在 `inject_style.css` 將 `#mygmap-drawer-backdrop` 的右側與寬度調整為 `right: 0 !important; width: auto !important;`（左邊保留給抽屜，預設可設 `left: 340px` 作退讓），並在 `inject_script.js` 的 `applyBodyClasses()` / `syncDrawerBackdropBounds()` 中，依實際 `[data-mygmap-role="layer-panel"]` 寬度（或 `Math.min(Math.round(window.innerWidth * 0.85), 340)`）動態將 `backdrop.style.setProperty('left', drawerWidthPx + 'px', 'important')`！
     - 這樣 `#mygmap-drawer-backdrop` **物理上絕對不會覆蓋左側圖層面板的任何 1 像素**，從根源杜絕遮罩吃掉觸控或滑動！
   - **私有外殼父層解鎖 (`layer-panel-shell`)**：
     - 在 `inject_script.js` 新增 helper（於 `scanAndTagDom()` / `setDrawerOpen()` 呼叫）：從 `[data-mygmap-role="layer-panel"]` 往上檢查父層（僅限 `el !== document.body && el !== document.documentElement && !containsMapOrEditorRoot(el)`，也就是不包住地圖畫布的圖層私有外框），為其標記 `data-mygmap-role="layer-panel-shell"`（抽屜關閉或非手機模式時清除）。
     - 在 `inject_style.css` 的 `body.mygmap-mobile-mode.mygmap-drawer-open [data-mygmap-role="layer-panel-shell"]` 強制設定：`z-index: 9988 !important; overflow: visible !important; pointer-events: auto !important; transform: none !important;`（保證不會被外層 `overflow: hidden` 或低 `z-index` 鎖死或裁切！）。

2. **強制解除 `#featurelist-pane` 與內部列表的滑動封鎖，並確保高層級操作與底部留白 (`assets/inject_style.css` & `assets/inject_script.js`)**：
   - 在 `inject_style.css` 的 `body.mygmap-mobile-mode.mygmap-drawer-open` 下：
     - 對 `[data-mygmap-role="layer-panel"]` 與 `#featurelist-pane`：強制 `pointer-events: auto !important;`、`touch-action: pan-y !important;`、`overflow-y: auto !important;`、`overflow-x: hidden !important;`、`-webkit-overflow-scrolling: touch !important;`、`overscroll-behavior: contain !important;`、`padding-bottom: 84px !important;`（避免最底部的圖層項目或按鈕被右下方 GPS 懸浮按鈕擋住）。
     - 對 `[data-mygmap-role="layer-panel"] *` 與 `#featurelist-pane *`：強制 `touch-action: pan-y !important;`（徹底覆寫 Google 桌面版拖曳排序留下的 `touch-action: none`，確保手指在任何項目上都能流暢上下滑動！），並且為可捲動子容器（如 `[id*="featurelist"]`、`[class*="scrollable"]`）解除過小的高度鎖定與 `overflow-y: auto !important;`；對互動元素（`button, [role="button"], [role="checkbox"], input, a, label`）明確加上 `pointer-events: auto !important; cursor: pointer !important;`。
   - **修正既有過度粗暴的按鈕尺寸規則**：
     - 檢視 `inject_style.css` 原本的 `#featurelist-pane [role="button"] { min-height: 44px !important; min-width: 44px !important; }`，確認不會把原本緊湊的圖層整列外框或圖標撐壞或遮住旁邊的開關核取方塊 (`[role="checkbox"]`)，建議改為對 `[role="checkbox"]`、圖層三點選單、樣式按鈕與「新增圖層」按鈕給予合適而不破版的點擊區域（例如 `min-height: 36px; min-width: 36px;` 或只針對頂部操作列/按鈕放寬，避免內嵌整列 `[role="button"]` 被撐成異常寬度）。

3. **提昇 Google Closure 彈出選單、圖層樣式選擇器與對話框層級 (`assets/inject_style.css`)**：
   - 在 `body.mygmap-mobile-mode` 下，將下列彈出層統一提升至 `z-index: 10050 !important; pointer-events: auto !important;`（確保高於抽屜 `9990` 與遮罩 `9985`）：
     - `.goog-menu`、`.goog-menu-vertical`、`.goog-popup`、`.goog-popupcolorpicker`
     - `[role="menu"]`、`[role="listbox"]`、`[role="dialog"]`
     - `.modal-dialog`、`.modal-dialog-bg`（`.modal-dialog-bg` 設為 `z-index: 10040 !important`）
     - `[class*="colorpicker"]`、`[class*="palette"]`
   - 並讓 `.goog-menu` / `[role="dialog"]` 寬度受限於 `max-width: calc(100vw - 24px) !important; box-sizing: border-box !important; overflow-y: auto !important; max-height: 80vh !important;`，防止新增圖層/更改樣式/重新命名彈窗超出手機螢幕。
   - 在 `inject_script.js` 的 `setDrawerOpen(true)` 時，於 DOM 套用後觸發一次 `window.dispatchEvent(new Event('resize'))` 並確保 Google 列表重新計算滾動區；同時確認點擊 `[role="menu"]`、`.goog-menu`、`[role="dialog"]` 或 `[data-mygmap-role="layer-panel"]` 內部時不會誤關抽屜。

4. **更新單元測試與交接紀錄（請勿執行 build）**：
   - 在 `JsBridgeAndAssetsTest.kt` 擴充斷言驗證：
     - `inject_style.css` 包含 `touch-action: pan-y`、`.goog-menu` / `[role="menu"]` 高層級規則、`layer-panel-shell` 與 `#mygmap-drawer-backdrop` 右側對齊 (`right: 0 !important`) 規則。
     - `inject_script.js` 包含抽屜寬度同步遮罩位置邏輯與 `layer-panel-shell` 解鎖處理，並以 `node --check app/src/main/assets/inject_script.js` 檢查語法正確。
   - **請勿執行 `build.bat` 或 `gradlew` 編譯指令**（使用者會自行手動編譯）。
   - 完成後更新 `PROJECT_PLAN.md`：將 Phase 14 勾選為 `[x]` 並填寫「Phase 14 交接紀錄」。
```

---

## 【Phase 15 Prompt】以原生 Material 3「✏️ 編輯地點」對話框取代網頁飄移編輯氣泡窗，並實作背景無縫回寫儲存（不執行 build）

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（包含 Phase 1 ~ Phase 14 的交接紀錄與最新的 Phase 15 規格），並檢視現有的 `app/src/main/assets/inject_script.js`、`app/src/main/assets/inject_style.css`、`WebViewInjector.kt`、`MyMapJsBridge.kt`、`MyMapScreen.kt`、`QuickPinDialog.kt` 與 `JsBridgeAndAssetsTest.kt`。

現在請直接修改專案中的檔案，執行 **Phase 15：以原生 Material 3「✏️ 編輯地點」對話框 (`EditPinDialog`) 取代網頁原版編輯氣泡窗，徹底解決編輯 POI 時畫面醜陋且氣泡窗不斷飄離視窗無法輸入的問題**（注意：請務必直接寫入修改 `d:\CodeBase\GuiterEvent\MyGMap_guiter` 下的檔案；完成程式碼修改後**請勿執行 `build.bat` 或 `gradlew` 編譯**，我會自己執行）。

### 🔍 問題根因與設計目標：
- 目前在 `SelectedPinBottomCard` 點擊「✏️ 編輯」時，會直接顯示網頁原版氣泡窗編輯表單；但 Google Maps 桌面版 JS 會在焦點切換與手機鍵盤彈起 (`adjustResize`) 時不斷用 inline `transform` 重算氣泡窗位置，導致編輯表單一直飄離螢幕外、無法正常打字與按儲存。
- **解法**：將「檢視」與「編輯」全面統一為我們自己的 **Material 3 原生風格**！點擊「✏️ 編輯」時彈出置中固定的原生 **`EditPinDialog`**（絕不飄移、鍵盤友善、視覺與 `SelectedPinBottomCard` / `QuickPinDialog` 完全一致），底層由 `inject_script.js` 在背景隱藏狀態下將修改內容寫回 `#map-infowindow-container` 並自動觸發儲存 (`#map-infowindow-done-editing-button`)，同步保留「改用原網頁編輯」逃生門以備特殊情境！

---

### 🛠️ 本階段實作要求：

1. **CSS 鎖定原生編輯期間隱藏原網頁氣泡窗 (`assets/inject_style.css`)**：
   - 在 `body.mygmap-mobile-mode` 下新增 `body.mygmap-mobile-mode.mygmap-native-pin-editing` 規則：
     - 將 `.gm-style-iw-a`、`.gm-style-iw-t`、`.gm-style-iw`、`.gm-style-iw-c`、`.gm-style-iw-tc`、`#map-infowindow-container` 維持 `opacity: 0 !important; pointer-events: none !important;`（**嚴禁使用 `display: none`**，確保 JS 仍可正常讀寫背景 `input`/`textarea`/`contenteditable` 並點擊儲存/取消按鈕）。
     - 確保當 `body` 同時存在 `mygmap-native-pin-editing` 時，優先權高於 `mygmap-pin-editing`，避免網頁原版編輯氣泡窗閃現干擾畫面。

2. **實作 JS 層背景編輯讀寫、儲存、取消與刪除 API (`assets/inject_script.js` & `webview/WebViewInjector.kt`)**：
   - 在 `inject_script.js` 的 `helperState` 加入 `nativePinEditing: false`（當 `nativePinEditing === true` 時，`applyInfoWindowBodyClasses` 自動掛上 `body.mygmap-native-pin-editing` 並保持網頁氣泡窗隱藏；當使用者選擇「改用原網頁編輯」或離開編輯時才移除）。
   - 新增並於 `window.MyGMapHelper` 公開以下方法：
     1. **`openNativePinEdit()`**：
        - 設定 `helperState.nativePinEditing = true` 並立即呼叫 `applyBodyClasses()` 鎖定隱藏網頁氣泡窗。
        - 若目前氣泡窗尚未進入編輯模式，自動模擬點擊 `#map-infowindow-edit-button`（`findInfoWindowEditButton()`）。
        - 透過內部輪詢（最多等待 `900ms`，每 `90ms` 檢查一次，一旦偵測到可編輯欄位即刻回傳）擷取目前氣泡窗的可編輯欄位清單：
          - `title`（第一個標題欄位值）、`description`（第二個說明/備註欄位值）
          - `extraFields`: 若該圖層除了名稱與說明外還有其他自訂屬性欄位 (`[id^="map-infowindow-attr-"][id$="-value"]`)，一併收集 `{ id, label, value, multiline }`
          - `canDelete`（是否存在 `#map-infowindow-delete-button`）、`canEditPhoto`、`canEditStyle`
        - 透過 `window.AndroidBridge.onPinEditFormReady(json)` 回傳給 Android 原生層顯示 `EditPinDialog`（若 900ms 內找不到編輯欄位，也能回退使用目前 `extractSelectedPinUiState()` 的 `title`/`details` 或回報 `ok: false`）。
     2. **`saveNativePinEdit(payloadJson)`**：
        - 解析 `payloadJson`（含 `title`、`description`、`extraFields` 陣列）。
        - 若背景氣泡窗因故尚未處於編輯模式，自動點擊 `#map-infowindow-edit-button` 等待欄位就緒。
        - 使用既有成熟的 `setEditableElementValue(node, value)`（已內建完整 Closure `input`/`change`/`keyup`/`blur` 事件派發）依序寫入標題欄位 (`findInfoWindowTitleField()`)、說明欄位 (`findInfoWindowDescField(titleField)`) 及各個 `extraFields`（依 `id` 定位節點）。
        - 延遲 `180ms` 後自動 `simulateClick` `#map-infowindow-done-editing-button` (`findInfoWindowSaveButton()`)；完成後解除 `helperState.nativePinEditing = false`、排程呼叫 `reportSelectedPinStateIfChanged(true)` 刷新原生 `SelectedPinBottomCard` 顯示最新文字，並透過 `window.AndroidBridge.onPinEditResult(resultJson)` 回報成功/失敗結果！
     3. **`cancelNativePinEdit()`**：
        - 解除 `helperState.nativePinEditing = false`，若 `#map-infowindow-cancel-editing-button` 存在則自動點擊讓背景氣泡窗退出編輯狀態並回到檢視狀態，同步刷新 `applyInfoWindowBodyClasses()` 與 `reportSelectedPinStateIfChanged(true)`。
     4. **`deleteSelectedPin()`**：
        - 解除 `helperState.nativePinEditing = false`，尋找並 `simulateClick` `#map-infowindow-delete-button`（若網頁出現確認刪除按鈕則在背景妥善處理），完成後刷新 `reportSelectedPinStateIfChanged(true)` 關閉原生卡片。
     5. **`fallbackToWebPinEdit()`**：
        - 逃生門：設定 `helperState.nativePinEditing = false`，移除 `mygmap-native-pin-editing`，確保進入 `mygmap-pin-editing` 並置中顯示原網頁氣泡窗（供需要上傳相片/修改圖釘圖示樣式等特殊操作使用）。
   - 在 `WebViewInjector.kt` 新增對應包裝方法：`openNativePinEdit`、`saveNativePinEdit`、`cancelNativePinEdit`、`deleteSelectedPin`、`fallbackToWebPinEdit`。
   - 在 `MyMapJsBridge.kt` 新增：
     - `data class PinEditableField(val id: String, val label: String, val value: String, val multiline: Boolean = false)`
     - `data class PinEditFormState(val ok: Boolean = false, val title: String = "", val description: String = "", val extraFields: List<PinEditableField> = emptyList(), val canDelete: Boolean = false, val errorMessage: String = "")`
     - `parsePinEditFormState(jsonStr: String): PinEditFormState`（含純 JVM 單元測試 Regex Fallback 解析）
     - `@JavascriptInterface fun onPinEditFormReady(formJson: String)` 與 `@JavascriptInterface fun onPinEditResult(resultJson: String)` 及對應回呼。

3. **建立原生 Material 3「✏️ 編輯地點」對話框 (`ui/EditPinDialog.kt`) 並整合至 `MyMapScreen.kt`**：
   - 新增獨立可維護元件 `app/src/main/java/com/guiterevent/mygmap/ui/EditPinDialog.kt`：
     - 視覺風格與 `SelectedPinBottomCard`、`QuickPinDialog` 高度一致（圓角 `20.dp` `Dialog` / `Surface`、Google 藍重點圖示標題列、支援 `verticalScroll` 防止鍵盤彈起遮擋輸入框，固定置中絕不飄移）。
     - 欄位區域：
       - **📌 地點名稱（標題）**：單行 `OutlinedTextField`（自動帶入目前標題，右側附快速清除按鈕）。
       - **📝 說明 / 備註**：多行 `OutlinedTextField`（`minLines = 3`, `maxLines = 6`，自動帶入目前說明內容）。
       - **自訂欄位區**：若 `extraFields` 非空，動態產生對應的 `OutlinedTextField` 讓使用者一併編輯！
       - **唯讀資訊膠囊**：顯示目前圖釘座標（若有）與簡短提示「儲存後將即時同步至 Google 我的地圖雲端」。
     - 輔助動作列：
       - 若 `canDelete == true`：提供紅色外框/文字按鈕 **「🗑️ 刪除地點」**（點擊後先跳出二次確認 `AlertDialog` 防止誤刪，確認後呼叫 `WebViewInjector.deleteSelectedPin(wv)`）。
       - 提供低調文字按鈕 **「🌐 改用原網頁編輯（相片/樣式）」**（點擊後關閉原生對話框並呼叫 `WebViewInjector.fallbackToWebPinEdit(wv)`）。
     - 底部主動作列：
       - **「取消」**按鈕：呼叫 `WebViewInjector.cancelNativePinEdit(wv)` 並關閉對話框。
       - **「💾 儲存」**實心按鈕（Google 藍 `#1A73E8`，儲存中顯示 `CircularProgressIndicator` 防連點）：呼叫 `WebViewInjector.saveNativePinEdit(...)`。
   - 修改 `MyMapScreen.kt`：
     - 將 `SelectedPinBottomCard` 的 `onEdit` 改為呼叫 `WebViewInjector.openNativePinEdit(wv)`（不再直接切出醜醜的網頁氣泡窗！）。
     - 串接 `onPinEditFormReadyCallback`（開啟 `EditPinDialog`）與 `onPinEditResultCallback`（關閉對話框並以 `Toast` 顯示 `✅ 已儲存地點變更` 或錯誤提示）。

4. **更新單元測試與交接紀錄（請勿執行 build）**：
   - 在 `JsBridgeAndAssetsTest.kt` 新增 `parsePinEditFormState` 單元測試（驗證標題、備註、`extraFields`、`canDelete` 與失敗狀態），並驗證 `inject_style.css` 包含 `mygmap-native-pin-editing` 及 `inject_script.js` 公開 `openNativePinEdit` / `saveNativePinEdit` / `cancelNativePinEdit` / `deleteSelectedPin`。
   - 以 `node --check app/src/main/assets/inject_script.js` 驗證 JS 語法無誤。
   - **請勿執行 `build.bat` 或 `gradlew` 編譯指令**（使用者會自行手動編譯）。
   - 完成後更新 `PROJECT_PLAN.md`：將 Phase 15 勾選為 `[x]` 並填寫「Phase 15 交接紀錄」。
```

---

## 【補充 Prompt】將自動進版機制與版本管理資訊整合至 `README.md`（不執行 build）

```markdown
請檢視專案根目錄下的 `README.md`、`build.bat`、`version.properties`、`app/build.gradle.kts` 與 `BottomActionBar.kt`，將「編譯自動進版與版本號管理」的完整資訊整合進 `README.md` 中（注意：**請勿執行 `build.bat` 或 `gradlew` 編譯指令**）。

### 本次文件更新要求：
1. **在 `build.bat` 使用說明區塊中補齊自動進版參數與行為說明**：
   - 在指令範例區補上 `build.bat --no-bump`（本次編譯不自動遞增版本號）。
   - 新增「🔢 自動進版與版本號管理 (`version.properties`)」小節，清楚說明：
     - 版本號集中管理於根目錄 `version.properties`（`VERSION_MAJOR`、`VERSION_MINOR`、`VERSION_PATCH`、`VERSION_CODE`）。
     - 執行 `build.bat`（預設 `debug`、`release` 或 `check`）時會自動計算下一版號（`PATCH + 1`、`VERSION_CODE + 1`）寫入 APK，且**只有在編譯成功並確認產出 APK 後**才會更新 `version.properties`（編譯失敗、僅執行 `build.bat test` / `clean` 或加上 `--no-bump` 時都不會跳號）。
     - 若需手動升主版號 / 次版號（如 `1.0.x` -> `1.1.0` 或 `2.0.0`），直接修改 `version.properties` 即可。
     - 可於 App 內點擊底部「⚙️ 模式」選單最下方查看目前安裝的 `版本：v<versionName> (<versionCode>)`。
2. **更新「📦 APK 產出路徑一覽」**：
   - 補充 `dist\` 資料夾會同時產出最新覆蓋版（`dist\MyGMap-debug.apk`）與帶版號封存版（`dist\MyGMap-debug-v<版本>.apk` / `dist\MyGMap-release-v<版本>.apk`）。
3. **更新「📂 專案結構總覽」**：
   - 補入 `version.properties` 與 `dist/MyGMap-debug-v<版本>.apk`，並維持文件排版整潔一致。
```

---

## 【Phase 16 Prompt】根治 POI 點選閃跳、編輯標題未帶入與說明儲存失效、以及編輯儲存後地圖飄移卡死問題（不執行 build）

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（包含 Phase 1 ~ Phase 15 的交接紀錄與最新的 Phase 16 規格），並檢視現有的 `app/src/main/assets/inject_script.js`、`app/src/main/assets/inject_style.css`、`EditPinDialog.kt`、`MyMapScreen.kt` 與 `JsBridgeAndAssetsTest.kt`。

現在請直接修改專案中的檔案，執行 **Phase 16：徹底根治實機測試回報的三個核心體驗問題，並建立永久 JS/DOM 真實執行自測套件**（注意：請務必直接寫入修改 `d:\CodeBase\GuiterEvent\MyGMap_guiter` 下的檔案；**請勿執行打包 APK 的 `build.bat` / `assembleDebug`**，但**必須親自跑完本 Prompt 底部的「三道自動自測關卡」全部通過後才可回報完成**）。

### 🔍 三大問題精準根因分析（務必全部根治）：
1. **問題 1：點選 POI 時畫面先跳／閃一下才跳出自建 UI**
   - 目前在沒有選取 POI 時會移除 `body.mygmap-pin-view-hidden`，導致點下圖釘後的 `80ms~350ms` 空窗期，原網頁白色氣泡窗會先以 `opacity: 1` 閃現並造成視覺跳動，接著 JS 才補上 class 藏起它。
2. **問題 2：點選 POI 編輯時，標題沒有自動帶入；編輯「說明」後儲存再開也沒有看到**
   - `findInfoWindowTitleField()` 備援選擇器只寫了 `input[type="text"]`，會**漏抓沒有顯式 `type="text"` 屬性的 `<input>`**，結果誤把空白的 `<textarea>` 當成標題欄回傳（造成標題空白），而 `findInfoWindowDescField()` 也因此抓錯或找不到真正的說明欄位！
   - 同時 `setEditableElementValue()` 沒有派發完整的 `InputEvent` / `keydown` / `keyup` 事件，導致 Google Closure `InputHandler` 未偵測到變更，點擊「儲存」時沒有把新說明寫入雲端。
3. **問題 3：編輯儲存之後，地圖位置一樣會飄走，偶爾還會拉不回來、必須重開 App**
   - `setEditableElementValue()` 呼叫了 `el.focus()`（**沒有加 `{ preventScroll: true }`**）且對輸入框呼叫 `simulateClick(el)`！在背景對隱藏的 `.gm-style-iw-c` 輸入框呼叫 `el.focus()`，會觸發 Chromium WebView **強制捲動 `overflow: hidden` 的地圖祖先容器 (`scrollLeft` / `scrollTop`)**；一旦 `overflow: hidden` 容器被程式捲動偏移，使用者手指就完全拉不回來，只能重開 App！

---

### 🛠️ 本階段實作要求：

1. **徹底消除 POI 點選閃跳 (`assets/inject_style.css` & `assets/inject_script.js`)**：
   - 在 `inject_style.css` 中，將 `body.mygmap-mobile-mode` 下隱藏原網頁氣泡窗的規則改為**預設常駐生效**：
     - 當 `body.mygmap-mobile-mode:not(.mygmap-pin-editing):not(.mygmap-addtomap-visible)` 時，直接讓 `.gm-style-iw-a`、`.gm-style-iw-t`、`.gm-style-iw`、`.gm-style-iw-c`、`.gm-style-iw-tc`、`#map-infowindow-container` 一律保持 `opacity: 0 !important; pointer-events: none !important;`（不使用 `display: none`）。
     - 這樣從點擊圖釘的第 0 毫秒起，原網頁白色氣泡窗就絕不會閃出來！
   - 在 `inject_script.js` 的 `applyInfoWindowBodyClasses()` 中：
     - 若氣泡窗是搜尋結果綠釘（`hasVisibleAddToMapButton(container) === true`），加上 `body.mygmap-addtomap-visible` 讓搜尋綠釘氣泡窗正常可見；否則移除 `mygmap-addtomap-visible`。
     - 優化 `scheduleSelectedPinStateChecks()`：加入 `requestAnimationFrame`、`25ms`、`90ms`、`220ms`、`500ms` 的快速偵測節奏，讓原生 `SelectedPinBottomCard` 幾乎零延遲出現。

2. **徹底修復編輯標題未帶入與「說明」儲存不生效 (`assets/inject_script.js`)**：
   - 修正 `findInfoWindowTitleField()` 與 `findInfoWindowDescField(titleNode)`：
     - 建立統一的氣泡窗輸入欄位選擇器：
       `'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="file"]), textarea, [contenteditable="true"]'`（**絕不可只寫 `input[type="text"]`！**）。
     - 當氣泡窗處於編輯模式 (`isInfoWindowInEditMode(container)`) 時，**優先只從 `#map-infowindow-container` / `.gm-style-iw` 內真正可編輯 (`isNodeCurrentlyEditable`) 的節點中**，依序定位：
       1. `titleField`：優先已知標題 ID (`map-infowindow-attr-名稱-value` 等) 內的可編輯節點，否則取氣泡窗內**第一個可編輯的 `<input>`**（排除 `#mapsprosearch-field`），再否則取第一個 `[id^="map-infowindow-attr-"][id$="-value"]` 可編輯節點。
       2. `descField`：優先已知說明 ID (`map-infowindow-attr-說明-value` 等) 內的可編輯節點，否則取氣泡窗內**第一個非 `titleField` 的 `<textarea>` 或 `[contenteditable="true"]`**，再否則取第二個可編輯欄位。
   - 在 `openNativePinEdit()` 中：
     - 點擊 `#map-infowindow-edit-button` **之前**，先用 `var preViewState = extractSelectedPinUiState()` 記住檢視模式下已經成功讀到的 `preViewState.title`；若進入編輯後 `formData.title` 為空而 `preViewState.title` 非空，自動以 `preViewState.title` 補齊，確保標題永遠正確帶入！
   - 強化 `setEditableElementValue(rawEl, text)` 與 `saveNativePinEdit(payloadJson)`：
     - **嚴格使用 `el.focus({ preventScroll: true })`**（並對 `<input>` / `<textarea>` **移除 `simulateClick(el)`**，避免觸發地圖異常焦點或捲動）。
     - 對 `<input>` / `<textarea>` 使用原生 prototype setter 設定值後，依序派發：`KeyboardEvent('keydown')`、`InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: cleanText })`（不支援 `InputEvent` 建構子時降級為 `Event('input')`）、`Event('change', { bubbles: true })`、`KeyboardEvent('keyup')`、`Event('blur', { bubbles: true })`。
     - 對 `[contenteditable="true"]`：先選取範圍再寫入 `textContent` / `innerText` 並派發相同事件序列。
     - 按下 `#map-infowindow-done-editing-button` (`saveBtn`) 時，將延遲拉長至 `240ms` 確保 Closure 狀態已同步，並同時嘗試 `simulateClick(saveBtn)`；若 `250ms` 後仍偵測到 `isInfoWindowInEditMode(container)`，補一次 `saveBtn.click()` 確保確實送出儲存！
     - 儲存完成退出編輯模式後，確保 `extractSelectedPinUiState()` 能正確讀回並顯示使用者剛儲存的自訂「說明」文字（不被 `isBoilerplatePinLine` 誤濾）。

3. **徹底根治編輯儲存後地圖位置飄移與卡死拉不回來 (`assets/inject_script.js` & `assets/inject_style.css`)**：
   - 在 `inject_style.css` 中，於 `body.mygmap-mobile-mode` 下確保 `html, body.mygmap-mobile-mode` 加上 `overflow: hidden !important;`（禁止外層根視埠被隱形焦點捲動偏移）。
   - 在 `inject_script.js` 新增 **`resetMapViewportScrollLock()`**：
     - 立即執行 `window.scrollTo(0, 0)`，將 `document.documentElement.scrollLeft = 0; document.documentElement.scrollTop = 0; document.body.scrollLeft = 0; document.body.scrollTop = 0;`。
     - 從 `#map-canvas` / `#lyra-canvas` / `.gm-style` 一路往上遍歷所有祖先元素，強制將 `scrollLeft = 0; scrollTop = 0;`（徹底恢復任何被瀏覽器焦點誤捲動的 `overflow: hidden` 容器！）。
     - 呼叫 `blurActiveWebElement()` 解除背景輸入框焦點。
   - 在 `openNativePinEdit()`、`saveNativePinEdit()`、`cancelNativePinEdit()`、`deleteSelectedPin()` 執行期間及結束後（含 `requestAnimationFrame`、`100ms`、`350ms`），自動呼叫 `resetMapViewportScrollLock()`；並於儲存完成退出編輯後派發一次 `window.dispatchEvent(new Event('resize'))` 確保 Google Maps 手勢拖曳與圖磚座標完全恢復正常、絕不卡死！

4. **建立永久 JS/DOM 行為回歸測試套件 (`scripts/test_inject_dom.mjs`)**：
   - 使用純 Node.js（零額外商業套件相依，可用內建 `vm` 搭配輕量 Mock DOM 環境）建立 `scripts/test_inject_dom.mjs`，**真實載入並執行 `app/src/main/assets/inject_script.js`**，至少涵蓋以下 6 組真實行為斷言（任何一項失敗必須以非 0 exit code 結束）：
     1. **無 `type="text"` 屬性之 `<input>` 標題自動帶入測試**：模擬 Google 我的地圖氣泡窗（標題為沒有 `type="text"` 的 `<input value="Pier 91 郵輪港口">`，說明為空白 `<textarea>`），呼叫 `openNativePinEdit()`，驗證 `AndroidBridge.onPinEditFormReady` 收到的 `title === "Pier 91 郵輪港口"` 且 `description === ""`。
     2. **「說明」編輯回寫與儲存生效測試**：呼叫 `saveNativePinEdit(JSON.stringify({ title: "新標題", description: "測試備註123", extraFields: [] }))`，驗證真實 `<input>.value === "新標題"`、`<textarea>.value === "測試備註123"`、皆有收到 `input` 與 `change` 事件，且 `#map-infowindow-done-editing-button` 被點擊觸發。
     3. **禁止無 `preventScroll` 聚焦與地圖捲動歸零測試**：監控 `focus()` 呼叫參數與 `scrollLeft`/`scrollTop`，驗證 `saveNativePinEdit` 過程中所有 `focus()` 皆帶 `{ preventScroll: true }`，且模擬祖先容器被捲動 (`scrollTop = 120; scrollLeft = 80`) 後，`resetMapViewportScrollLock()` 會將其完整歸零 (`0, 0`)。
     4. **點選 POI 零閃跳狀態測試**：驗證一般 POI 氣泡窗打開時不會誤加 `mygmap-addtomap-visible`，而含 `#addtomap-button` 的搜尋綠釘氣泡窗打開時會正確加上 `mygmap-addtomap-visible`。
     5. **圖層抽屜與地圖保護回歸測試**：模擬 360px 窄螢幕，驗證 `scanAndTagDom()` 不會把含 `#map-canvas` 的共用外殼標成 `layer-panel`，且 `setDrawerOpen(true)` 會將 `#mygmap-drawer-backdrop` 的 `left` 設為抽屜寬度避免覆蓋面板。
     6. **`!3d!4d` 高精準座標優先序回歸測試**：驗證 `extractExactCoordsFromMapsUrl` 在同時存在 `/@68.51358,17.01783` 與 `!3d68.514123!4d17.012345` 時回傳 `!3d!4d` 座標。

5. **強制執行「三道自動自測關卡」（必須全數 PASS 才可結案；嚴禁打包 APK）**：
   - 更新 `JsBridgeAndAssetsTest.kt`（驗證 `mygmap-addtomap-visible`、`preventScroll: true`、`resetMapViewportScrollLock` 及無 `type="text"` `<input>` 選擇器）。
   - **依序親自執行以下三個驗證指令**，若有任一失敗必須當場修到 100% 通過（注意：**禁止執行 `build.bat` / `assembleDebug` 打包 APK**，以免自動跳版號）：
     1. `node --check app/src/main/assets/inject_script.js`
     2. `node scripts/test_inject_dom.mjs`
     3. `cmd /c build.bat test --no-explorer`（僅跑 Kotlin 編譯與全部 JUnit 單元測試，不打包 APK、不進版）
   - 三道自測全部 PASS 後，更新 `PROJECT_PLAN.md`：將 Phase 16 勾選為 `[x]`，並在「Phase 16 交接紀錄」貼上三道自測的實測結果摘要。
```

---

## 【Phase 17 Prompt】根治「儲存後說明沒寫入、無法點空白處取消焦點、拖曳地圖一直被拉回原 POI」問題（含三道強制自測關卡，嚴禁打包 APK）

```markdown
請先完整閱讀專案根目錄下的 `PROJECT_PLAN.md`（包含「給 AI 助手的特別指令」之三道自動自測關卡與最新的 Phase 17 規格），並檢視現有的 `app/src/main/assets/inject_script.js`、`app/src/main/assets/inject_style.css` 與 `app/src/test/java/com/guiterevent/mygmap/JsBridgeAndAssetsTest.kt`。

現在請直接修改專案中的檔案，執行 **Phase 17：根治編輯 POI 按儲存後「說明沒寫入 Google」、「無法點地圖空白處取消該 POI 焦點」以及「滑開地圖會一直被強制拉回原本 POI 附近」問題**（注意：請務必直接寫入修改 `d:\CodeBase\GuiterEvent\MyGMap_guiter` 下的檔案；**嚴禁執行打包 APK 的 `build.bat` / `assembleDebug`**，但**必須親自跑完底部的三道自動自測關卡全數 PASS 後才可回報完成**）。

### 🔍 兩個現象背後其實是「同一個」實機根因（已透過實機截圖與對照測試證實）：
1. **為什麼「說明沒寫入 Google」，而且按儲存後「無法點空白處離開 POI、滑開地圖還會一直回彈回原本 POI」？**
   - 在 Google 我的地圖的編輯氣泡窗中，`#map-infowindow-done-editing-button`（儲存）與 `#map-infowindow-cancel-editing-button`（取消）**只是外層 Wrapper `<div>`**，真正綁定 Google Closure 點擊監聽器的按鈕（`<div role="button">` / `<button>` / `.jfk-button`）位於它的**內層子節點**！
   - 由於 DOM 事件只會**由子節點向上冒泡到父節點**、**不會由父節點向下傳遞給子節點**，原本對外層 `#map-infowindow-done-editing-button` 派發 `simulateClick` **根本沒有觸發真正的 Google 儲存按鈕**！
   - 於是發生了連鎖反應：
     1. 編輯後的「說明」從頭到尾都沒按到真正的儲存鈕 -> 切回原始頁面也沒看到。
     2. 背景氣泡窗（被 `opacity: 0` 隱藏）**永久卡死在 Google 的編輯模式**！
     3. 只要 Google 我的地圖氣泡窗停在「編輯模式」，點地圖空白處**絕對無法關閉氣泡窗／解除焦點**，而且 Google Maps 編輯氣泡窗的自動居中 (`autoPan`) 會**一直把你滑開的地圖拉回該 POI 附近**！
     4. 更糟的是，原本 `saveNativePinEdit()` 在 `1500ms` 逾時後就算 `stillEditing === true` 仍錯誤回報 `ok: true` (`✅ 已儲存地點變更`)，掩蓋了根本沒存成功的問題！

---

### 🛠️ 本階段實作要求：

1. **實作 `resolveClickableButton(node)` 穿透 Wrapper 點擊真正內層 Closure 按鈕 (`assets/inject_script.js`)**：
   - 新增 helper 函式 `resolveClickableButton(rawNode)`：
     - 若 `rawNode` 內部包含可見的可點擊子節點（依序查詢 `button, [role="button"], .jfk-button, .goog-button, .goog-inline-block`），優先回傳**最內層實際綁定事件的可點擊按鈕**（事件會自然從內層按鈕向上冒泡至外層 Wrapper，內外層監聽器 100% 都會收到！）。
     - 若無此類子節點，才回傳 `rawNode` 本身。
   - 新增 `clickInfoWindowControl(rawNode)`：
     - 依序取得 `innerBtn = resolveClickableButton(rawNode)`；對 `innerBtn` 執行 `simulateClick(innerBtn)`（確保 `pointerdown -> mousedown -> pointerup -> mouseup -> click` 完整派發），若 `innerBtn !== rawNode` 且需要重試時也對 `rawNode` 補發一次；絕不呼叫會捲動視埠的無參數 `focus()`。
   - 套用至 `findInfoWindowSaveButton()`、`findInfoWindowCancelButton()`、`findInfoWindowEditButton()`、`findInfoWindowDeleteButton()` 的點擊流程（`saveNativePinEdit`、`cancelNativePinEdit`、`deleteSelectedPin` 與 `addGpsPinToMap`）。

2. **強化 `saveNativePinEdit()`：確保「說明」100% 寫入、真正退出編輯模式，嚴禁逾時假性成功 (`assets/inject_script.js`)**：
   - **修正 `hasReadyEditableFields()` 條件**：
     - 當 `nextDesc.trim().length > 0` 時，必須等到 **`descField` 也已真正可編輯 (`df && isNodeCurrentlyEditable(df)`)** 才進入 `performWriteAndSave()`，不可因為只有 `titleField` 就緒就提早寫入！
   - **寫入後即時驗證**：
     - 呼叫 `setEditableElementValue(descField, nextDesc)` 後，檢查 `readEditableFieldValue(descField)` 是否確實等於 `nextDesc`；若因 Google Closure `LabelInput` 狀態未寫入，立即補做直接寫入並再次派發 `focus`/`input`/`change`/`keyup`/`blur`。
   - **多階段可靠儲存點擊與嚴格結果回報**：
     - 寫入完成延遲 `260ms` 後，透過 `clickInfoWindowControl(saveBtn)` 點擊真正內層「儲存」按鈕。
     - 輪詢等待 `stillEditing` 變為 `false`（最長 `2000ms`，每 `90ms` 檢查）：
       - 若 `300ms` 仍在編輯模式：對內層按鈕與外層 Wrapper 依序嘗試 `.click()` + `simulateClick()`。
       - 若 `750ms` 仍在編輯模式：針對 `saveBtn` 內所有 `[role="button"], button, .jfk-button` 子元素逐一觸發 `simulateClick` + `.click()`，並確認事件目標涵蓋文字為「儲存 / Save」的節點。
     - **嚴格禁止假性成功**：
       - **只有當 `!stillEditing` 為 `true`（背景氣泡窗確實退出編輯模式並回到檢視模式）時**，才解除 `nativePinEditing`、執行 `scheduleMapViewportScrollUnlock()`、刷新 `reportSelectedPinStateIfChanged(true)`（回傳最新儲存的標題與說明），並回報 `{ ok: true, action: 'save', message: '✅ 已儲存地點變更' }`！
       - 若超過 `2000ms` 仍為 `stillEditing === true`：**絕不可回報 `ok: true`**，必須先嘗試 `cancelNativePinEdit()` 確保背景不會永遠卡在編輯模式鎖死地圖，並回報 `{ ok: false, action: 'save', message: '⚠️ 背景儲存未生效，已還原狀態，請點「改用原網頁編輯」試試' }`！

3. **確保退出編輯後地圖完全自由、可點空白處取消焦點且不再回彈 (`assets/inject_script.js`)**：
   - 當 `saveNativePinEdit()` 確認 `!stillEditing` 退出編輯模式後：
     - 立即 `blurActiveWebElement()`、`resetMapViewportScrollLock(true)`，確保沒有任何隱藏焦點留在 `.gm-style-iw` 內。
     - 確保 `body.mygmap-native-pin-editing` 與 `body.mygmap-pin-editing` 均已清除，僅剩乾淨的檢視狀態，讓使用者點擊地圖任意空白處即可正常關閉圖釘焦點、拖曳地圖絕不再回彈回原 POI！

4. **建立／強化 `scripts/test_inject_dom.mjs` 並強制通過三道自動自測關卡（嚴禁打包 APK）**：
   - 建立（若尚不存在）或強化 `scripts/test_inject_dom.mjs`（純 Node.js，零外部商業相依），真實載入並執行 `app/src/main/assets/inject_script.js`，**必須完整涵蓋並通過以下 7 組真實行為回歸測試**（任何失敗以非 0 exit code 結束）：
     1. **巢狀 Wrapper 儲存按鈕測試（本次核心回歸測試！）**：模擬 `<div id="map-infowindow-done-editing-button"><div role="button" class="jfk-button">儲存</div></div>`，設定**只有內層 `[role="button"]` 綁定 click/mouseup 才會儲存並退出編輯模式**（點外層 div 不會觸發），驗證 `saveNativePinEdit` 能確實觸發內層按鈕、寫入標題與說明、成功退出編輯模式並回報 `ok: true`！
     2. **儲存失敗不假報成功測試**：模擬儲存按鈕完全無反應時，`saveNativePinEdit` 必須回報 `ok: false`（絕不可假報 `ok: true`），且不能讓 `nativePinEditing` 永遠鎖死。
     3. **無 `type="text"` `<input>` 標題自動帶入與空說明欄寫入測試**：驗證 `openNativePinEdit()` 正確帶入標題，`saveNativePinEdit()` 正確寫入 `<textarea>` 說明並派發 `input`/`change`。
     4. **禁止無 `preventScroll` 聚焦與地圖捲動歸零測試**：驗證所有 `focus()` 皆帶 `{ preventScroll: true }` 且 `resetMapViewportScrollLock()` 會將祖先容器捲動歸零 `(0, 0)`。
     5. **點選 POI 零閃跳狀態測試**：驗證一般 POI 不加 `mygmap-addtomap-visible`，搜尋綠釘 (`#addtomap-button`) 才加 `mygmap-addtomap-visible`。
     6. **圖層抽屜與地圖保護回歸測試**：360px 窄螢幕下不會把含 `#map-canvas` 的共用外殼標成 `layer-panel`，且 `setDrawerOpen(true)` 會動態將 `#mygmap-drawer-backdrop` 的 `left` 設為抽屜寬度。
     7. **`!3d!4d` 高精準座標優先序回歸測試**：同時存在 `/@68.51358,17.01783` 與 `!3d68.514123!4d17.012345` 時正確回傳 `!3d!4d` 座標。
   - 同步更新 `JsBridgeAndAssetsTest.kt` 驗證 `resolveClickableButton` 與 `clickInfoWindowControl` 存在。
   - **必須親自依序執行以下三道自動自測關卡並全部 PASS（嚴禁執行打包 APK 的 `build.bat` / `assembleDebug`）**：
     1. `node --check app/src/main/assets/inject_script.js`
     2. `node scripts/test_inject_dom.mjs`
     3. `cmd /c build.bat test --no-explorer`（僅跑 Kotlin 編譯與全部 JUnit 單元測試，不打包 APK、不進版）
   - 三道自測全部 PASS 後，更新 `PROJECT_PLAN.md`：將 Phase 17 勾選為 `[x]`，並在「Phase 17 交接紀錄」貼上三道自測的實測結果摘要。
```

