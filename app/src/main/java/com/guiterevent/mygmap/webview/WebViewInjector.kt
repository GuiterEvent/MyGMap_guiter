package com.guiterevent.mygmap.webview

import android.content.Context
import android.util.Log
import android.webkit.WebView
import org.json.JSONObject

/**
 * 負責從 `app/src/main/assets/` 讀取模組化的 `inject_style.css` 與 `inject_script.js`，
 * 並於適當時機（如 `onPageCommitVisible` 與 `onPageFinished`）注入 WebView，
 * 同時提供 Android 端呼叫 `window.MyGMapHelper` 各項介面與 DOM 控制功能的包裝函式。
 */
object WebViewInjector {
    private const val TAG = "WebViewInjector"

    const val ASSET_STYLE_FILE = "inject_style.css"
    const val ASSET_SCRIPT_FILE = "inject_script.js"
    private const val STYLE_ELEMENT_ID = "mygmap-injected-style"

    @Volatile
    private var cachedCss: String? = null

    @Volatile
    private var cachedJs: String? = null

    /**
     * 從 `assets/` 目錄讀取文字檔內容
     */
    private fun readAssetText(context: Context, fileName: String): String {
        return context.assets.open(fileName).bufferedReader(Charsets.UTF_8).use { it.readText() }
    }

    /**
     * 取得快取或讀取 `assets/inject_style.css`
     */
    fun getInjectStyleCss(context: Context): String {
        cachedCss?.let { return it }
        return synchronized(this) {
            cachedCss ?: readAssetText(context.applicationContext, ASSET_STYLE_FILE).also {
                cachedCss = it
            }
        }
    }

    /**
     * 取得快取或讀取 `assets/inject_script.js`
     */
    fun getInjectScriptJs(context: Context): String {
        cachedJs?.let { return it }
        return synchronized(this) {
            cachedJs ?: readAssetText(context.applicationContext, ASSET_SCRIPT_FILE).also {
                cachedJs = it
            }
        }
    }

    /**
     * 將 `inject_style.css` 與 `inject_script.js` 注入指定的 [WebView]，
     * 並同步當前的手機排版模式 (`mobileMode`)、左側圖層抽屜狀態 (`drawerOpen`) 與 DOM 探測模式 (`inspectMode`)。
     */
    fun injectAll(
        webView: WebView,
        mobileMode: Boolean = true,
        drawerOpen: Boolean = false,
        inspectMode: Boolean = false
    ) {
        val url = webView.url
        // 避免在 Google OAuth 帳號登入頁面注入自訂地圖編輯器樣式
        if (MyMapWebViewClient.isGoogleAuthUrl(url)) {
            Log.d(TAG, "Skip CSS/JS injection on Google Auth URL: $url")
            return
        }

        try {
            val cssContent = getInjectStyleCss(webView.context)
            val jsContent = getInjectScriptJs(webView.context)
            val quotedCss = JSONObject.quote(cssContent)

            val bootstrapScript = """
                (function() {
                    try {
                        var head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
                        if (head) {
                            var styleEl = document.getElementById('$STYLE_ELEMENT_ID');
                            if (!styleEl) {
                                styleEl = document.createElement('style');
                                styleEl.id = '$STYLE_ELEMENT_ID';
                                styleEl.type = 'text/css';
                                head.appendChild(styleEl);
                            }
                            var nextCss = $quotedCss;
                            if (styleEl.textContent !== nextCss) {
                                styleEl.textContent = nextCss;
                            }
                        }
                    } catch (cssErr) {
                        console.error('[MyGMap] Failed to inject CSS:', cssErr);
                    }
                })();
                $jsContent
                (function() {
                    if (window.MyGMapHelper && typeof window.MyGMapHelper.syncFromAndroid === 'function') {
                        return JSON.stringify(window.MyGMapHelper.syncFromAndroid({
                            mobileMode: $mobileMode,
                            drawerOpen: $drawerOpen,
                            inspectMode: $inspectMode
                        }));
                    }
                    return null;
                })();
            """.trimIndent()

            webView.evaluateJavascript(bootstrapScript) { result ->
                Log.d(TAG, "Injected CSS/JS into $url -> syncResult=$result")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to inject assets into WebView: ${e.message}", e)
        }
    }

    /**
     * 切換或設定手機優化排版 (`body.mygmap-mobile-mode`) 與原始桌面版排版 (CSS Bypass 逃生門)
     */
    fun setMobileMode(webView: WebView, enabled: Boolean) {
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.setMobileMode === 'function') {
                    return window.MyGMapHelper.setMobileMode($enabled);
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script, null)
    }

