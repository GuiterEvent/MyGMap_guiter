package com.guiterevent.mygmap

import com.guiterevent.mygmap.webview.MyMapWebViewClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UserAgentStrategyTest {

    @Test
    fun `extractChromiumVersion parses major and full version from system WebView UA with fallback`() {
        val rawWebViewUa =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.200 Mobile Safari/537.36"

        val parsed = MyMapWebViewClient.extractChromiumVersion(rawWebViewUa)
        assertEquals("131", parsed.major)
        assertEquals("131.0.6778.200", parsed.full)

        val customVersionUa =
            "Mozilla/5.0 (Linux; Android 13; SM-S918B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.146 Mobile Safari/537.36"
        val parsedCustom = MyMapWebViewClient.extractChromiumVersion(customVersionUa)
        assertEquals("128", parsedCustom.major)
        assertEquals("128.0.6613.146", parsedCustom.full)

        val fallbackNull = MyMapWebViewClient.extractChromiumVersion(null)
        assertEquals(MyMapWebViewClient.DEFAULT_CHROME_MAJOR, fallbackNull.major)
        assertEquals(MyMapWebViewClient.DEFAULT_CHROME_FULL, fallbackNull.full)

        val fallbackInvalid = MyMapWebViewClient.extractChromiumVersion("Mozilla/5.0 Gecko/20100101")
        assertEquals("131", fallbackInvalid.major)
        assertEquals("131.0.6778.200", fallbackInvalid.full)
    }

    @Test
    fun `buildSanitizedAuthUserAgent only strips wv and Version markers while keeping real device model and full Chrome version`() {
        val rawWebViewUa =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.70 Mobile Safari/537.36"

        val cleanedUa = MyMapWebViewClient.buildSanitizedAuthUserAgent(rawWebViewUa)

        assertEquals(
            "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A.240205.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Mobile Safari/537.36",
            cleanedUa
        )
        assertFalse("Cleaned UA must not contain '; wv'", cleanedUa.contains("; wv"))
        assertFalse("Cleaned UA must not contain 'Version/'", cleanedUa.contains("Version/"))
        assertTrue("Cleaned UA must keep real Android version", cleanedUa.contains("Android 14"))
        assertTrue("Cleaned UA must keep real device model", cleanedUa.contains("Pixel 8"))
        assertTrue("Cleaned UA must keep full Chrome version", cleanedUa.contains("Chrome/129.0.6668.70"))
        assertFalse("Cleaned UA must not be replaced by reduced 'Android 10; K'", cleanedUa.contains("Android 10; K"))

        val samsungUa =
            "Mozilla/5.0 (Linux; Android 13; SM-S918B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.146 Mobile Safari/537.36"
        assertEquals(
            "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.146 Mobile Safari/537.36",
            MyMapWebViewClient.buildSanitizedAuthUserAgent(samsungUa)
        )
    }

    @Test
    fun `buildSanitizedAuthUserAgent falls back only when raw UA is blank or lacks Chrome`() {
        assertEquals(
            MyMapWebViewClient.FALLBACK_CLEAN_MOBILE_UA,
            MyMapWebViewClient.buildSanitizedAuthUserAgent(null)
        )
        assertEquals(
            MyMapWebViewClient.FALLBACK_CLEAN_MOBILE_UA,
            MyMapWebViewClient.buildSanitizedAuthUserAgent("   ")
        )
        assertEquals(
            MyMapWebViewClient.FALLBACK_CLEAN_MOBILE_UA,
            MyMapWebViewClient.buildSanitizedAuthUserAgent("Mozilla/5.0 (Linux; Android 14; wv) Gecko/20100101")
        )
    }

    @Test
    fun `desktop UA builder produces clean desktop Chrome string`() {
        val desktopUa = MyMapWebViewClient.buildDesktopChromeUa("131")
        assertEquals(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            desktopUa
        )
        assertFalse(desktopUa.contains("Mobile"))
        assertFalse(desktopUa.contains("; wv"))
        assertFalse(desktopUa.contains("Version/"))
    }

    @Test
    fun `resolveAuthUserAgent follows active AuthUaProfile`() {
        val sanitized = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Mobile Safari/537.36"
        assertEquals(
            sanitized,
            MyMapWebViewClient.resolveAuthUserAgent(
                sanitized,
                MyMapWebViewClient.AuthUaProfile.CHROME_MOBILE_STANDARD
            )
        )
        assertEquals(
            MyMapWebViewClient.FIREFOX_MOBILE_UA,
            MyMapWebViewClient.resolveAuthUserAgent(
                sanitized,
                MyMapWebViewClient.AuthUaProfile.FIREFOX_MOBILE_STANDARD
            )
        )
    }

    @Test
    fun `isMyMapsUrl detects only Google My Maps pages`() {
        assertTrue(MyMapWebViewClient.isMyMapsUrl("https://www.google.com/maps/d/"))
        assertTrue(MyMapWebViewClient.isMyMapsUrl("https://www.google.com/maps/d"))
        assertTrue(MyMapWebViewClient.isMyMapsUrl("https://www.google.com/maps/d/u/0/edit?mid=1abc123"))
        assertTrue(MyMapWebViewClient.isMyMapsUrl("https://www.google.com/maps/d/viewer?mid=1abc123&ll=25.03,121.56"))
        assertTrue(MyMapWebViewClient.isMyMapsUrl("https://google.com/maps/d/"))

        assertFalse(MyMapWebViewClient.isMyMapsUrl(null))
        assertFalse(MyMapWebViewClient.isMyMapsUrl(""))
        assertFalse(MyMapWebViewClient.isMyMapsUrl("about:blank"))
        assertFalse(MyMapWebViewClient.isMyMapsUrl("https://www.google.com/maps/"))
        assertFalse(MyMapWebViewClient.isMyMapsUrl("https://www.google.com/maps/dir/"))
        assertFalse(MyMapWebViewClient.isMyMapsUrl("https://www.google.com/search?q=maps/d"))
        assertFalse(MyMapWebViewClient.isMyMapsUrl(MyMapWebViewClient.GOOGLE_SERVICE_LOGIN_URL))
        assertFalse(MyMapWebViewClient.isMyMapsUrl("https://evilgoogle.com/maps/d/"))
        assertFalse(
            MyMapWebViewClient.isMyMapsUrl(
                "https://accounts.google.com/ServiceLogin?passive=1209600&continue=https://www.google.com/maps/d/"
            )
        )
    }

    @Test
    fun `isInteractiveGoogleSignInUrl excludes passive and background session checks`() {
        // 真正需要使用者輸入帳密的互動式登入頁
        assertTrue(MyMapWebViewClient.isInteractiveGoogleSignInUrl(MyMapWebViewClient.GOOGLE_SERVICE_LOGIN_URL))
        assertTrue(
            MyMapWebViewClient.isInteractiveGoogleSignInUrl(
                "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fwww.google.com%2Fmaps%2Fd%2F&flowName=GlifWebSignIn"
            )
        )
        assertTrue(MyMapWebViewClient.isInteractiveGoogleSignInUrl("https://accounts.google.com/signin/v2/challenge/pwd"))

        // 背景 / 被動 Session 驗證：絕不可視為互動式登入
        val passiveUrls = listOf(
            "https://accounts.google.com/ServiceLogin?service=mapsengine&passive=1209600&continue=https://www.google.com/maps/d/",
            "https://accounts.google.com/ServiceLogin?passive=true&continue=https://www.google.com/maps/d/",
            "https://accounts.google.com/CheckCookie?continue=https://www.google.com/maps/d/",
            "https://accounts.google.com/accounts/SetSID?ssdc=1&sidt=abc",
            "https://accounts.google.com/RotateCookies",
            "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser"
        )
        for (url in passiveUrls) {
            assertFalse("Passive URL must not be interactive: $url", MyMapWebViewClient.isInteractiveGoogleSignInUrl(url))
        }

        // 非 Google 帳號網域
        assertFalse(MyMapWebViewClient.isInteractiveGoogleSignInUrl(MyMapWebViewClient.MY_MAPS_HOME_URL))
        assertFalse(MyMapWebViewClient.isInteractiveGoogleSignInUrl(null))
        assertFalse(MyMapWebViewClient.isInteractiveGoogleSignInUrl(""))
    }

    @Test
    fun `isGoogleAuthUrl detects Google account hosts`() {
        assertTrue(MyMapWebViewClient.isGoogleAuthUrl("https://accounts.google.com/ServiceLogin?service=local"))
        assertTrue(MyMapWebViewClient.isGoogleAuthUrl("https://accounts.google.com/v3/signin/identifier"))
        assertTrue(MyMapWebViewClient.isGoogleAuthUrl("https://myaccount.google.com/"))
        assertTrue(MyMapWebViewClient.isGoogleAuthUrl("https://gds.google.com/"))
        assertFalse(MyMapWebViewClient.isGoogleAuthUrl(MyMapWebViewClient.MY_MAPS_HOME_URL))
        assertFalse(MyMapWebViewClient.isGoogleAuthUrl(null))
    }

    @Test
    fun `containsGoogleSessionCookie detects signed-in session cookie names exactly`() {
        assertTrue(MyMapWebViewClient.containsGoogleSessionCookie("NID=123; SID=abcdef; HSID=xyz"))
        assertTrue(MyMapWebViewClient.containsGoogleSessionCookie("NID=1; __Secure-1PSID=token"))
        assertTrue(MyMapWebViewClient.containsGoogleSessionCookie("__Secure-3PSID=token"))
        assertTrue(MyMapWebViewClient.containsGoogleSessionCookie("SSID=abc"))

        assertFalse(MyMapWebViewClient.containsGoogleSessionCookie(null))
        assertFalse(MyMapWebViewClient.containsGoogleSessionCookie(""))
        assertFalse(MyMapWebViewClient.containsGoogleSessionCookie("NID=123; AEC=abc; CONSENT=YES"))
        // 名稱需完全相符（OSID / __Secure-1PSIDTS 不代表已登入），且值不可為空
        assertFalse(MyMapWebViewClient.containsGoogleSessionCookie("OSID=abc; __Secure-1PSIDTS=xyz"))
        assertFalse(MyMapWebViewClient.containsGoogleSessionCookie("SID=; HSID="))
    }

    @Test
    fun `isTransientNetworkError recognizes DNS wake-up failures`() {
        assertTrue(MyMapWebViewClient.isTransientNetworkError(-2, "net::ERR_NAME_NOT_RESOLVED"))
        assertTrue(MyMapWebViewClient.isTransientNetworkError(0, "net::ERR_NAME_NOT_RESOLVED"))
        assertTrue(MyMapWebViewClient.isTransientNetworkError(-6, null))
        assertTrue(MyMapWebViewClient.isTransientNetworkError(-8, null))
        assertFalse(MyMapWebViewClient.isTransientNetworkError(-11, "net::ERR_SSL_PROTOCOL_ERROR"))
    }

    @Test
    fun `isSignInRejectedUrl detects signin rejected paths`() {
        assertTrue(MyMapWebViewClient.isSignInRejectedUrl("https://accounts.google.com/v3/signin/rejected?hl=zh-TW"))
        assertTrue(MyMapWebViewClient.isSignInRejectedUrl("https://accounts.google.com/signin/rejected"))
        assertFalse(MyMapWebViewClient.isSignInRejectedUrl("https://accounts.google.com/ServiceLogin"))
        assertFalse(MyMapWebViewClient.isSignInRejectedUrl(MyMapWebViewClient.MY_MAPS_HOME_URL))
    }

    @Test
    fun `isBlankOrInvalidUrl and resolveRecoveryUrl guard against white screen and chrome error URLs`() {
        assertTrue(MyMapWebViewClient.isBlankOrInvalidUrl(null))
        assertTrue(MyMapWebViewClient.isBlankOrInvalidUrl(""))
        assertTrue(MyMapWebViewClient.isBlankOrInvalidUrl("   "))
        assertTrue(MyMapWebViewClient.isBlankOrInvalidUrl("about:blank"))
        assertTrue(MyMapWebViewClient.isBlankOrInvalidUrl("ABOUT:BLANK"))

        assertFalse(MyMapWebViewClient.isBlankOrInvalidUrl(MyMapWebViewClient.MY_MAPS_HOME_URL))
        assertFalse(MyMapWebViewClient.isBlankOrInvalidUrl("https://www.google.com/maps/d/edit?mid=123"))

        assertTrue(MyMapWebViewClient.isChromeErrorUrl("chrome-error://chromewebdata/"))
        assertFalse(MyMapWebViewClient.isChromeErrorUrl(MyMapWebViewClient.MY_MAPS_HOME_URL))

        assertEquals(
            MyMapWebViewClient.MY_MAPS_HOME_URL,
            MyMapWebViewClient.resolveRecoveryUrl(currentUrl = "about:blank", fallbackUrl = null)
        )
        assertEquals(
            MyMapWebViewClient.MY_MAPS_HOME_URL,
            MyMapWebViewClient.resolveRecoveryUrl(currentUrl = null, fallbackUrl = "about:blank")
        )
        assertEquals(
            "https://www.google.com/maps/d/edit?mid=123",
            MyMapWebViewClient.resolveRecoveryUrl(
                currentUrl = "about:blank",
                fallbackUrl = "https://www.google.com/maps/d/edit?mid=123"
            )
        )
        assertEquals(
            MyMapWebViewClient.GOOGLE_SERVICE_LOGIN_URL,
            MyMapWebViewClient.resolveRecoveryUrl(
                currentUrl = "chrome-error://chromewebdata/",
                fallbackUrl = MyMapWebViewClient.GOOGLE_SERVICE_LOGIN_URL
            )
        )
    }
}
