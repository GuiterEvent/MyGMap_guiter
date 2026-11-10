package com.guiterevent.mygmap

import com.guiterevent.mygmap.location.GpsCoordinates
import com.guiterevent.mygmap.webview.GoogleMapsLaunchMode
import com.guiterevent.mygmap.webview.MapExportAndIntentHelper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MapExportAndIntentHelperTest {

    @Test
    fun `extractMidFromUrl extracts mid from edit and viewer URLs`() {
        val editUrl = "https://www.google.com/maps/d/u/0/edit?mid=1aBcDeFgHiJkLmNoPqRsTuVwXyZ_123&ll=25.033964%2C121.564468&z=16"
        assertEquals("1aBcDeFgHiJkLmNoPqRsTuVwXyZ_123", MapExportAndIntentHelper.extractMidFromUrl(editUrl))

        val viewerUrl = "https://www.google.com/maps/d/viewer?hl=zh-TW&mid=1xYz987654321"
        assertEquals("1xYz987654321", MapExportAndIntentHelper.extractMidFromUrl(viewerUrl))

        assertNull(MapExportAndIntentHelper.extractMidFromUrl("https://www.google.com/maps/d/"))
        assertNull(MapExportAndIntentHelper.extractMidFromUrl(null))
    }

    @Test
    fun `extractLatLngFromUrl parses ll parameter and at-path coordinates`() {
        val encodedLlUrl = "https://www.google.com/maps/d/edit?mid=12345&ll=25.033964%2C121.564468&z=17"
        val coords1 = MapExportAndIntentHelper.extractLatLngFromUrl(encodedLlUrl)
        assertNotNull(coords1)
        assertEquals(25.033964, coords1!!.latitude, 1e-6)
        assertEquals(121.564468, coords1.longitude, 1e-6)

        val atPathUrl = "https://www.google.com/maps/@24.147736,120.673648,15z"
        val coords2 = MapExportAndIntentHelper.extractLatLngFromUrl(atPathUrl)
        assertNotNull(coords2)
        assertEquals(24.147736, coords2!!.latitude, 1e-6)
        assertEquals(120.673648, coords2.longitude, 1e-6)
    }

    @Test
    fun `parseNavigationContextJson prioritizes selected pin then search box then map center`() {
        val sampleJson = """
            {
              "pageUrl": "https://www.google.com/maps/d/edit?mid=1mapIdAbc&ll=25.040000,121.500000",
              "mid": "1mapIdAbc",
              "mapCenterLat": 25.04,
              "mapCenterLng": 121.5,
              "selectedPinTitle": "象山觀景台",
              "selectedPinLat": 25.027222,
              "selectedPinLng": 121.576389,
              "searchBoxText": "25.033964, 121.564468",
              "searchBoxLat": 25.033964,
              "searchBoxLng": 121.564468
            }
        """.trimIndent()

        val ctx = MapExportAndIntentHelper.parseNavigationContextJson(sampleJson, null)
        assertEquals("1mapIdAbc", ctx.mid)
        assertEquals("象山觀景台", ctx.selectedPinTitle)

        val bestCoords = ctx.resolveBestCoordinates()
        assertNotNull(bestCoords)
        assertEquals(25.027222, bestCoords!!.latitude, 1e-6)
        assertEquals(121.576389, bestCoords.longitude, 1e-6)
        assertEquals("選取圖釘", bestCoords.provider)
    }

    @Test
    fun `resolveGoogleMapsTargetUris builds navigation, street view and mid viewer URIs`() {
        val ctx = MapExportAndIntentHelper.parseNavigationContextJson(
            rawEvaluateJsResult = null,
            fallbackUrl = "https://www.google.com/maps/d/edit?mid=1myTestMid999&ll=25.033964%2C121.564468"
        )
        val fallbackGps = GpsCoordinates(latitude = 25.033964, longitude = 121.564468)

        val (navAppUri, navBrowserUrl) = MapExportAndIntentHelper.resolveGoogleMapsTargetUris(
            mode = GoogleMapsLaunchMode.NAVIGATION,
            navContext = ctx,
            fallbackGps = fallbackGps
        )
        assertTrue(navAppUri.startsWith("google.navigation:q=25.033964"))
        assertTrue(navBrowserUrl.startsWith("https://www.google.com/maps/dir/?api=1&destination="))

        val (svAppUri, svBrowserUrl) = MapExportAndIntentHelper.resolveGoogleMapsTargetUris(
            mode = GoogleMapsLaunchMode.STREET_VIEW,
            navContext = ctx,
            fallbackGps = fallbackGps
        )
        assertTrue(svAppUri.startsWith("google.streetview:cbll=25.033964,121.564468"))
        assertTrue(svBrowserUrl.contains("map_action=pano"))

        val (midAppUri, _) = MapExportAndIntentHelper.resolveGoogleMapsTargetUris(
            mode = GoogleMapsLaunchMode.MAP_VIEWER_BY_MID,
            navContext = ctx,
            fallbackGps = fallbackGps
        )
        assertTrue(midAppUri.startsWith("https://www.google.com/maps/d/viewer?mid=1myTestMid999"))
    }

    @Test
    fun `resolveDownloadFileName parses Content-Disposition and enforces kmz or kml extension`() {
        // 1. RFC 5987 UTF-8 檔名解析
        val utf8Disp = "attachment; filename=\"map.kmz\"; filename*=UTF-8''%E5%8F%B0%E5%8C%97%E7%BE%8E%E9%A3%9F%E5%9C%B0%E5%9C%96.kmz"
        val name1 = MapExportAndIntentHelper.resolveDownloadFileName(
            url = "https://www.google.com/maps/d/kml?mid=123",
            contentDisposition = utf8Disp,
            mimeType = MapExportAndIntentHelper.MIME_TYPE_KMZ
        )
        assertEquals("台北美食地圖.kmz", name1)

        // 2. 標準引號 .kml 檔名解析
        val kmlDisp = "attachment; filename=\"Taiwan Cycling Route.kml\""
        val name2 = MapExportAndIntentHelper.resolveDownloadFileName(
            url = "https://www.google.com/maps/d/kml?mid=123&forcekml=1",
            contentDisposition = kmlDisp,
            mimeType = MapExportAndIntentHelper.MIME_TYPE_KML
        )
        assertEquals("Taiwan Cycling Route.kml", name2)

        // 3. 無 Content-Disposition 時自動依據 forcekml=1 或 MIME 決定預設 .kml / .kmz 副檔名
        val fallbackKmz = MapExportAndIntentHelper.resolveDownloadFileName(
            url = "https://www.google.com/maps/d/kml?mid=1abcDefGhiJkl",
            contentDisposition = null,
            mimeType = "application/vnd.google-earth.kmz",
            fallbackTitle = "2026 日本自由行 - Google 我的地圖"
        )
        assertEquals("2026 日本自由行.kmz", fallbackKmz)

        val fallbackKml = MapExportAndIntentHelper.resolveDownloadFileName(
            url = "https://www.google.com/maps/d/kml?mid=1abcDefGhiJkl&forcekml=1",
            contentDisposition = null,
            mimeType = "application/vnd.google-earth.kml+xml",
            fallbackTitle = "2026 日本自由行 - Google 我的地圖"
        )
        assertEquals("2026 日本自由行.kml", fallbackKml)

        assertTrue(MapExportAndIntentHelper.isKmlFormat("https://www.google.com/maps/d/kml?mid=1&forcekml=1", null, null))
        assertFalse(MapExportAndIntentHelper.isKmlFormat("https://www.google.com/maps/d/kml?mid=1", null, MapExportAndIntentHelper.MIME_TYPE_KMZ))
    }
}