    /**
     * Phase 3：呼叫 `window.MyGMapHelper.toggleMobileCssMode()` 切換手機優化排版 / 原始桌面排版
     */
    fun toggleMobileCssMode(webView: WebView, onResult: (Boolean) -> Unit = {}) {
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.toggleMobileCssMode === 'function') {
                    return Boolean(window.MyGMapHelper.toggleMobileCssMode());
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script) { rawResult ->
            onResult(rawResult == "true")
        }
    }

    /**
     * 設定左側圖層面板抽屜展開 (`body.mygmap-drawer-open`) 或收合 (`body.mygmap-drawer-closed`)
     */
    fun setDrawerOpen(webView: WebView, open: Boolean) {
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.setDrawerOpen === 'function') {
                    return window.MyGMapHelper.setDrawerOpen($open);
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script, null)
    }

    /**
     * 切換左側圖層面板抽屜開關狀態
     */
    fun toggleDrawer(webView: WebView) {
        toggleLayerDrawer(webView)
    }

    /**
     * Phase 3：呼叫 `window.MyGMapHelper.toggleLayerDrawer()` 展開或收合左側圖層抽屜
     */
    fun toggleLayerDrawer(webView: WebView, onResult: (Boolean) -> Unit = {}) {
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.toggleLayerDrawer === 'function') {
                    return Boolean(window.MyGMapHelper.toggleLayerDrawer());
                }
                if (window.MyGMapHelper && typeof window.MyGMapHelper.toggleDrawer === 'function') {
                    return Boolean(window.MyGMapHelper.toggleDrawer());
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script) { rawResult ->
            onResult(rawResult == "true")
        }
    }

    /**
     * 開啟或關閉「開發者 DOM 探測模式 (Inspect Mode)」
     */
    fun setInspectMode(webView: WebView, enabled: Boolean) {
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.setInspectMode === 'function') {
                    return window.MyGMapHelper.setInspectMode($enabled);
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script, null)
    }

    /**
     * Phase 3：呼叫 `window.MyGMapHelper.searchPlace(query)` 自動填入 `#mapsprosearch-field` 並觸發搜尋
     */
    fun searchPlace(
        webView: WebView,
        query: String,
        onResult: (Boolean) -> Unit = {}
    ) {
        val safeQuery = JSONObject.quote(query.trim())
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.searchPlace === 'function') {
                    return Boolean(window.MyGMapHelper.searchPlace($safeQuery));
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script) { rawResult ->
            onResult(rawResult == "true")
        }
    }

    /**
     * Phase 3：呼叫 `window.MyGMapHelper.clickAddToMap()` 一鍵點擊搜尋結果氣泡上的「新增至地圖」按鈕
     */
    fun clickAddToMap(
        webView: WebView,
        onResult: (Boolean) -> Unit = {}
    ) {
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.clickAddToMap === 'function') {
                    return Boolean(window.MyGMapHelper.clickAddToMap());
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script) { rawResult ->
            onResult(rawResult == "true")
        }
    }

    /**
     * Phase 3：呼叫 `window.MyGMapHelper.activateAddMarkerTool()` 啟動「新增標記 (插針)」模式
     */
    fun activateAddMarkerTool(
        webView: WebView,
        onResult: (Boolean) -> Unit = {}
    ) {
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.activateAddMarkerTool === 'function') {
                    return Boolean(window.MyGMapHelper.activateAddMarkerTool());
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script) { rawResult ->
            onResult(rawResult == "true")
        }
    }

    /**
     * Phase 3：呼叫 `window.MyGMapHelper.activatePanTool()` 切換回「手型選取/平移模式」
     */
    fun activatePanTool(
        webView: WebView,
        onResult: (Boolean) -> Unit = {}
    ) {
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.activatePanTool === 'function') {
                    return Boolean(window.MyGMapHelper.activatePanTool());
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script) { rawResult ->
            onResult(rawResult == "true")
        }
    }

    /**
     * Phase 3：呼叫 `window.MyGMapHelper.triggerUndo()` 執行復原
     */
    fun triggerUndo(
        webView: WebView,
        onResult: (Boolean) -> Unit = {}
    ) {
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.triggerUndo === 'function') {
                    return Boolean(window.MyGMapHelper.triggerUndo());
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script) { rawResult ->
            onResult(rawResult == "true")
        }
    }

    /**
     * Phase 3：呼叫 `window.MyGMapHelper.triggerRedo()` 執行重做
     */
    fun triggerRedo(
        webView: WebView,
        onResult: (Boolean) -> Unit = {}
    ) {
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.triggerRedo === 'function') {
                    return Boolean(window.MyGMapHelper.triggerRedo());
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script) { rawResult ->
            onResult(rawResult == "true")
        }
    }

    /**
     * 透過 `window.MyGMapHelper.triggerAction(targetKey)` 觸發網頁內對應的編輯工具或按鈕
     * @param targetKey 例如 `'addMarkerTool'`, `'selectTool'`, `'drawLineTool'`, `'addToMapButton'`
     */
    fun triggerEditorAction(
        webView: WebView,
        targetKey: String,
        onResult: (Boolean) -> Unit = {}
    ) {
        val safeKey = JSONObject.quote(targetKey)
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.triggerAction === 'function') {
                    return Boolean(window.MyGMapHelper.triggerAction($safeKey));
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script) { rawResult ->
            onResult(rawResult == "true")
        }
    }

    /**
     * Phase 4：呼叫 `window.MyGMapHelper.addGpsPinToMap(lat, lng, title, description)`
     * 啟動自動化打卡狀態機（Step 1 確認圖層並搜尋座標 -> Step 2 點擊新增至地圖 -> Step 3 自動填入標題與備註並儲存）。
     */
    fun addGpsPinToMap(
        webView: WebView,
        lat: Double,
        lng: Double,
        title: String,
        description: String,
        onResult: (Boolean) -> Unit = {}
    ) {
        val safeTitle = JSONObject.quote(title.trim())
        val safeDesc = JSONObject.quote(description.trim())
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.addGpsPinToMap === 'function') {
                    return Boolean(window.MyGMapHelper.addGpsPinToMap($lat, $lng, $safeTitle, $safeDesc));
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script) { rawResult ->
            onResult(rawResult == "true")
        }
    }

    /**
     * Phase 4：取消正在執行中的 `addGpsPinToMap` 自動化打卡任務
     */
    fun cancelActiveGpsPinTask(webView: WebView) {
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.cancelActiveGpsPinTask === 'function') {
                    window.MyGMapHelper.cancelActiveGpsPinTask();
                    return true;
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script, null)
    }

    /**
     * Phase 5：呼叫 `window.MyGMapHelper.extractNavigationContext()` 提取目前網頁的
     * `mid`（地圖 ID）、地圖中心座標 (`ll`)、目前選取的圖釘氣泡窗標題/座標與搜尋框文字/座標，
     * 供「🗺️ 在 Google Maps App 開啟」導航與查看街景使用。
     */
    fun extractNavigationContext(
        webView: WebView,
        onResult: (MapNavigationContext) -> Unit
    ) {
        val fallbackUrl = webView.url
        val script = """
            (function() {
                try {
                    if (window.MyGMapHelper && typeof window.MyGMapHelper.extractNavigationContext === 'function') {
                        return JSON.stringify(window.MyGMapHelper.extractNavigationContext());
                    }
                } catch (e) {}
                return null;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script) { rawResult ->
            val contextInfo = MapExportAndIntentHelper.parseNavigationContextJson(
                rawEvaluateJsResult = rawResult,
                fallbackUrl = fallbackUrl
            )
            onResult(contextInfo)
        }
    }

    /**
     * Phase 12：呼叫 `window.MyGMapHelper.triggerInfoWindowEdit()` 點擊目前氣泡窗的編輯按鈕
     */
    fun triggerInfoWindowEdit(
        webView: WebView,
        onResult: (Boolean) -> Unit = {}
    ) {
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.triggerInfoWindowEdit === 'function') {
                    return Boolean(window.MyGMapHelper.triggerInfoWindowEdit());
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script) { rawResult ->
            onResult(rawResult == "true")
        }
    }

    /**
     * Phase 12：呼叫 `window.MyGMapHelper.closeInfoWindow()` 關閉目前展開的網頁氣泡窗
     */
    fun closeInfoWindow(
        webView: WebView,
        onResult: (Boolean) -> Unit = {}
    ) {
        val script = """
            (function() {
                if (window.MyGMapHelper && typeof window.MyGMapHelper.closeInfoWindow === 'function') {
                    return Boolean(window.MyGMapHelper.closeInfoWindow());
                }
                return false;
            })();
        """.trimIndent()
        webView.evaluateJavascript(script) { rawResult ->
            onResult(rawResult == "true")
        }
    }
}
