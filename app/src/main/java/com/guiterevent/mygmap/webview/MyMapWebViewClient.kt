package com.guiterevent.mygmap.webview

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.util.Log
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * MyGMap 專屬 WebViewClient (Phase 1 ~ Phase 6 全面加固版)：
 * 1. 徹底解決 Google OAuth `403 disallowed_useragent` 限制與重定向中斷問題：
 *    - 將 `WebView` 的 `settings.userAgentString` 強制且一致地完整替換為純桌面版 Chrome 瀏覽器字串 (`DESKTOP_CHROME_UA`)，
 *      確保全程絕不出現 `; wv` 或 `Version/4.0` 字樣。
 *    - 移除 `shouldOverrideUrlLoading` 中因切換 UA 而呼叫 `view.loadUrl(url)` 的強制重載行為，
 *      防止 OAuth POST / Redirect 鏈與 Session 中斷，確保登入後順暢跳回 `https://www.google.com/maps/d/`。
 * 2. 防止重啟 App 後登入狀態遺失、頁面變白：
 *    - 明確啟用 `javaScriptEnabled`、`domStorageEnabled`、`databaseEnabled` 與第一方/第三方 Cookie (`CookieManager`)。
 *    - 覆寫 `onRenderProcessGone` 安全攔截背景渲染程序回收並自動重新載入頁面，防止 App 崩潰或停留於空白畫面。
 *    - 內建 `isBlankOrInvalidUrl` 與 `onPageFinished` 白屏防呆恢復機制，並於每次頁面完成載入時執行 `flushCookies()`。
 * 3. 支援網頁內建定位按鈕 (HTML5 Geolocation)：
 *    - 於 `configureWebView` 明確啟用 `webView.settings.setGeolocationEnabled(true)`。
 */
