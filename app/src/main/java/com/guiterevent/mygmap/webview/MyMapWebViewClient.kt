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
 * MyGMap 專屬 WebViewClient (Phase 1 ~ Phase 9 完整相容強化版)：
 *
 * 1. Phase 9「單向階段鎖定 UA」：
 *    - 已完全移除 `WebSettingsCompat.setUserAgentMetadata()`（導航回呼中呼叫會造成 Redirect 停滯），
 *      僅使用標準的 `webView.settings.userAgentString`。
 *    - 啟動時依 `hasGoogleSessionCookie()` 決定初始模式：已登入 → `DESKTOP_EDITOR`，未登入 → `AUTH_CLEAN_CHROME`。
 *    - `AUTH_CLEAN_CHROME` 模式全程保持淨化後的真實機型 UA（含 `CheckCookie` / `SetSID` 等跳轉），
 *      只有在目標網址進入 `isMyMapsUrl(url) == true` 時才單向切換為 `DESKTOP_EDITOR`。
 *    - `DESKTOP_EDITOR` 模式遇到 `ServiceLogin?passive=...` / `SetSID` 等被動驗證重定向時絕不切回，
 *      只有在 `!hasGoogleSessionCookie()` 且 `isInteractiveGoogleSignInUrl(url) == true` 時才切回 `AUTH_CLEAN_CHROME`。
 *    - `onPageStarted` / `onPageFinished` 絕不改動 UA 或 `uaMode`，徹底終結乒乓跳動迴圈。
 * 2. Phase 9 暫時性 DNS / 網路喚醒延遲 (`ERR_NAME_NOT_RESOLVED`) 自動重試一次。
 * 3. 防止重啟 App 後登入狀態遺失、頁面變白，並支援 HTML5 Geolocation 定位授權。
 */
