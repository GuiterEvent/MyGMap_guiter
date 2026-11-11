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

    @Test
    fun `isExternalGoogleMapsUrl matches external Google Maps URLs and excludes My Maps and OAuth`() {
        assertTrue(MapExportAndIntentHelper.isExternalGoogleMapsUrl("https://www.google.com/maps/dir/?api=1&destination=25.033964,121.564468"))
        assertTrue(MapExportAndIntentHelper.isExternalGoogleMapsUrl("https://www.google.com/maps/dir//25.033964,121.564468"))
        assertTrue(MapExportAndIntentHelper.isExternalGoogleMapsUrl("https://maps.google.com/maps?daddr=25.033964,121.564468"))
        assertTrue(MapExportAndIntentHelper.isExternalGoogleMapsUrl("https://maps.google.com.tw/maps?q=Taipei+101"))
        assertTrue(MapExportAndIntentHelper.isExternalGoogleMapsUrl("https://www.google.com.tw/maps/place/Taipei+101/@25.033964,121.564468,17z"))
        assertTrue(MapExportAndIntentHelper.isExternalGoogleMapsUrl("https://www.google.com/maps/search/?api=1&query=25.033964,121.564468"))
        assertTrue(MapExportAndIntentHelper.isExternalGoogleMapsUrl("https://www.google.com/maps/@25.033964,121.564468,15z"))
        assertTrue(MapExportAndIntentHelper.isExternalGoogleMapsUrl("https://maps.app.goo.gl/AbCdEf123"))
        assertTrue(MapExportAndIntentHelper.isExternalGoogleMapsUrl("https://goo.gl/maps/XyZ789"))
        assertTrue(MapExportAndIntentHelper.isExternalGoogleMapsUrl("google.navigation:q=25.033964,121.564468"))
        assertTrue(MapExportAndIntentHelper.isExternalGoogleMapsUrl("geo:25.033964,121.564468?q=25.033964,121.564468"))
        assertTrue(MapExportAndIntentHelper.isExternalGoogleMapsUrl("google.streetview:cbll=25.033964,121.564468"))

        assertFalse(MapExportAndIntentHelper.isExternalGoogleMapsUrl("https://www.google.com/maps/d/edit?mid=123"))
        assertFalse(MapExportAndIntentHelper.isExternalGoogleMapsUrl("https://www.google.com/maps/d/viewer?mid=123"))
        assertFalse(MapExportAndIntentHelper.isExternalGoogleMapsUrl("https://www.google.com/maps/d/"))
        assertFalse(MapExportAndIntentHelper.isExternalGoogleMapsUrl("https://www.google.com.tw/maps/d/edit?mid=123"))
        assertFalse(MapExportAndIntentHelper.isExternalGoogleMapsUrl("https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fwww.google.com%2Fmaps%2Fd%2F"))
        assertFalse(MapExportAndIntentHelper.isExternalGoogleMapsUrl("about:blank"))
        assertFalse(MapExportAndIntentHelper.isExternalGoogleMapsUrl(null))
    }

    @Test
    fun `extractDirectionsDestinationFromUrl parses destination, daddr, dir path and query`() {
        assertEquals(
            "25.033964,121.564468",
            MapExportAndIntentHelper.extractDirectionsDestinationFromUrl(
                "https://www.google.com/maps/dir/?api=1&destination=25.033964%2C121.564468&travelmode=driving"
            )
        )
        assertEquals(
            "Taipei 101",
            MapExportAndIntentHelper.extractDirectionsDestinationFromUrl(
                "https://maps.google.com/maps?saddr=My+Location&daddr=Taipei+101"
            )
        )
        assertEquals(
            "25.033964,121.564468",
            MapExportAndIntentHelper.extractDirectionsDestinationFromUrl(
                "https://www.google.com/maps/dir//25.033964,121.564468"
            )
        )
        assertEquals(
            "25.033964,121.564468",
            MapExportAndIntentHelper.extractDirectionsDestinationFromUrl(
                "https://www.google.com/maps/dir/Current+Location/25.033964,121.564468/@25.03,121.56,15z"
            )
        )
        assertEquals(
            "25.033964,121.564468",
            MapExportAndIntentHelper.extractDirectionsDestinationFromUrl(
                "https://www.google.com/maps/search/?api=1&query=25.033964,121.564468"
            )
        )
        assertEquals(
            "25.033964,121.564468",
            MapExportAndIntentHelper.extractDirectionsDestinationFromUrl(
                "https://www.google.com/maps/@25.033964,121.564468,15z"
            )
        )
        assertNull(MapExportAndIntentHelper.extractDirectionsDestinationFromUrl(null))
    }

    @Test
    fun `extractLatLngFromUrl prioritizes 3d4d entity pin coordinates over camera center`() {
        val mixedUrl = "https://www.google.com/maps/place/Bogen+Hostel+as/@68.51358,17.01783,16z/data=!4m14!1m7!3m6!1s0x45dbf34f786:0x123!2sBogen!8m2!3d68.514123!4d17.012345!16s%2Fg%2F11b6"
        val coords = MapExportAndIntentHelper.extractLatLngFromUrl(mixedUrl)
        assertNotNull(coords)
        assertEquals(68.514123, coords!!.latitude, 1e-6)
        assertEquals(17.012345, coords.longitude, 1e-6)
    }

    @Test
    fun `resolveGoogleMapsTargetUris prioritizes placeUrl for PLACE_PIN mode`() {
        val placeUrl = "https://www.google.com/maps/place/Bogen+Hostel+as/@68.51358,17.01783,16z/data=!3d68.514123!4d17.012345"
        val ctx = MapNavigationContext(
            selectedPinTitle = "Bogen Hostel as",
            selectedPinLat = 68.51358,
            selectedPinLng = 17.01783,
            placeUrl = placeUrl
        )

        val (appUri, browserUrl) = MapExportAndIntentHelper.resolveGoogleMapsTargetUris(
            mode = GoogleMapsLaunchMode.PLACE_PIN,
            navContext = ctx
        )
        assertEquals(placeUrl, appUri)
        assertEquals(placeUrl, browserUrl)

        val cidUrl = "https://maps.google.com/?cid=1234567890"
        val ctxCid = MapNavigationContext(
            selectedPinTitle = "Bogen Hostel as",
            placeUrl = cidUrl
        )
        val (cidAppUri, cidBrowserUrl) = MapExportAndIntentHelper.resolveGoogleMapsTargetUris(
            mode = GoogleMapsLaunchMode.PLACE_PIN,
            navContext = ctxCid
        )
        assertEquals(cidUrl, cidAppUri)
        assertEquals(cidUrl, cidBrowserUrl)
    }

    @Test
    fun `resolveGoogleMapsTargetUris prioritizes directionsUrl and placeUrl exact coords for NAVIGATION mode`() {
        val placeUrl = "https://www.google.com/maps/place/Bogen+Hostel+as/@68.51358,17.01783,16z/data=!3d68.514123!4d17.012345"
        val ctx = MapNavigationContext(
            selectedPinTitle = "Bogen Hostel as",
            selectedPinLat = 68.51358,
            selectedPinLng = 17.01783,
            placeUrl = placeUrl
        )

        val (navAppUri, navBrowserUrl) = MapExportAndIntentHelper.resolveGoogleMapsTargetUris(
            mode = GoogleMapsLaunchMode.NAVIGATION,
            navContext = ctx
        )
        assertTrue("Navigation should target exact pin latitude 68.514123", navAppUri.contains("68.514123"))
        assertTrue("Navigation should target exact pin longitude 17.012345", navAppUri.contains("17.012345"))
        assertTrue(navBrowserUrl.contains("destination=68.514123%2C17.012345") || navBrowserUrl.contains("destination=68.514123,17.012345"))

        val dirUrl = "https://www.google.com/maps/dir/?api=1&destination=68.514999,17.019999"
        val ctxDir = MapNavigationContext(
            selectedPinTitle = "Bogen Hostel as",
            directionsUrl = dirUrl,
            placeUrl = placeUrl
        )
        val (dirAppUri, _) = MapExportAndIntentHelper.resolveGoogleMapsTargetUris(
            mode = GoogleMapsLaunchMode.NAVIGATION,
            navContext = ctxDir
        )
        assertTrue(dirAppUri.contains("68.514999"))
        assertTrue(dirAppUri.contains("17.019999"))
    }

    @Test
    fun `parseNavigationContextJson parses placeUrl and directionsUrl`() {
        val json = """
            {
              "pageUrl": "https://www.google.com/maps/d/edit?mid=123",
              "mid": "123",
              "selectedPinTitle": "Bogen Hostel as",
              "selectedPinLat": 68.514123,
              "selectedPinLng": 17.012345,
              "placeUrl": "https://www.google.com/maps/place/Bogen+Hostel+as/@68.51358,17.01783,16z/data=!3d68.514123!4d17.012345",
              "directionsUrl": "https://www.google.com/maps/dir/?api=1&destination=68.514123,17.012345"
            }
        """.trimIndent()
        val ctx = MapExportAndIntentHelper.parseNavigationContextJson(json, null)
        assertEquals("https://www.google.com/maps/place/Bogen+Hostel+as/@68.51358,17.01783,16z/data=!3d68.514123!4d17.012345", ctx.placeUrl)
        assertEquals("https://www.google.com/maps/dir/?api=1&destination=68.514123,17.012345", ctx.directionsUrl)
    }
}