class MyMapWebViewClient(
    private val sanitizedAuthUserAgent: String = DESKTOP_CHROME_UA,
    private val onPageLoadingChanged: (Boolean) -> Unit = {},
    private val onUrlChanged: (String) -> Unit = {},
    private val onUserAgentModeChanged: (UserAgentMode) -> Unit = {},
    private val onErrorReceived: (String?) -> Unit = {},
    private val onPageReadyForInjection: (WebView, String?) -> Unit = { _, _ -> },
    private val onRenderProcessGoneRecovered: (WebView?, Boolean) -> Unit = { _, _ -> }
) : WebViewClient() {

    enum class UserAgentMode {
        /** Google OAuth 登入驗證頁面（Phase 6 起同樣維持純桌面版 Chrome UA，僅供 UI 隱藏底部編輯工具列） */
        AUTH_CLEAN_CHROME,
        /** Google 我的地圖列表與編輯頁面：強制使用 Windows 桌面版 Chrome UA */
        DESKTOP_EDITOR
    }

    // 記錄最近一次白屏自動重載時間戳，避免離線或異常時陷入無限重載迴圈
    private var lastBlankRecoveryTimestampMs: Long = 0L

    companion object {
        private const val TAG = "MyMapWebViewClient"
        private const val BLANK_RECOVERY_COOLDOWN_MS = 2_500L

        /** Google 我的地圖首頁網址 */
        const val MY_MAPS_HOME_URL = "https://www.google.com/maps/d/"

        /** 強制且一致套用之純桌面版 Chrome User-Agent（全程無 `; wv` 與 `Version/4.0`） */
        const val DESKTOP_CHROME_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

        /** 當無法取得系統預設 UA 時的乾淨 Android Chrome 備援 UA（不含 `; wv` 與 `Version/4.0`） */
        const val FALLBACK_CLEAN_MOBILE_UA =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"

        /** Google 登入與帳號驗證相關網域清單 */
        private val GOOGLE_AUTH_HOSTS = setOf(
            "accounts.google.com",
            "accounts.youtube.com",
            "myaccount.google.com",
            "gds.google.com"
        )

        /**
         * Phase 6 坑洞 1 防護：
         * 無論目標網址為 OAuth 登入頁或 Google 我的地圖編輯頁，一律回傳純桌面版 Chrome UA (`DESKTOP_CHROME_UA`)，
         * 確保全程絕不出現 `; wv` 或 `Version/4.0`，且不會因中途切換 UA 導致 OAuth Redirect Session 中斷。
         */
        fun resolveUserAgentForUrl(url: String?): String {
            return DESKTOP_CHROME_UA
        }

        /**
         * Phase 6 坑洞 2 防護：
         * 檢查網址是否為空白或無效初始狀態（如 `null`、空字串或 `about:blank`）。
         */
        fun isBlankOrInvalidUrl(url: String?): Boolean {
            if (url.isNullOrBlank()) return true
            val normalized = url.trim()
            return normalized.equals("about:blank", ignoreCase = true)
        }

        /**
         * Phase 6 坑洞 2 防護：
         * 決定白屏或渲染程序回收時應重新載入的目標網址，若目前網址與備援網址皆為空白頁則退回 `MY_MAPS_HOME_URL`。
         */
        fun resolveRecoveryUrl(currentUrl: String?, fallbackUrl: String? = null): String {
            if (!isBlankOrInvalidUrl(currentUrl)) return currentUrl!!.trim()
            if (!isBlankOrInvalidUrl(fallbackUrl)) return fallbackUrl!!.trim()
            return MY_MAPS_HOME_URL
        }

        /**
         * 將 Android WebView 預設的 User-Agent 淨化為標準 Chrome UA：
         * 1. 移除 `; wv` 或獨立的 `wv` 標記
         * 2. 移除 `Version/x.x` 標記
         * 3. 確保絕不觸發 Google OAuth `403 disallowed_useragent`
         */
        fun buildSanitizedAuthUserAgent(rawDefaultUa: String?): String {
            if (rawDefaultUa.isNullOrBlank()) {
                return FALLBACK_CLEAN_MOBILE_UA
            }
            val cleaned = rawDefaultUa
                // 移除常見的 "; wv)" -> ")"
                .replace(Regex(";\\s*wv\\s*\\)"), ")")
                // 移除 "; wv;" -> ";"
                .replace(Regex(";\\s*wv\\s*;"), ";")
                // 移除任何殘留的 "; wv"
                .replace(Regex(";\\s*wv\\b"), "")
                // 移除 "Version/4.0 " 等 WebView 特有標記
                .replace(Regex("Version/\\d+(\\.\\d+)*\\s*"), "")
                .replace(Regex("\\s{2,}"), " ")
                .trim()

            return if (cleaned.contains("wv", ignoreCase = true) || !cleaned.contains("Chrome")) {
                FALLBACK_CLEAN_MOBILE_UA
            } else {
                cleaned
            }
        }

        /**
         * 判斷指定 URL 是否屬於 Google OAuth 登入驗證流程
         */
        fun isGoogleAuthUrl(url: String?): Boolean {
            if (url.isNullOrBlank()) return false
            val host = try {
                Uri.parse(url).host?.lowercase() ?: return false
            } catch (_: Exception) {
                return false
            }
            return GOOGLE_AUTH_HOSTS.any { authHost ->
                host == authHost || host.endsWith(".$authHost")
            }
        }

        /**
         * 統一配置 WebView 的 Settings、HTML5 Geolocation 與 Cookie 持久化策略。
         * Phase 6 加固：
         * 1. 全程強制且一致地將 `userAgentString` 替換為純桌面版 Chrome 字串 (`DESKTOP_CHROME_UA`)。
         * 2. 明確開啟 `javaScriptEnabled = true`、`domStorageEnabled = true`、`databaseEnabled = true` 與第一方/第三方 Cookie。
         * 3. 明確開啟 `setGeolocationEnabled(true)` 以支援網頁內建 HTML5 Geolocation 定位按鈕。
         */
        @SuppressLint("SetJavaScriptEnabled")
        fun configureWebView(webView: WebView): String {
            // 1. 啟用第一方與第三方 Cookie，確保 Google 帳號 Session 跨網域與重啟持久化
            val cookieManager = CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)
            cookieManager.setAcceptThirdPartyCookies(webView, true)

            // 2. 配置 WebSettings
            webView.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                @Suppress("DEPRECATION")
                databaseEnabled = true

                // Phase 6 坑洞 3 防護：啟用 HTML5 Geolocation 支援網頁內建定位按鈕 (navigator.geolocation)
                setGeolocationEnabled(true)

                // 支援手勢雙指縮放並隱藏老舊的縮放加減按鈕
                setSupportZoom(true)
                builtInZoomControls = true
                displayZoomControls = false

                // 支援桌面版寬視埠與自適應載入
                useWideViewPort = true
                loadWithOverviewMode = true

                // 避免點擊項目或登入時跳出無法控制的外部子視窗
                javaScriptCanOpenWindowsAutomatically = true
                setSupportMultipleWindows(false)

                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                cacheMode = WebSettings.LOAD_DEFAULT

                // Phase 6 坑洞 1 防護：強制且一致地使用純桌面版 Chrome UA，確保全程絕不出現 "; wv" 或 "Version/4.0"
                userAgentString = DESKTOP_CHROME_UA
            }

            Log.d(TAG, "WebView initialized with forced pure Desktop Chrome UA: $DESKTOP_CHROME_UA")
            return DESKTOP_CHROME_UA
        }

        /**
         * 強制將記憶體中的 Cookie 寫入磁碟，確保關閉 App 後重開仍保持登入狀態
         */
        fun flushCookies() {
            try {
                CookieManager.getInstance().flush()
                Log.d(TAG, "Cookies flushed to persistent storage.")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to flush cookies: ${e.message}")
            }
        }

        /**
         * Phase 5：檢查裝置目前是否具備可用的網際網路連線（供離線防呆橫幅與重試檢查使用）
         */
        fun isNetworkAvailable(context: Context): Boolean {
            return try {
                val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                    ?: return true
                val activeNetwork = cm.activeNetwork ?: return false
                val capabilities = cm.getNetworkCapabilities(activeNetwork) ?: return false
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            } catch (e: Exception) {
                Log.w(TAG, "isNetworkAvailable check warning: ${e.message}")
                true
            }
        }
    }

    /**
     * Phase 6 坑洞 1 防護：
     * 確保 WebView 全程維持純桌面版 Chrome User-Agent (`DESKTOP_CHROME_UA`)，
     * 絕不在 OAuth 跳轉過程中動態變更為其他 UA，避免重新呼叫 `loadUrl` 造成 Redirect 或 POST Session 中斷。
     */
    private fun enforceDesktopUserAgent(webView: WebView, url: String?) {
        val targetUa = resolveUserAgentForUrl(url)
        if (webView.settings.userAgentString != targetUa) {
            webView.settings.userAgentString = targetUa
            Log.i(TAG, "Enforced pure Desktop Chrome UA for URL: $url | UA: $targetUa")
        }

        if (!url.isNullOrBlank()) {
            val targetMode = if (isGoogleAuthUrl(url)) {
                UserAgentMode.AUTH_CLEAN_CHROME
            } else {
                UserAgentMode.DESKTOP_EDITOR
            }
            onUserAgentModeChanged(targetMode)
        }
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url ?: return false
        val url = uri.toString()
        val scheme = uri.scheme?.lowercase()

        // 處理非 http/https 的外部協定（例如 intent://, geo:, tel:, mailto:）
        if (scheme != "http" && scheme != "https") {
            return try {
                val intent = if (scheme == "intent") {
                    Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
                } else {
                    Intent(Intent.ACTION_VIEW, uri)
                }
                view.context.startActivity(intent)
                true
            } catch (e: Exception) {
                Log.w(TAG, "Ignored unsupported scheme: $url (${e.message})")
                true
            }
        }

        // Phase 6 坑洞 1 防護：
        // 僅確保主框架維持純桌面版 Chrome UA，移除在 shouldOverrideUrlLoading 中呼叫 view.loadUrl(url) 的行為，
        // 避免打斷 Google OAuth 登入的 POST / 302 Redirect 鏈，確保登入後順暢跳回 https://www.google.com/maps/d/
        if (request.isForMainFrame) {
            enforceDesktopUserAgent(view, url)
        }

        return false
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        enforceDesktopUserAgent(view, url)
        onErrorReceived(null)
        onPageLoadingChanged(true)
        if (!url.isNullOrBlank() && !isBlankOrInvalidUrl(url)) {
            onUrlChanged(url)
        }
        Log.d(TAG, "onPageStarted: $url")
    }

    override fun onPageCommitVisible(view: WebView, url: String?) {
        super.onPageCommitVisible(view, url)
        flushCookies()
        if (!isBlankOrInvalidUrl(url) && !isGoogleAuthUrl(url)) {
            onPageReadyForInjection(view, url)
        }
    }

    override fun onPageFinished(view: WebView, url: String?) {
        super.onPageFinished(view, url)
        enforceDesktopUserAgent(view, url)
        onPageLoadingChanged(false)

        // 每次頁面載入完成時立即將 Cookie 寫入磁碟，確保登入狀態不遺失
        flushCookies()

        // Phase 6 坑洞 2 防護：若頁面異常停留在空白頁 (null、空字串或 about:blank)，自動重新載入 MY_MAPS_HOME_URL
        val effectiveUrl = url ?: view.url
        if (isBlankOrInvalidUrl(effectiveUrl)) {
            val now = System.currentTimeMillis()
            if (now - lastBlankRecoveryTimestampMs > BLANK_RECOVERY_COOLDOWN_MS) {
                lastBlankRecoveryTimestampMs = now
                Log.w(TAG, "Blank URL detected in onPageFinished ($effectiveUrl). Reloading $MY_MAPS_HOME_URL")
                view.loadUrl(MY_MAPS_HOME_URL)
                return
            }
        }

        if (!effectiveUrl.isNullOrBlank()) {
            onUrlChanged(effectiveUrl)
        }
        if (!isGoogleAuthUrl(effectiveUrl)) {
            onPageReadyForInjection(view, effectiveUrl)
        }
        Log.d(TAG, "onPageFinished: $effectiveUrl (UA: ${view.settings.userAgentString})")
    }

    /**
     * Phase 6 坑洞 2 防護：
     * 當系統在背景回收 WebView 渲染程序 (Render Process) 或渲染程序異常崩潰時，
     * 安全攔截（回傳 true 防止 App 崩潰）、持久化 Cookie 並自動重新載入頁面，防止回到前景時停留在空白畫面。
     */
    override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
        val didCrash = detail?.didCrash() == true
        val priority = detail?.rendererPriorityAtExit() ?: -1
        Log.w(
            TAG,
            "onRenderProcessGone intercepted! didCrash=$didCrash, priority=$priority, currentUrl=${view?.url}"
        )
        flushCookies()
        onPageLoadingChanged(false)

        if (view != null) {
            try {
                val recoveryUrl = resolveRecoveryUrl(view.url, MY_MAPS_HOME_URL)
                if (view.settings.userAgentString != DESKTOP_CHROME_UA) {
                    view.settings.userAgentString = DESKTOP_CHROME_UA
                }
                view.loadUrl(recoveryUrl)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to reload WebView in onRenderProcessGone: ${e.message}")
            }
        }
        onRenderProcessGoneRecovered(view, didCrash)
        return true
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError
    ) {
        super.onReceivedError(view, request, error)
        if (request.isForMainFrame) {
            val errMsg = "${error.description} (Code: ${error.errorCode})"
            Log.e(TAG, "MainFrame error on ${request.url}: $errMsg")
            onErrorReceived(errMsg)
        }
    }
}