class MyMapWebViewClient(
    private val sanitizedAuthUserAgent: String = FALLBACK_CLEAN_MOBILE_UA,
    private val desktopUserAgent: String = DESKTOP_CHROME_UA,
    initialUaMode: UserAgentMode = UserAgentMode.DESKTOP_EDITOR,
    private val onPageLoadingChanged: (Boolean) -> Unit = {},
    private val onUrlChanged: (String) -> Unit = {},
    private val onUserAgentModeChanged: (UserAgentMode) -> Unit = {},
    private val onErrorReceived: (String?) -> Unit = {},
    private val onPageReadyForInjection: (WebView, String?) -> Unit = { _, _ -> },
    private val onRenderProcessGoneRecovered: (WebView?, Boolean) -> Unit = { _, _ -> }
) : WebViewClient() {

    enum class UserAgentMode {
        /** Google 帳號互動式登入階段：使用保留真實機型、僅移除 `; wv` 與 `Version/x.x` 的行動版 UA */
        AUTH_CLEAN_CHROME,
        /** Google 我的地圖列表與編輯頁面：使用桌面版 Chrome UA */
        DESKTOP_EDITOR
    }

    /**
     * 帳號登入頁面支援的行動瀏覽器相容模式：
     * - [CHROME_MOBILE_STANDARD]：保留真實機型的淨化 Chrome Android UA (預設)
     * - [FIREFOX_MOBILE_STANDARD]：Firefox Android 標準格式 (備用相容模式)
     */
    enum class AuthUaProfile(val displayName: String) {
        CHROME_MOBILE_STANDARD("Chrome Mobile 標準模式"),
        FIREFOX_MOBILE_STANDARD("Firefox Mobile 相容模式")
    }

    /**
     * 儲存從系統 WebView 預設 UA 解析出的 Chromium 主版號與完整版號
     */
    data class ChromiumVersionInfo(
        val major: String,
        val full: String
    )

    /**
     * Phase 9：`configureWebView` 回傳的 UA 配置結果
     */
    data class WebViewUaConfig(
        val sanitizedAuthUa: String,
        val desktopUa: String,
        val initialMode: UserAgentMode
    )

    /** Phase 9：目前鎖定中的 UA 階段（只在 shouldOverrideUrlLoading 或明確的 loadUrl 前切換） */
    @Volatile
    private var currentUaMode: UserAgentMode = initialUaMode

    // 記錄最近一次白屏自動重載時間戳，避免離線或異常時陷入無限重載迴圈
    private var lastBlankRecoveryTimestampMs: Long = 0L

    // Phase 9：記錄最近一次 DNS / 網路暫時性錯誤自動重試的網址與時間，確保同一網址只自動重試一次
    private var lastTransientRetryUrl: String? = null
    private var lastTransientRetryTimestampMs: Long = 0L

    /** 目前鎖定中的 UA 模式（唯讀） */
    val uaMode: UserAgentMode
        get() = currentUaMode

    companion object {
        private const val TAG = "MyMapWebViewClient"
        private const val BLANK_RECOVERY_COOLDOWN_MS = 2_500L

        /** Phase 9：暫時性 DNS / 連線錯誤自動重試延遲與同網址重試冷卻時間 */
        private const val TRANSIENT_ERROR_RETRY_DELAY_MS = 1_200L
        private const val TRANSIENT_ERROR_RETRY_COOLDOWN_MS = 15_000L

        /** 預設 Chromium 主版號與完整版號（當系統 UA 無法解析時作為備援） */
        const val DEFAULT_CHROME_MAJOR = "131"
        const val DEFAULT_CHROME_FULL = "131.0.6778.200"

        /** Google 我的地圖首頁網址 */
        const val MY_MAPS_HOME_URL = "https://www.google.com/maps/d/"

        /** Google 帳號標準登入入口（登入成功後自動導向 Google 我的地圖） */
        const val GOOGLE_SERVICE_LOGIN_URL =
            "https://accounts.google.com/ServiceLogin?hl=zh-TW&continue=https%3A%2F%2Fwww.google.com%2Fmaps%2Fd%2F"

        /** 預設桌面版 Chrome User-Agent（X11; Linux x86_64，不含 `; wv` 與 `Version/4.0`） */
        const val DESKTOP_CHROME_UA =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$DEFAULT_CHROME_MAJOR.0.0.0 Safari/537.36"

        /** 標準 Chrome Android Reduced 格式 UA（不含 `; wv` 與 `Version/4.0`），僅於無法取得系統 UA 時備援 */
        const val FALLBACK_CLEAN_MOBILE_UA =
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$DEFAULT_CHROME_MAJOR.0.0.0 Mobile Safari/537.36"

        /** 備用 Firefox Android 行動版標準 UA */
        const val FIREFOX_MOBILE_UA =
            "Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0"

        /** Phase 9：代表 Google 帳號已登入的 Session Cookie 名稱 */
        val GOOGLE_SESSION_COOKIE_NAMES = setOf(
            "SID",
            "HSID",
            "SSID",
            "__Secure-1PSID",
            "__Secure-3PSID"
        )

        /** Phase 9：背景 / 被動 Session 驗證網址特徵（出現任一者即「非」互動式登入頁） */
        val PASSIVE_AUTH_MARKERS = listOf(
            "passive=true",
            "passive=1209600",
            "checkcookie",
            "setsid",
            "rotatecookies",
            "listaccounts"
        )

        /** 目前登入頁面使用的相容設定檔，預設為 [AuthUaProfile.CHROME_MOBILE_STANDARD] */
        @Volatile
        var activeAuthUaProfile: AuthUaProfile = AuthUaProfile.CHROME_MOBILE_STANDARD

        @Volatile
        private var cachedChromiumVersion: ChromiumVersionInfo? = null

        @Volatile
        private var cachedSanitizedAuthUa: String? = null

        /** Google 登入與帳號驗證相關網域清單 */
        private val GOOGLE_AUTH_HOSTS = setOf(
            "accounts.google.com",
            "accounts.youtube.com",
            "myaccount.google.com",
            "gds.google.com"
        )

        /**
         * 從原始 User-Agent 字串動態解析 Chromium 主版號與完整版號。
         * 若解析失敗則回傳預設值 (`major = "131"`, `full = "131.0.6778.200"`)。
         */
        fun extractChromiumVersion(rawUa: String?): ChromiumVersionInfo {
            if (rawUa.isNullOrBlank()) {
                return ChromiumVersionInfo(DEFAULT_CHROME_MAJOR, DEFAULT_CHROME_FULL)
            }
            val match = Regex("Chrome/(\\d+)(?:\\.(\\d+\\.\\d+\\.\\d+))?").find(rawUa)
                ?: return ChromiumVersionInfo(DEFAULT_CHROME_MAJOR, DEFAULT_CHROME_FULL)

            val major = match.groupValues[1].ifBlank { DEFAULT_CHROME_MAJOR }
            val subVersion = match.groupValues.getOrNull(2).orEmpty()
            val full = if (subVersion.isNotBlank()) {
                "$major.$subVersion"
            } else {
                "$major.0.0.0"
            }
            return ChromiumVersionInfo(major = major, full = full)
        }

        /**
         * 安全讀取系統 WebView 預設 User-Agent（失敗時回傳 `null`）
         */
        private fun readSystemDefaultUserAgent(context: Context?): String? {
            if (context == null) return null
            return try {
                WebSettings.getDefaultUserAgent(context)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to read default user agent: ${e.message}")
                null
            }
        }

        /**
         * 取得目前裝置系統 WebView 的實際 Chromium 版本資訊（含快取）
         */
        fun getSystemChromiumVersion(context: Context?): ChromiumVersionInfo {
            cachedChromiumVersion?.let { return it }
            val resolved = extractChromiumVersion(readSystemDefaultUserAgent(context))
            cachedChromiumVersion = resolved
            return resolved
        }

        /**
         * Phase 9：取得保留真實機型、僅移除 `; wv` 與 `Version/x.x` 的登入用 UA（含快取）
         */
        fun getSanitizedAuthUserAgent(context: Context?): String {
            cachedSanitizedAuthUa?.let { return it }
            val resolved = buildSanitizedAuthUserAgent(readSystemDefaultUserAgent(context))
            cachedSanitizedAuthUa = resolved
            return resolved
        }

        /**
         * 建構標準 Chrome Android Reduced 格式 User-Agent
         */
        fun buildStandardMobileChromeUa(majorVersion: String = DEFAULT_CHROME_MAJOR): String {
            val major = majorVersion.trim().ifBlank { DEFAULT_CHROME_MAJOR }
            return "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$major.0.0.0 Mobile Safari/537.36"
        }

        /**
         * 建構桌面版 Chrome (X11; Linux x86_64) 格式 User-Agent
         */
        fun buildDesktopChromeUa(majorVersion: String = DEFAULT_CHROME_MAJOR): String {
            val major = majorVersion.trim().ifBlank { DEFAULT_CHROME_MAJOR }
            return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$major.0.0.0 Safari/537.36"
        }

        /**
         * Phase 9：依據 [AuthUaProfile] 決定登入階段使用的 UA
         */
        fun resolveAuthUserAgent(
            sanitizedAuthUa: String,
            authProfile: AuthUaProfile = activeAuthUaProfile
        ): String {
            return when (authProfile) {
                AuthUaProfile.CHROME_MOBILE_STANDARD -> sanitizedAuthUa
                AuthUaProfile.FIREFOX_MOBILE_STANDARD -> FIREFOX_MOBILE_UA
            }
        }

        /**
         * 將 Android WebView 預設的 User-Agent 淨化為可通過 Google OAuth 的 Chrome Mobile UA：
         * 1. **僅**移除 `; wv` 與 `Version/x.x` 標記
         * 2. 完整保留真實 Android 版本、真實裝置型號與完整 `Chrome/xxx.0.xxxx.xx` 版號
         * 3. 若 `rawDefaultUa` 為空或不含 `Chrome`，才退回 [FALLBACK_CLEAN_MOBILE_UA]
         */
        fun buildSanitizedAuthUserAgent(rawDefaultUa: String?): String {
            if (rawDefaultUa.isNullOrBlank() || !rawDefaultUa.contains("Chrome/")) {
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

            return if (cleaned.isBlank() ||
                !cleaned.contains("Chrome/") ||
                Regex(";\\s*wv\\b").containsMatchIn(cleaned)
            ) {
                FALLBACK_CLEAN_MOBILE_UA
            } else {
                cleaned
            }
        }

        /**
         * 安全解析網址的 host 與 path（同時相容 Android Runtime 與純 JVM 單元測試環境）
         */
        private fun parseHostAndPath(url: String?): Pair<String, String>? {
            if (url.isNullOrBlank()) return null
            val trimmed = url.trim()
            try {
                val uri = java.net.URI(trimmed)
                val host = uri.host?.lowercase()
                if (!host.isNullOrBlank()) {
                    return host to (uri.rawPath ?: "")
                }
            } catch (_: Exception) {
            }
            // 備援：以正規表示式解析（處理含有不合法字元的網址）
            val match = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#:]+)(?::\\d+)?([^?#]*)").find(trimmed)
                ?: return null
            return match.groupValues[1].lowercase() to match.groupValues[2]
        }

        /**
         * 判斷指定 URL 是否屬於 Google 帳號登入驗證網域
         */
        fun isGoogleAuthUrl(url: String?): Boolean {
            val host = parseHostAndPath(url)?.first ?: return false
            return GOOGLE_AUTH_HOSTS.any { authHost ->
                host == authHost || host.endsWith(".$authHost")
            }
        }

        /**
         * Phase 9：判斷網址是否為 Google 我的地圖（host 屬於 `google.com` 且 path 以 `/maps/d` 開頭）
         */
        fun isMyMapsUrl(url: String?): Boolean {
            val (host, path) = parseHostAndPath(url) ?: return false
            val isGoogleHost = host == "google.com" || host.endsWith(".google.com")
            if (!isGoogleHost || isGoogleAuthUrl(url)) return false
            return path == "/maps/d" || path.startsWith("/maps/d/")
        }

        /**
         * Phase 9：判斷是否為「真正需要使用者輸入帳密的互動式登入頁」：
         * - 必須屬於 `isGoogleAuthUrl(url) == true`
         * - 且網址不得包含 `passive=true`、`passive=1209600`、`CheckCookie`、`SetSID`、
         *   `RotateCookies`、`ListAccounts` 等背景 / 被動驗證特徵
         */
        fun isInteractiveGoogleSignInUrl(url: String?): Boolean {
            if (!isGoogleAuthUrl(url)) return false
            val lower = url!!.lowercase()
            return PASSIVE_AUTH_MARKERS.none { marker -> lower.contains(marker) }
        }

        /**
         * Phase 9：解析原始 Cookie 字串，判斷是否包含已登入的 Google Session Cookie
         * (`SID`、`HSID`、`SSID`、`__Secure-1PSID`、`__Secure-3PSID`，且值不為空)
         */
        fun containsGoogleSessionCookie(rawCookie: String?): Boolean {
            if (rawCookie.isNullOrBlank()) return false
            return rawCookie.split(";").any { pair ->
                val name = pair.substringBefore("=").trim()
                val value = pair.substringAfter("=", "").trim()
                name in GOOGLE_SESSION_COOKIE_NAMES && value.isNotEmpty()
            }
        }

        /**
         * Phase 9：檢查 `CookieManager` 中 `www.google.com` 或 `accounts.google.com` 是否已有登入 Session Cookie
         */
        fun hasGoogleSessionCookie(): Boolean {
            return try {
                val cookieManager = CookieManager.getInstance() ?: return false
                containsGoogleSessionCookie(cookieManager.getCookie("https://www.google.com")) ||
                    containsGoogleSessionCookie(cookieManager.getCookie("https://accounts.google.com"))
            } catch (e: Throwable) {
                Log.w(TAG, "hasGoogleSessionCookie check warning: ${e.message}")
                false
            }
        }

        /**
         * Phase 9：決定啟動時的初始載入網址
         * - 已登入：[MY_MAPS_HOME_URL]
         * - 未登入：直接進入 [GOOGLE_SERVICE_LOGIN_URL]
         */
        fun resolveInitialLoadUrl(): String {
            return if (hasGoogleSessionCookie()) MY_MAPS_HOME_URL else GOOGLE_SERVICE_LOGIN_URL
        }

        /**
         * Phase 9：以「單向階段鎖定 UA」規則從 App 端明確載入網址（首頁按鈕、錯誤恢復等）。
         * - 目標為我的地圖且已登入：先切換為 `DESKTOP_EDITOR` 再載入。
         * - 目標為我的地圖但尚未登入：改為以 `AUTH_CLEAN_CHROME` 載入 [GOOGLE_SERVICE_LOGIN_URL]。
         * - 其他網址：維持目前鎖定的 UA 直接載入。
         */
        fun loadUrlWithLockedUa(webView: WebView, url: String) {
            val client = webView.webViewClient as? MyMapWebViewClient
            if (client == null) {
                webView.loadUrl(url)
                return
            }
            val targetUrl = if (isMyMapsUrl(url) && !hasGoogleSessionCookie()) {
                GOOGLE_SERVICE_LOGIN_URL
            } else {
                url
            }
            when {
                isMyMapsUrl(targetUrl) -> client.switchUaMode(webView, UserAgentMode.DESKTOP_EDITOR)
                targetUrl == GOOGLE_SERVICE_LOGIN_URL && !hasGoogleSessionCookie() ->
                    client.switchUaMode(webView, UserAgentMode.AUTH_CLEAN_CHROME)
            }
            webView.loadUrl(targetUrl)
        }

        /**
         * 檢查網址是否為登入遭拒或需要重試的狀態（如包含 `/signin/rejected` 或 `disallowed_useragent`）
         */
        fun isSignInRejectedUrl(url: String?): Boolean {
            if (url.isNullOrBlank()) return false
            val lower = url.lowercase()
            return lower.contains("/signin/rejected") ||
                lower.contains("disallowed_useragent") ||
                lower.contains("/v3/signin/rejected")
        }

        /**
         * Phase 8 / Phase 9：切換 `AuthUaProfile`、清理 Google 舊狀態 Cookie，
         * 強制切換為 `AUTH_CLEAN_CHROME` 並重新載入 Google 登入頁。
         */
        fun resetGoogleAuthStateAndReload(webView: WebView): AuthUaProfile {
            val nextProfile = when (activeAuthUaProfile) {
                AuthUaProfile.CHROME_MOBILE_STANDARD -> AuthUaProfile.FIREFOX_MOBILE_STANDARD
                AuthUaProfile.FIREFOX_MOBILE_STANDARD -> AuthUaProfile.CHROME_MOBILE_STANDARD
            }
            activeAuthUaProfile = nextProfile

            try {
                val cookieManager = CookieManager.getInstance()
                val authDomains = listOf(
                    "https://accounts.google.com",
                    "https://www.google.com"
                )
                for (domain in authDomains) {
                    val rawCookie = cookieManager.getCookie(domain) ?: continue
                    rawCookie.split(";").forEach { pair ->
                        val cookieName = pair.substringBefore("=").trim()
                        if (cookieName.isNotEmpty()) {
                            cookieManager.setCookie(
                                domain,
                                "$cookieName=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/"
                            )
                        }
                    }
                }
                cookieManager.flush()
            } catch (e: Exception) {
                Log.w(TAG, "Failed to clear auth domain cookies: ${e.message}")
            }

            try {
                webView.clearCache(false)
            } catch (_: Exception) {
            }

            val client = webView.webViewClient as? MyMapWebViewClient
            if (client != null) {
                client.switchUaMode(webView, UserAgentMode.AUTH_CLEAN_CHROME, forceApply = true)
            } else {
                webView.settings.userAgentString = resolveAuthUserAgent(
                    getSanitizedAuthUserAgent(webView.context),
                    nextProfile
                )
            }
            webView.loadUrl(GOOGLE_SERVICE_LOGIN_URL)
            return nextProfile
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
         * Phase 9：檢查網址是否為 Android WebView 內建錯誤頁（`chrome-error://chromewebdata/`）
         */
        fun isChromeErrorUrl(url: String?): Boolean {
            if (url.isNullOrBlank()) return false
            val lower = url.trim().lowercase()
            return lower.startsWith("chrome-error:") || lower.contains("chromewebdata")
        }

        /**
         * Phase 6 坑洞 2 防護：
         * 決定白屏或渲染程序回收時應重新載入的目標網址，若目前網址與備援網址皆為空白頁 / 錯誤頁則退回 `MY_MAPS_HOME_URL`。
         */
        fun resolveRecoveryUrl(currentUrl: String?, fallbackUrl: String? = null): String {
            if (!isBlankOrInvalidUrl(currentUrl) && !isChromeErrorUrl(currentUrl)) return currentUrl!!.trim()
            if (!isBlankOrInvalidUrl(fallbackUrl) && !isChromeErrorUrl(fallbackUrl)) return fallbackUrl!!.trim()
            return MY_MAPS_HOME_URL
        }

        /**
         * 統一配置 WebView 的 Settings、HTML5 Geolocation 與 Cookie 持久化策略，
         * 並依 Phase 9 規則決定初始 UA 階段：
         * - `hasGoogleSessionCookie() == true`：`desktopUa` + `DESKTOP_EDITOR`
         * - `hasGoogleSessionCookie() == false`：`sanitizedAuthUa` + `AUTH_CLEAN_CHROME`
         */
        @SuppressLint("SetJavaScriptEnabled")
        fun configureWebView(webView: WebView): WebViewUaConfig {
            // 1. 啟用第一方與第三方 Cookie，確保 Google 帳號 Session 跨網域與重啟持久化
            val cookieManager = CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)
            cookieManager.setAcceptThirdPartyCookies(webView, true)

            val versionInfo = getSystemChromiumVersion(webView.context)
            val desktopUa = buildDesktopChromeUa(versionInfo.major)
            val sanitizedAuthUa = getSanitizedAuthUserAgent(webView.context)

            val isLoggedIn = hasGoogleSessionCookie()
            val initialMode = if (isLoggedIn) {
                UserAgentMode.DESKTOP_EDITOR
            } else {
                UserAgentMode.AUTH_CLEAN_CHROME
            }
            val initialUa = if (isLoggedIn) {
                desktopUa
            } else {
                resolveAuthUserAgent(sanitizedAuthUa)
            }

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

                // Phase 11：開啟多視窗支援，搭配 WebChromeClient.onCreateWindow 攔截 <a target="_blank"> 與 window.open 導航連結
                javaScriptCanOpenWindowsAutomatically = true
                setSupportMultipleWindows(true)

                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                cacheMode = WebSettings.LOAD_DEFAULT

                // Phase 9：僅使用標準 userAgentString，不再呼叫 WebSettingsCompat.setUserAgentMetadata()
                userAgentString = initialUa
            }

            Log.d(
                TAG,
                "WebView initialized (Chromium ${versionInfo.full}, loggedIn=$isLoggedIn, mode=$initialMode, UA=$initialUa)"
            )
            return WebViewUaConfig(
                sanitizedAuthUa = sanitizedAuthUa,
                desktopUa = desktopUa,
                initialMode = initialMode
            )
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

        /**
         * Phase 9：判斷主框架錯誤是否為暫時性 DNS / 網路喚醒延遲（可自動重試）
         */
        fun isTransientNetworkError(errorCode: Int, description: String?): Boolean {
            val desc = description.orEmpty()
            return errorCode == WebViewClient.ERROR_HOST_LOOKUP ||
                errorCode == WebViewClient.ERROR_CONNECT ||
                errorCode == WebViewClient.ERROR_TIMEOUT ||
                desc.contains("ERR_NAME_NOT_RESOLVED", ignoreCase = true) ||
                desc.contains("ERR_INTERNET_DISCONNECTED", ignoreCase = true) ||
                desc.contains("ERR_NETWORK_CHANGED", ignoreCase = true)
        }
    }

    /**
     * Phase 9：切換鎖定的 UA 階段（僅在模式真的改變或 [forceApply] 時寫入 `userAgentString` 並通知 UI）。
     * @return `true` 代表 UA 字串實際發生變更
     */
    internal fun switchUaMode(
        webView: WebView,
        targetMode: UserAgentMode,
        forceApply: Boolean = false
    ): Boolean {
        if (currentUaMode == targetMode && !forceApply) return false
        currentUaMode = targetMode
        val targetUa = when (targetMode) {
            UserAgentMode.AUTH_CLEAN_CHROME -> resolveAuthUserAgent(sanitizedAuthUserAgent)
            UserAgentMode.DESKTOP_EDITOR -> desktopUserAgent
        }
        val changed = webView.settings.userAgentString != targetUa
        if (changed) {
            webView.settings.userAgentString = targetUa
        }
        Log.i(TAG, "UA mode locked -> $targetMode (changed=$changed): $targetUa")
        onUserAgentModeChanged(targetMode)
        return changed
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url ?: return false
        val url = uri.toString()
        val scheme = uri.scheme?.lowercase()

        // 處理非 http/https 的外部協定（例如 intent://, geo:, google.navigation:, tel:, mailto:）
        if (scheme != "http" && scheme != "https") {
            if (scheme == "intent" || MapExportAndIntentHelper.isExternalGoogleMapsUrl(url)) {
                MapExportAndIntentHelper.openExternalMapsUrlInGoogleMapsApp(view.context, url)
                return true
            }
            return try {
                val intent = Intent(Intent.ACTION_VIEW, uri)
                view.context.startActivity(intent)
                true
            } catch (e: Exception) {
                Log.w(TAG, "Ignored unsupported scheme: $url (${e.message})")
                true
            }
        }

        if (!request.isForMainFrame) return false

        // Phase 11：攔截 HTTPS 版外部 Google Maps 導航 / 地點 / 短網址，直接轉交官方 Google Maps App
        if (MapExportAndIntentHelper.isExternalGoogleMapsUrl(url)) {
            MapExportAndIntentHelper.openExternalMapsUrlInGoogleMapsApp(view.context, url)
            return true
        }

        val isGetRequest = request.method.isNullOrBlank() || request.method.equals("GET", ignoreCase = true)

        when (currentUaMode) {
            UserAgentMode.AUTH_CLEAN_CHROME -> {
                // 登入階段：全程保持淨化行動版 UA（包含 CheckCookie / SetSID 等跳轉），
                // 只有目標網址進入 Google 我的地圖時才單向切換為桌面版
                if (isMyMapsUrl(url)) {
                    val changed = switchUaMode(view, UserAgentMode.DESKTOP_EDITOR)
                    if (changed && isGetRequest) {
                        Log.i(TAG, "Login completed, reloading My Maps with desktop UA: $url")
                        view.loadUrl(url)
                        return true
                    }
                }
            }
            UserAgentMode.DESKTOP_EDITOR -> {
                // 桌面階段：被動驗證 (passive / CheckCookie / SetSID ...) 重定向一律放行不切換，
                // 只有在確定未登入且為互動式登入頁時才切回登入模式
                if (!hasGoogleSessionCookie() && isInteractiveGoogleSignInUrl(url)) {
                    val changed = switchUaMode(view, UserAgentMode.AUTH_CLEAN_CHROME)
                    if (changed && isGetRequest) {
                        Log.i(TAG, "Interactive sign-in required, reloading with auth UA: $url")
                        view.loadUrl(url)
                        return true
                    }
                }
            }
        }

        return false
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        // Phase 9：此處絕不改動 userAgentString 或 uaMode，避免載入過程中的模式閃爍
        onErrorReceived(null)
        onPageLoadingChanged(true)
        if (!url.isNullOrBlank() && !isBlankOrInvalidUrl(url) && !isChromeErrorUrl(url)) {
            onUrlChanged(url)
        }
        Log.d(TAG, "onPageStarted: $url (mode=$currentUaMode)")
    }

    override fun onPageCommitVisible(view: WebView, url: String?) {
        super.onPageCommitVisible(view, url)
        flushCookies()
        if (!isBlankOrInvalidUrl(url) && !isChromeErrorUrl(url) && !isGoogleAuthUrl(url)) {
            onPageReadyForInjection(view, url)
        }
    }

    override fun onPageFinished(view: WebView, url: String?) {
        super.onPageFinished(view, url)
        // Phase 9：此處絕不改動 userAgentString 或 uaMode
        onPageLoadingChanged(false)

        // 每次頁面載入完成時立即將 Cookie 寫入磁碟，確保登入狀態不遺失
        flushCookies()

        val effectiveUrl = url ?: view.url

        // Android 內建錯誤頁：交由 onReceivedError 的自動重試或 UI 錯誤面板處理
        if (isChromeErrorUrl(effectiveUrl)) {
            Log.d(TAG, "onPageFinished on chrome error page: $effectiveUrl")
            return
        }

        // Phase 6 坑洞 2 防護：若頁面異常停留在空白頁 (null、空字串或 about:blank)，自動重新載入初始網址
        if (isBlankOrInvalidUrl(effectiveUrl)) {
            val now = System.currentTimeMillis()
            if (now - lastBlankRecoveryTimestampMs > BLANK_RECOVERY_COOLDOWN_MS) {
                lastBlankRecoveryTimestampMs = now
                val recoveryUrl = resolveInitialLoadUrl()
                Log.w(TAG, "Blank URL detected in onPageFinished ($effectiveUrl). Reloading $recoveryUrl")
                loadUrlWithLockedUa(view, recoveryUrl)
                return
            }
        }

        if (!effectiveUrl.isNullOrBlank()) {
            onUrlChanged(effectiveUrl)
        }
        if (!isGoogleAuthUrl(effectiveUrl)) {
            onPageReadyForInjection(view, effectiveUrl)
        }
        Log.d(TAG, "onPageFinished: $effectiveUrl (mode=$currentUaMode, UA: ${view.settings.userAgentString})")
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
                val recoveryUrl = resolveRecoveryUrl(view.url, resolveInitialLoadUrl())
                loadUrlWithLockedUa(view, recoveryUrl)
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
        if (!request.isForMainFrame) return

        val failedUrl = request.url?.toString().orEmpty()
        val errMsg = "${error.description} (Code: ${error.errorCode})"
        Log.e(TAG, "MainFrame error on $failedUrl: $errMsg")

        // Phase 9：暫時性 DNS / 網路喚醒延遲 (ERR_NAME_NOT_RESOLVED 等) → 停止載入並於 1.2 秒後自動重試一次
        val now = System.currentTimeMillis()
        val alreadyRetried = failedUrl == lastTransientRetryUrl &&
            now - lastTransientRetryTimestampMs < TRANSIENT_ERROR_RETRY_COOLDOWN_MS
        if (failedUrl.isNotBlank() &&
            !alreadyRetried &&
            isTransientNetworkError(error.errorCode, error.description?.toString())
        ) {
            lastTransientRetryUrl = failedUrl
            lastTransientRetryTimestampMs = now
            try {
                view.stopLoading()
            } catch (_: Exception) {
            }
            Log.w(TAG, "Transient network error, retrying once in ${TRANSIENT_ERROR_RETRY_DELAY_MS}ms: $failedUrl")
            view.postDelayed({
                if (!view.isAttachedToWindow) return@postDelayed
                if (isNetworkAvailable(view.context)) {
                    onErrorReceived(null)
                    view.loadUrl(failedUrl)
                } else {
                    onErrorReceived(errMsg)
                }
            }, TRANSIENT_ERROR_RETRY_DELAY_MS)
            return
        }

        onErrorReceived(errMsg)
    }
}
