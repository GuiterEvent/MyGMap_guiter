package com.guiterevent.mygmap

import com.guiterevent.mygmap.webview.MyMapWebViewClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UserAgentStrategyTest {

    @Test
    fun `desktop user agent matches expected pure Chrome desktop string without wv or Version markers`() {
        val expectedDesktopUa =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

        assertEquals(expectedDesktopUa, MyMapWebViewClient.DESKTOP_CHROME_UA)
        assertTrue(MyMapWebViewClient.DESKTOP_CHROME_UA.contains("Windows NT 10.0; Win64; x64"))
        assertTrue(MyMapWebViewClient.DESKTOP_CHROME_UA.contains("Chrome/124.0.0.0"))
        assertFalse("Desktop UA must never contain '; wv'", MyMapWebViewClient.DESKTOP_CHROME_UA.contains("; wv"))
        assertFalse("Desktop UA must never contain 'wv'", MyMapWebViewClient.DESKTOP_CHROME_UA.contains("wv", ignoreCase = true))
        assertFalse("Desktop UA must never contain 'Version/4.0'", MyMapWebViewClient.DESKTOP_CHROME_UA.contains("Version/"))
    }

    @Test
    fun `resolveUserAgentForUrl consistently enforces pure desktop Chrome UA across OAuth and My Maps URLs`() {
        val testUrls = listOf(
            "https://www.google.com/maps/d/",
            "https://www.google.com/maps/d/u/0/edit?mid=1abc123",
            "https://accounts.google.com/ServiceLogin?service=local",
            "https://accounts.google.com/v3/signin/identifier",
            "https://myaccount.google.com/",
            "https://gds.google.com/",
            "",
            null
        )

        for (url in testUrls) {
            val resolvedUa = MyMapWebViewClient.resolveUserAgentForUrl(url)
            assertEquals(
                "UA must remain consistent pure Desktop Chrome UA for url=$url",
                MyMapWebViewClient.DESKTOP_CHROME_UA,
                resolvedUa
            )
            assertFalse(resolvedUa.contains("; wv"))
            assertFalse(resolvedUa.contains("Version/4.0"))
        }
    }

    @Test
    fun `buildSanitizedAuthUserAgent removes wv and Version markers`() {
        val rawWebViewUa =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A.240205.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36"

        val cleanedUa = MyMapWebViewClient.buildSanitizedAuthUserAgent(rawWebViewUa)

        assertFalse("Cleaned UA must not contain '; wv'", cleanedUa.contains("; wv"))
        assertFalse("Cleaned UA must not contain 'wv'", cleanedUa.contains("wv", ignoreCase = true))
        assertFalse("Cleaned UA must not contain 'Version/4.0'", cleanedUa.contains("Version/"))
        assertTrue("Cleaned UA must retain Chrome token", cleanedUa.contains("Chrome/124.0"))
    }

    @Test
    fun `isBlankOrInvalidUrl and resolveRecoveryUrl guard against white screen URLs`() {
        assertTrue(MyMapWebViewClient.isBlankOrInvalidUrl(null))
        assertTrue(MyMapWebViewClient.isBlankOrInvalidUrl(""))
        assertTrue(MyMapWebViewClient.isBlankOrInvalidUrl("   "))
        assertTrue(MyMapWebViewClient.isBlankOrInvalidUrl("about:blank"))
        assertTrue(MyMapWebViewClient.isBlankOrInvalidUrl("ABOUT:BLANK"))

        assertFalse(MyMapWebViewClient.isBlankOrInvalidUrl(MyMapWebViewClient.MY_MAPS_HOME_URL))
        assertFalse(MyMapWebViewClient.isBlankOrInvalidUrl("https://www.google.com/maps/d/edit?mid=123"))

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
    }
}

