package com.guiterevent.mygmap.webview

import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.util.Log
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.widget.Toast
import com.guiterevent.mygmap.location.GpsCoordinates
import com.guiterevent.mygmap.location.LocationHelper
import org.json.JSONObject
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.Locale

/**
 * 封裝從目前 WebView 網址與網頁 DOM（選取的圖釘氣泡窗、搜尋輸入框）提取出的導航與地圖資訊。
 */
data class MapNavigationContext(
    val pageUrl: String = "",
    val mid: String = "",
    val mapCenterLat: Double? = null,
    val mapCenterLng: Double? = null,
    val selectedPinTitle: String = "",
    val selectedPinLat: Double? = null,
    val selectedPinLng: Double? = null,
    val searchBoxText: String = "",
    val searchBoxLat: Double? = null,
    val searchBoxLng: Double? = null,
    val placeUrl: String = "",
    val directionsUrl: String = ""
) {
    /**
     * 按優先序取得目前最佳目標經緯度：
     * 1. 網頁目前點選展開的圖釘氣泡窗座標 (`selectedPinLat`, `selectedPinLng`)
     * 2. 網頁搜尋框 `#mapsprosearch-field` 內的座標 (`searchBoxLat`, `searchBoxLng`)
     * 3. 目前網址 `ll=` 或 `@lat,lng` 的地圖中心座標 (`mapCenterLat`, `mapCenterLng`)
     * 4. 手機目前取得的最新 GPS 座標 (`fallbackGps`)
     */
    fun resolveBestCoordinates(fallbackGps: GpsCoordinates? = null): GpsCoordinates? {
        if (selectedPinLat != null && selectedPinLng != null &&
            LocationHelper.isValidLatLng(selectedPinLat, selectedPinLng)
        ) {
            return GpsCoordinates(
                latitude = selectedPinLat,
                longitude = selectedPinLng,
                provider = "選取圖釘"
            )
        }
        if (searchBoxLat != null && searchBoxLng != null &&
            LocationHelper.isValidLatLng(searchBoxLat, searchBoxLng)
        ) {
            return GpsCoordinates(
                latitude = searchBoxLat,
                longitude = searchBoxLng,
                provider = "搜尋框座標"
            )
        }
        if (mapCenterLat != null && mapCenterLng != null &&
            LocationHelper.isValidLatLng(mapCenterLat, mapCenterLng)
        ) {
            return GpsCoordinates(
                latitude = mapCenterLat,
                longitude = mapCenterLng,
                provider = "地圖中心 (URL)"
            )
        }
        if (fallbackGps != null &&
            LocationHelper.isValidLatLng(fallbackGps.latitude, fallbackGps.longitude)
        ) {
            return fallbackGps
        }
        return null
    }

    /**
     * 取得目前最佳地點名稱或搜尋關鍵字（優先採用選取圖釘標題，其次採用搜尋框文字）
     */
    fun resolveBestQueryOrTitle(): String {
        val pinTitle = selectedPinTitle.trim()
        if (pinTitle.isNotEmpty()) return pinTitle
        val searchTxt = searchBoxText.trim()
        if (searchTxt.isNotEmpty()) return searchTxt
        return ""
    }
}

/**
 * 跳轉官方 Google Maps App 的目標動作模式
 */
enum class GoogleMapsLaunchMode {
    /** 智慧開啟：若有選取圖釘/座標則開啟該地點，若有 `mid` 則在 Google Maps 開啟此「我的地圖」 */
    SMART_OPEN,
    /** 直接在 Google Maps App 載入並檢視整張 `mid`「我的地圖」雲端圖資 */
    MAP_VIEWER_BY_MID,
    /** 直接喚起 Google Maps App 進行路線導航 (`google.navigation:q=...`) */
    NAVIGATION,
    /** 直接喚起 Google Maps App 查看 360° 街景 (`google.streetview:cbll=...`) */
    STREET_VIEW,
    /** 在 Google Maps App 標示指定經緯度座標或地點 (`geo:...`) */
    PLACE_PIN
}

/**
 * Phase 5：官方 Google Maps App 跳轉導航/街景 與 KML/KMZ 匯出檔案下載輔助模組 (`MapExportAndIntentHelper`)
 *
 * 核心職責：
 * 1. 從目前網址提取 `mid`（地圖 ID）與 `ll`（地圖中心座標），並結合 JS 提取的目前選取圖釘/搜尋框座標。
 * 2. 透過 `Intent(Intent.ACTION_VIEW, Uri.parse(...))` 直接喚起手機內的官方 Google Maps App
 *    (`com.google.android.apps.maps`) 進行路線導航、查看街景或檢視雲端地圖；若未安裝則自動以外部瀏覽器開啟。
 * 3. 為 `WebView.setDownloadListener` 提供完整的 KML / KMZ 匯出下載處理：
 *    同步讀取 `CookieManager.getInstance().getCookie(url)` 與 `User-Agent`，從 `Content-Disposition`
 *    自動解析檔名（預設副檔名為 `.kmz` 或 `.kml`），透過 `DownloadManager.Request` 儲存至系統
 *    `Environment.DIRECTORY_DOWNLOADS` 並以 Toast 提示使用者。
 */
object MapExportAndIntentHelper {
    private const val TAG = "MapExportAndIntent"

    /** 官方 Google Maps Android App 套件名稱 */
    const val GOOGLE_MAPS_PACKAGE = "com.google.android.apps.maps"

    /** KML 與 KMZ 標準 MIME Types */
    const val MIME_TYPE_KML = "application/vnd.google-earth.kml+xml"
    const val MIME_TYPE_KMZ = "application/vnd.google-earth.kmz"

    // ========================================================================
    // 1. 網址與文字中的 mid / 經緯度座標提取邏輯
    // ========================================================================

    /**
     * 從 Google 我的地圖網址中提取 `mid`（Map ID）。
     * 例如：`https://www.google.com/maps/d/edit?mid=1aBcDeFgHiJkLmNoPqRsTuVwXyZ&usp=sharing`
     */
    fun extractMidFromUrl(url: String?): String? {
        if (url.isNullOrBlank()) return null
        val regex = Regex("[?&]mid=([^&#\\s]+)", RegexOption.IGNORE_CASE)
        val rawMid = regex.find(url)?.groupValues?.getOrNull(1)?.trim() ?: return null
        if (rawMid.isEmpty()) return null
        return try {
            URLDecoder.decode(rawMid, "UTF-8").trim().takeIf { it.isNotEmpty() }
        } catch (_: Exception) {
            rawMid
        }
    }

    /**
     * Phase 13：高精度經緯度數字格式化（最多 7 位小數，去除無效尾零）
     */
    fun formatHighPrecisionCoord(value: Double): String {
        val s7 = String.format(Locale.US, "%.7f", value)
        val trimmed = s7.trimEnd('0').trimEnd('.')
        return if (!trimmed.contains('.')) "$trimmed.0" else trimmed
    }

    fun formatHighPrecisionLatLng(lat: Double, lng: Double): String {
        return "${formatHighPrecisionCoord(lat)},${formatHighPrecisionCoord(lng)}"
    }

    /**
     * Phase 13：從 Google Maps 網址中擷取真實圖釘高精準度座標（!3dLAT!4dLNG，取最後一組）
     */
    fun extractExactPinCoordsFromUrl(url: String?): GpsCoordinates? {
        if (url.isNullOrBlank()) return null
        val decodedUrl = try {
            URLDecoder.decode(url, "UTF-8")
        } catch (_: Exception) {
            url.replace("%2C", ",", ignoreCase = true)
        }
        val pinPattern = Regex("!3d(-?\\d{1,2}\\.\\d+)!4d(-?\\d{1,3}\\.\\d+)")
        val matches = pinPattern.findAll(decodedUrl).toList()
        if (matches.isNotEmpty()) {
            val lastMatch = matches.last()
            val lat = lastMatch.groupValues[1].toDoubleOrNull()
            val lng = lastMatch.groupValues[2].toDoubleOrNull()
            if (lat != null && lng != null && LocationHelper.isValidLatLng(lat, lng)) {
                return GpsCoordinates(latitude = lat, longitude = lng, provider = "URL")
            }
        }
        return null
    }

    /**
     * Phase 13：從 Google Maps 網址擷取官方地標名稱（例如 /maps/place/<地點名稱>/）
     */
    fun extractPlaceNameFromMapsUrl(url: String?): String? {
        if (url.isNullOrBlank()) return null
        val match = Regex("/maps/place/([^/@?#]+)", RegexOption.IGNORE_CASE).find(url)
        if (match != null) {
            val rawName = match.groupValues[1]
            val decoded = try {
                URLDecoder.decode(rawName.replace("+", " "), "UTF-8").trim()
            } catch (_: Exception) {
                rawName.replace("+", " ").trim()
            }
            if (decoded.isNotEmpty() && extractLatLngFromText(decoded) == null && !isCurrentLocationPlaceholder(decoded)) {
                return decoded
            }
        }
        return null
    }

    /**
     * Phase 13：從網址中提取經緯度座標。
     * 優先順序：
     * 1. 第一順位（最高精度真實圖釘）：擷取 !3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)（若有多組取最後一組）
     * 2. 第二順位（明確目標參數）：destination=, daddr=, query=, q=, ll=, sll=, cbll=, viewpoint=, center=
     * 3. 第三順位（最後備援）：路徑中的 /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)（畫面視角中心）
     */
    fun extractLatLngFromUrl(url: String?): GpsCoordinates? {
        if (url.isNullOrBlank()) return null
        val decodedUrl = try {
            URLDecoder.decode(url, "UTF-8")
        } catch (_: Exception) {
            url.replace("%2C", ",", ignoreCase = true)
        }

        // 1. 第一順位（最高精度真實圖釘）：擷取 !3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)（若有多組取最後一組）
        val pinPattern = Regex("!3d(-?\\d{1,2}\\.\\d+)!4d(-?\\d{1,3}\\.\\d+)")
        val matches = pinPattern.findAll(decodedUrl).toList()
        if (matches.isNotEmpty()) {
            val lastMatch = matches.last()
            val lat = lastMatch.groupValues[1].toDoubleOrNull()
            val lng = lastMatch.groupValues[2].toDoubleOrNull()
            if (lat != null && lng != null && LocationHelper.isValidLatLng(lat, lng)) {
                return GpsCoordinates(latitude = lat, longitude = lng, provider = "URL")
            }
        }

        // 2. 第二順位（明確目標參數）：destination=, daddr=, query=, q=, ll=, sll=, cbll=, viewpoint=, center=
        val queryParamRegex = Regex(
            "(?:[?&](?:destination|daddr|query|q|ll|sll|cbll|viewpoint|center)=)(-?\\d{1,2}(?:\\.\\d+)?)\\s*,\\s*(-?\\d{1,3}(?:\\.\\d+)?)",
            RegexOption.IGNORE_CASE
        )
        queryParamRegex.find(decodedUrl)?.let { match ->
            val lat = match.groupValues[1].toDoubleOrNull()
            val lng = match.groupValues[2].toDoubleOrNull()
            if (lat != null && lng != null && LocationHelper.isValidLatLng(lat, lng)) {
                return GpsCoordinates(latitude = lat, longitude = lng, provider = "URL")
            }
        }

        // 3. 第三順位（最後備援）：路徑中的 /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)（畫面視角中心）
        val atPathRegex = Regex("@(-?\\d{1,2}(?:\\.\\d+)?)\\s*,\\s*(-?\\d{1,3}(?:\\.\\d+)?)")
        atPathRegex.find(decodedUrl)?.let { match ->
            val lat = match.groupValues[1].toDoubleOrNull()
            val lng = match.groupValues[2].toDoubleOrNull()
            if (lat != null && lng != null && LocationHelper.isValidLatLng(lat, lng)) {
                return GpsCoordinates(latitude = lat, longitude = lng, provider = "URL")
            }
        }

        return null
    }

    /**
     * 從任意文字（如搜尋框 `#mapsprosearch-field` 或圖釘氣泡窗內容）提取合法的 `"lat, lng"` 經緯度座標。
     */
    fun extractLatLngFromText(text: String?): GpsCoordinates? {
        if (text.isNullOrBlank()) return null
        // 優先嘗試完整座標字串解析
        LocationHelper.parseCoordinateString(text)?.let { return it }

        // 若文字中夾雜其他說明，使用正規表達式擷取內嵌的經緯度數值對
        val embeddedRegex = Regex("(-?\\d{1,2}\\.\\d{3,})\\s*,\\s*(-?\\d{1,3}\\.\\d{3,})")
        val match = embeddedRegex.find(text) ?: return null
        val lat = match.groupValues[1].toDoubleOrNull() ?: return null
        val lng = match.groupValues[2].toDoubleOrNull() ?: return null
        if (!LocationHelper.isValidLatLng(lat, lng)) return null
        return GpsCoordinates(latitude = lat, longitude = lng, provider = "ExtractedText")
    }

    /**
     * 將 `inject_script.js` 的 `window.MyGMapHelper.extractNavigationContext()` 回傳 JSON 解析為 [MapNavigationContext]，
     * 並與 `fallbackUrl` 提取出的 `mid` 及 `ll` 座標自動合併。
     */
    fun parseNavigationContextJson(
        rawEvaluateJsResult: String?,
        fallbackUrl: String? = null
    ): MapNavigationContext {
        val unquotedJson = unwrapEvaluateJsString(rawEvaluateJsResult)
        val urlFromFallback = fallbackUrl?.trim().orEmpty()

        if (unquotedJson.isBlank() || unquotedJson == "null") {
            val urlCoords = extractLatLngFromUrl(urlFromFallback)
            return MapNavigationContext(
                pageUrl = urlFromFallback,
                mid = extractMidFromUrl(urlFromFallback).orEmpty(),
                mapCenterLat = urlCoords?.latitude,
                mapCenterLng = urlCoords?.longitude
            )
        }

        return try {
            val json = JSONObject(unquotedJson)
            val pageUrl = json.optString("pageUrl", "").ifBlank {
                extractJsonStringField(unquotedJson, "pageUrl")
            }.ifBlank { urlFromFallback }

            val mid = json.optString("mid", "").ifBlank {
                extractJsonStringField(unquotedJson, "mid")
            }.ifBlank {
                extractMidFromUrl(pageUrl) ?: extractMidFromUrl(urlFromFallback) ?: ""
            }

            val selectedPinTitle = json.optString("selectedPinTitle", "").ifBlank {
                extractJsonStringField(unquotedJson, "selectedPinTitle")
            }
            val searchBoxText = json.optString("searchBoxText", "").ifBlank {
                extractJsonStringField(unquotedJson, "searchBoxText")
            }

            val pinLat = optValidDouble(json, unquotedJson, "selectedPinLat")
            val pinLng = optValidDouble(json, unquotedJson, "selectedPinLng")
            val searchLat = optValidDouble(json, unquotedJson, "searchBoxLat")
                ?: extractLatLngFromText(searchBoxText)?.latitude
            val searchLng = optValidDouble(json, unquotedJson, "searchBoxLng")
                ?: extractLatLngFromText(searchBoxText)?.longitude

            val urlCoords = extractLatLngFromUrl(pageUrl) ?: extractLatLngFromUrl(urlFromFallback)
            val centerLat = optValidDouble(json, unquotedJson, "mapCenterLat") ?: urlCoords?.latitude
            val centerLng = optValidDouble(json, unquotedJson, "mapCenterLng") ?: urlCoords?.longitude

            val placeUrl = json.optString("placeUrl", "").ifBlank {
                extractJsonStringField(unquotedJson, "placeUrl")
            }
            val directionsUrl = json.optString("directionsUrl", "").ifBlank {
                extractJsonStringField(unquotedJson, "directionsUrl")
            }

            MapNavigationContext(
                pageUrl = pageUrl,
                mid = mid,
                mapCenterLat = centerLat,
                mapCenterLng = centerLng,
                selectedPinTitle = selectedPinTitle,
                selectedPinLat = pinLat,
                selectedPinLng = pinLng,
                searchBoxText = searchBoxText,
                searchBoxLat = searchLat,
                searchBoxLng = searchLng,
                placeUrl = placeUrl,
                directionsUrl = directionsUrl
            )
        } catch (_: Throwable) {
            val pageUrl = extractJsonStringField(unquotedJson, "pageUrl").ifBlank { urlFromFallback }
            val mid = extractJsonStringField(unquotedJson, "mid")
                .ifBlank { extractMidFromUrl(pageUrl) ?: extractMidFromUrl(urlFromFallback) ?: "" }
            val selectedPinTitle = extractJsonStringField(unquotedJson, "selectedPinTitle")
            val searchBoxText = extractJsonStringField(unquotedJson, "searchBoxText")
            val searchCoords = extractLatLngFromText(searchBoxText)
            val urlCoords = extractLatLngFromUrl(pageUrl) ?: extractLatLngFromUrl(urlFromFallback)

            val placeUrl = extractJsonStringField(unquotedJson, "placeUrl")
            val directionsUrl = extractJsonStringField(unquotedJson, "directionsUrl")

            MapNavigationContext(
                pageUrl = pageUrl,
                mid = mid,
                mapCenterLat = extractJsonDoubleField(unquotedJson, "mapCenterLat") ?: urlCoords?.latitude,
                mapCenterLng = extractJsonDoubleField(unquotedJson, "mapCenterLng") ?: urlCoords?.longitude,
                selectedPinTitle = selectedPinTitle,
                selectedPinLat = extractJsonDoubleField(unquotedJson, "selectedPinLat"),
                selectedPinLng = extractJsonDoubleField(unquotedJson, "selectedPinLng"),
                searchBoxText = searchBoxText,
                searchBoxLat = extractJsonDoubleField(unquotedJson, "searchBoxLat") ?: searchCoords?.latitude,
                searchBoxLng = extractJsonDoubleField(unquotedJson, "searchBoxLng") ?: searchCoords?.longitude,
                placeUrl = placeUrl,
                directionsUrl = directionsUrl
            )
        }
    }

    // ========================================================================
    // 1.5 Phase 11：外部 Google Maps URL 辨識、目的地解析與直接喚起導航
    // ========================================================================

    private fun extractUrlScheme(url: String): String {
        val colonIdx = url.indexOf(':')
        if (colonIdx <= 0) return ""
        val candidate = url.substring(0, colonIdx).trim()
        return if (Regex("^[a-zA-Z][a-zA-Z0-9+.-]*$").matches(candidate)) {
            candidate.lowercase(Locale.ROOT)
        } else {
            ""
        }
    }

    private fun parseUrlHostAndPath(url: String): Pair<String, String>? {
        val trimmed = url.trim()
        try {
            val uri = java.net.URI(trimmed)
            val host = uri.host?.lowercase(Locale.ROOT)
            if (!host.isNullOrBlank()) {
                return host to (uri.rawPath ?: "")
            }
        } catch (_: Exception) {
        }
        val match = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#:]+)(?::\\d+)?([^?#]*)").find(trimmed)
            ?: return null
        return match.groupValues[1].lowercase(Locale.ROOT) to match.groupValues[2]
    }

    private fun isLocalizedGoogleDomain(host: String): Boolean {
        return Regex("^(?:www\\.)?google\\.(?:com|[a-z]{2,3}|com\\.[a-z]{2}|co\\.[a-z]{2})$")
            .matches(host)
    }

    private fun isLocalizedMapsGoogleDomain(host: String): Boolean {
        return Regex("^maps\\.google\\.(?:com|[a-z]{2,3}|com\\.[a-z]{2}|co\\.[a-z]{2})$")
            .matches(host)
    }

    /**
     * Phase 11：判斷網址是否為外部 Google Maps 導航 / 地點 / 短網址連結（排除 Google 我的地圖本身與登入頁面）。
     * 純字串與 `java.net.URI` 解析，可於 Android Runtime 與純 JVM 單元測試環境正常運作。
     */
    fun isExternalGoogleMapsUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val trimmed = url.trim()
        val scheme = extractUrlScheme(trimmed)

        if (scheme == "google.navigation" || scheme == "geo" || scheme == "google.streetview") {
            return true
        }
        if (scheme != "http" && scheme != "https") {
            return false
        }

        // 明確排除 Google 我的地圖本身與 Google 帳號 OAuth 登入網址
        if (MyMapWebViewClient.isMyMapsUrl(trimmed) || MyMapWebViewClient.isGoogleAuthUrl(trimmed)) {
            return false
        }

        val (host, rawPath) = parseUrlHostAndPath(trimmed) ?: return false
        val path = rawPath.lowercase(Locale.ROOT)

        if (host.startsWith("accounts.google.")) {
            return false
        }
        if (path == "/maps/d" || path.startsWith("/maps/d/")) {
            return false
        }

        if (host == "maps.app.goo.gl") {
            return true
        }
        if (host == "goo.gl" && path.startsWith("/maps")) {
            return true
        }
        if (isLocalizedMapsGoogleDomain(host)) {
            return true
        }
        if (isLocalizedGoogleDomain(host)) {
            return path == "/maps" ||
                path == "/maps/" ||
                path.startsWith("/maps/dir") ||
                path.startsWith("/maps/place") ||
                path.startsWith("/maps/search") ||
                path.startsWith("/maps/@")
        }

        return false
    }

    /**
     * Phase 11：從 Google Maps 導航 / 地點網址提取目的地字串或 `"lat,lng"` 座標。
     * 支援：`destination=`、`daddr=`、`/maps/dir/.../<dest>`、`query=`、`q=` 與 `extractLatLngFromUrl(url)`。
     */
    fun extractDirectionsDestinationFromUrl(url: String?): String? {
        if (url.isNullOrBlank()) return null
        val trimmed = url.trim()

        // 1. 優先檢查明確導航參數 destination= / daddr=
        for (param in listOf("destination", "daddr")) {
            extractRawQueryParam(trimmed, param)?.let { decoded ->
                val clean = decoded.trim()
                if (clean.isNotEmpty() && !isCurrentLocationPlaceholder(clean)) {
                    return clean
                }
            }
        }

        // 2. 檢查路徑 /maps/dir/<origin>/<dest>/... 格式
        val (_, rawPath) = parseUrlHostAndPath(trimmed) ?: ("" to "")
        val dirIndex = rawPath.lowercase(Locale.ROOT).indexOf("/maps/dir/")
        if (dirIndex >= 0) {
            val afterDir = rawPath.substring(dirIndex + "/maps/dir/".length)
            val segments = afterDir.split("/")
            var candidateSegment: String? = null
            for (seg in segments) {
                if (seg.isEmpty()) continue
                val lowerSeg = seg.lowercase(Locale.ROOT)
                if (lowerSeg.startsWith("@") ||
                    lowerSeg.startsWith("data=") ||
                    lowerSeg.startsWith("am=") ||
                    lowerSeg.startsWith("entry=")
                ) {
                    break
                }
                val decodedSeg = try {
                    URLDecoder.decode(seg, "UTF-8").trim()
                } catch (_: Exception) {
                    seg.trim()
                }
                if (decodedSeg.isNotEmpty()) {
                    candidateSegment = decodedSeg
                }
            }
            if (!candidateSegment.isNullOrBlank() && !isCurrentLocationPlaceholder(candidateSegment)) {
                val coords = extractLatLngFromText(candidateSegment)
                return if (coords != null && candidateSegment.matches(Regex("^-?\\d{1,2}\\.\\d+\\s*,\\s*-?\\d{1,3}\\.\\d+$"))) {
                    formatHighPrecisionLatLng(coords.latitude, coords.longitude)
                } else {
                    candidateSegment
                }
            }
        }

        // 3. 檢查 query= / q=（包含 google.navigation:q=...）
        for (param in listOf("query", "q")) {
            extractRawQueryParam(trimmed, param)?.let { decoded ->
                val clean = decoded.trim()
                if (clean.isNotEmpty() && !isCurrentLocationPlaceholder(clean)) {
                    return clean
                }
            }
        }

        // 4. 退回從網址中的 !3d!4d / 參數 / @lat,lng 解析座標
        extractLatLngFromUrl(trimmed)?.let { coords ->
            return formatHighPrecisionLatLng(coords.latitude, coords.longitude)
        }

        return null
    }

    private fun extractRawQueryParam(url: String, paramName: String): String? {
        val regex = Regex("(?:[?&:])${Regex.escape(paramName)}=([^&#\\s]+)", RegexOption.IGNORE_CASE)
        val rawValue = regex.find(url)?.groupValues?.getOrNull(1) ?: return null
        return try {
            URLDecoder.decode(rawValue, "UTF-8")
        } catch (_: Exception) {
            rawValue
        }
    }

    private fun isCurrentLocationPlaceholder(value: String): Boolean {
        val lower = value.trim().lowercase(Locale.ROOT)
        return lower == "current location" ||
            lower == "my location" ||
            lower == "your location" ||
            lower == "目前位置" ||
            lower == "我的位置"
    }

    private fun isDirectionsStyleUrl(url: String): Boolean {
        val lower = url.lowercase(Locale.ROOT)
        return lower.contains("/maps/dir") ||
            lower.contains("daddr=") ||
            lower.contains("destination=") ||
            lower.contains("f=d")
    }

    /**
     * Phase 11：將攔截到的外部 Google Maps 導航 / 地點 / 短網址或特殊協定 (`geo:`, `google.navigation:`, `intent://`)
     * 直接喚起手機內的官方 Google Maps App (`com.google.android.apps.maps`)；若未安裝則降級為一般外部開啟。
     */
    fun openExternalMapsUrlInGoogleMapsApp(
        context: Context,
        rawUrl: String,
        navContext: MapNavigationContext? = null
    ): Boolean {
        val trimmedUrl = rawUrl.trim()
        if (trimmedUrl.isEmpty()) return false
        val scheme = extractUrlScheme(trimmedUrl)

        // 1. intent:// 協定：使用 Intent.parseUri 解析，必要時嘗試 browser_fallback_url
        if (scheme == "intent") {
            var parsedIntent: Intent? = null
            try {
                parsedIntent = Intent.parseUri(trimmedUrl, Intent.URI_INTENT_SCHEME).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(parsedIntent)
                Toast.makeText(context, "🧭 已喚起外部地圖應用程式", Toast.LENGTH_SHORT).show()
                Log.i(TAG, "Opened intent URI: $trimmedUrl")
                return true
            } catch (e: Exception) {
                Log.w(TAG, "Failed to start parsed intent URI ($trimmedUrl): ${e.message}")
                val fallbackUrl = parsedIntent?.getStringExtra("browser_fallback_url")?.trim()
                if (!fallbackUrl.isNullOrEmpty() && !fallbackUrl.equals(trimmedUrl, ignoreCase = true)) {
                    if (isExternalGoogleMapsUrl(fallbackUrl)) {
                        return openExternalMapsUrlInGoogleMapsApp(context, fallbackUrl, navContext)
                    }
                    return try {
                        val fallbackIntent = Intent(Intent.ACTION_VIEW, Uri.parse(fallbackUrl)).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        context.startActivity(fallbackIntent)
                        true
                    } catch (fallbackErr: Exception) {
                        Log.e(TAG, "Fallback URL open failed: ${fallbackErr.message}", fallbackErr)
                        false
                    }
                }
                return false
            }
        }

        // 2. geo: / google.navigation: / google.streetview: 原生協定
        if (scheme == "geo" || scheme == "google.navigation" || scheme == "google.streetview") {
            try {
                val mapsIntent = Intent(Intent.ACTION_VIEW, Uri.parse(trimmedUrl)).apply {
                    setPackage(GOOGLE_MAPS_PACKAGE)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(mapsIntent)
                val msg = if (scheme == "google.navigation") {
                    "🧭 已喚起 Google Maps App 進行路線導航"
                } else {
                    "🗺️ 已在 Google Maps App 開啟"
                }
                Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
                Log.i(TAG, "Launched Google Maps App with native scheme: $trimmedUrl")
                return true
            } catch (_: ActivityNotFoundException) {
                Log.w(TAG, "Google Maps package not found for $trimmedUrl, trying generic VIEW")
            } catch (e: Exception) {
                Log.w(TAG, "Direct package launch failed for $trimmedUrl: ${e.message}")
            }

            try {
                val genericIntent = Intent(Intent.ACTION_VIEW, Uri.parse(trimmedUrl)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(genericIntent)
                return true
            } catch (_: Exception) {
                // 若裝置連一般 geo/navigation handler 都沒有，轉成 HTTPS 網頁導航網址
                val dest = extractDirectionsDestinationFromUrl(trimmedUrl)
                if (!dest.isNullOrBlank()) {
                    val webUrl = "https://www.google.com/maps/dir/?api=1&destination=${urlEncode(dest)}&travelmode=driving"
                    return try {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse(webUrl)).apply {
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                        )
                        true
                    } catch (_: Exception) {
                        false
                    }
                }
                return false
            }
        }

        // 3. HTTPS Google Maps 導航 / 地點 / 短網址
        val isDirLink = isDirectionsStyleUrl(trimmedUrl)
        val targetUriString = if (isDirLink) {
            val destFromUrl = extractDirectionsDestinationFromUrl(trimmedUrl)
            val fallbackCoords = navContext?.resolveBestCoordinates()
            val fallbackTitle = navContext?.resolveBestQueryOrTitle().orEmpty()
            val resolvedDestination = when {
                !destFromUrl.isNullOrBlank() -> destFromUrl
                fallbackCoords != null -> String.format(
                    Locale.US,
                    "%.6f,%.6f",
                    fallbackCoords.latitude,
                    fallbackCoords.longitude
                )
                fallbackTitle.isNotBlank() -> fallbackTitle
                else -> null
            }
            if (!resolvedDestination.isNullOrBlank()) {
                "google.navigation:q=${urlEncode(resolvedDestination)}"
            } else {
                trimmedUrl
            }
        } else {
            trimmedUrl
        }

        try {
            val mapsIntent = Intent(Intent.ACTION_VIEW, Uri.parse(targetUriString)).apply {
                setPackage(GOOGLE_MAPS_PACKAGE)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(mapsIntent)
            val toastMsg = if (isDirLink || targetUriString.startsWith("google.navigation:")) {
                "🧭 已喚起 Google Maps App 進行路線導航"
            } else {
                "🗺️ 已在 Google Maps App 開啟"
            }
            Toast.makeText(context, toastMsg, Toast.LENGTH_SHORT).show()
            Log.i(TAG, "Opened external Google Maps URL in app: $targetUriString (from $trimmedUrl)")
            return true
        } catch (_: ActivityNotFoundException) {
            Log.w(TAG, "Google Maps App unavailable, falling back to browser for: $trimmedUrl")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to open $targetUriString in Google Maps App: ${e.message}")
        }

        // 4. 降級使用不指定套件的一般 ACTION_VIEW 開啟原始 HTTPS 網址
        return try {
            val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(trimmedUrl)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(browserIntent)
            Toast.makeText(
                context,
                "🌐 未偵測到 Google Maps App，已透過外部瀏覽器開啟",
                Toast.LENGTH_SHORT
            ).show()
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open fallback URL $trimmedUrl: ${e.message}", e)
            Toast.makeText(
                context,
                "⚠️ 無法開啟外部地圖應用程式：${e.localizedMessage ?: "未知錯誤"}",
                Toast.LENGTH_SHORT
            ).show()
            false
        }
    }

    // ========================================================================
    // 2. 官方 Google Maps App 導航 / 街景 / 地圖檢視 URI 建構與 Intent 跳轉
    // ========================================================================

    /**
     * 建構在 Google Maps 開啟指定 `mid`「我的地圖」的標準檢視網址
     */
    fun buildMyMapsViewerUrl(mid: String, centerCoords: GpsCoordinates? = null): String {
        val encodedMid = urlEncode(mid.trim())
        return if (centerCoords != null && LocationHelper.isValidLatLng(centerCoords.latitude, centerCoords.longitude)) {
            val ll = String.format(Locale.US, "%.6f,%.6f", centerCoords.latitude, centerCoords.longitude)
            "https://www.google.com/maps/d/viewer?mid=$encodedMid&ll=${urlEncode(ll)}"
        } else {
            "https://www.google.com/maps/d/viewer?mid=$encodedMid"
        }
    }

    /**
     * 建構路線導航 URI：
     * - `appUri`：`google.navigation:q=lat,lng` 或 `google.navigation:q=地點名稱`
     * - `browserFallbackUrl`：`https://www.google.com/maps/dir/?api=1&destination=...&travelmode=driving`
     */
    fun buildNavigationUris(
        coords: GpsCoordinates?,
        queryOrTitle: String = ""
    ): Pair<String, String> {
        val target = when {
            coords != null && LocationHelper.isValidLatLng(coords.latitude, coords.longitude) ->
                formatHighPrecisionLatLng(coords.latitude, coords.longitude)
            queryOrTitle.isNotBlank() -> queryOrTitle.trim()
            else -> ""
        }
        if (target.isEmpty()) {
            return Pair("https://www.google.com/maps", "https://www.google.com/maps")
        }
        val encodedTarget = urlEncode(target)
        val appUri = "google.navigation:q=$encodedTarget"
        val browserUrl = "https://www.google.com/maps/dir/?api=1&destination=$encodedTarget&travelmode=driving"
        return Pair(appUri, browserUrl)
    }

    /**
     * 建構 Google 街景 (Street View) URI：
     * - `appUri`：`google.streetview:cbll=lat,lng`
     * - `browserFallbackUrl`：`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=lat,lng`
     */
    fun buildStreetViewUris(coords: GpsCoordinates): Pair<String, String> {
        val latLng = formatHighPrecisionLatLng(coords.latitude, coords.longitude)
        val appUri = "google.streetview:cbll=$latLng"
        val browserUrl = "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${urlEncode(latLng)}"
        return Pair(appUri, browserUrl)
    }

    /**
     * 建構在 Google Maps 檢視座標圖釘或搜尋地點的 URI：
     * - `appUri`：`geo:lat,lng?q=lat,lng(標籤)` 或 `geo:0,0?q=關鍵字`
     * - `browserFallbackUrl`：`https://www.google.com/maps/search/?api=1&query=...`
     */
    fun buildPlacePinUris(
        coords: GpsCoordinates?,
        labelOrQuery: String = ""
    ): Pair<String, String> {
        val cleanLabel = labelOrQuery.trim()
        if (coords != null && LocationHelper.isValidLatLng(coords.latitude, coords.longitude)) {
            val latLng = formatHighPrecisionLatLng(coords.latitude, coords.longitude)
            val geoQuery = if (cleanLabel.isNotEmpty() && extractLatLngFromText(cleanLabel) == null) {
                "$latLng(${urlEncode(cleanLabel)})"
            } else {
                latLng
            }
            val appUri = "geo:$latLng?q=$geoQuery"
            val browserUrl = "https://www.google.com/maps/search/?api=1&query=${urlEncode(latLng)}"
            return Pair(appUri, browserUrl)
        }

        if (cleanLabel.isNotEmpty()) {
            val encoded = urlEncode(cleanLabel)
            return Pair(
                "geo:0,0?q=$encoded",
                "https://www.google.com/maps/search/?api=1&query=$encoded"
            )
        }

        return Pair("https://www.google.com/maps", "https://www.google.com/maps")
    }

    /**
     * 根據 [GoogleMapsLaunchMode] 與提取到的 [MapNavigationContext]，決定最終要開啟的
     * `(primaryAppUri, browserFallbackUrl)`。
     */
    fun resolveGoogleMapsTargetUris(
        mode: GoogleMapsLaunchMode,
        navContext: MapNavigationContext,
        fallbackGps: GpsCoordinates? = null,
        customTargetInput: String? = null
    ): Pair<String, String> {
        val customTrimmed = customTargetInput?.trim().orEmpty()
        val customCoords = extractLatLngFromText(customTrimmed)
        val bestCoords = customCoords ?: navContext.resolveBestCoordinates(fallbackGps)
        val bestQuery = if (customTrimmed.isNotEmpty() && customCoords == null) {
            customTrimmed
        } else {
            navContext.resolveBestQueryOrTitle()
        }
        val mid = navContext.mid.trim()

        return when (mode) {
            GoogleMapsLaunchMode.MAP_VIEWER_BY_MID -> {
                if (mid.isNotEmpty()) {
                    val viewerUrl = buildMyMapsViewerUrl(mid, bestCoords)
                    Pair(viewerUrl, viewerUrl)
                } else {
                    buildPlacePinUris(bestCoords, bestQuery)
                }
            }
            GoogleMapsLaunchMode.NAVIGATION -> {
                if (customTrimmed.isNotEmpty()) {
                    buildNavigationUris(bestCoords, bestQuery)
                } else {
                    resolveNavigationTargetUris(navContext, bestCoords, bestQuery)
                }
            }
            GoogleMapsLaunchMode.STREET_VIEW -> {
                if (bestCoords != null) {
                    buildStreetViewUris(bestCoords)
                } else {
                    buildPlacePinUris(null, bestQuery)
                }
            }
            GoogleMapsLaunchMode.PLACE_PIN -> {
                if (customTrimmed.isEmpty() &&
                    navContext.placeUrl.isNotBlank() &&
                    isExternalGoogleMapsUrl(navContext.placeUrl)
                ) {
                    Pair(navContext.placeUrl.trim(), navContext.placeUrl.trim())
                } else {
                    buildPlacePinUris(bestCoords, bestQuery)
                }
            }
            GoogleMapsLaunchMode.SMART_OPEN -> {
                // 若使用者有明確選取圖釘或搜尋框有內容，優先開啟該地點；否則若有 mid 則開啟整張地圖
                val hasSelectedPinOrSearch =
                    (navContext.selectedPinLat != null && navContext.selectedPinLng != null) ||
                        (navContext.searchBoxLat != null && navContext.searchBoxLng != null) ||
                        navContext.selectedPinTitle.isNotBlank() ||
                        navContext.searchBoxText.isNotBlank() ||
                        navContext.placeUrl.isNotBlank() ||
                        customTrimmed.isNotEmpty()

                if (customTrimmed.isEmpty() &&
                    navContext.placeUrl.isNotBlank() &&
                    isExternalGoogleMapsUrl(navContext.placeUrl)
                ) {
                    Pair(navContext.placeUrl.trim(), navContext.placeUrl.trim())
                } else if (hasSelectedPinOrSearch && (bestCoords != null || bestQuery.isNotEmpty())) {
                    buildPlacePinUris(bestCoords, bestQuery)
                } else if (mid.isNotEmpty()) {
                    val viewerUrl = buildMyMapsViewerUrl(mid, bestCoords)
                    Pair(viewerUrl, viewerUrl)
                } else if (bestCoords != null || bestQuery.isNotEmpty()) {
                    buildPlacePinUris(bestCoords, bestQuery)
                } else {
                    Pair(MyMapWebViewClient.MY_MAPS_HOME_URL, MyMapWebViewClient.MY_MAPS_HOME_URL)
                }
            }
        }
    }

    /**
     * Phase 13：智慧解析導航目標，優先使用 directionsUrl 與 placeUrl 內的高精準圖釘與官方地點資訊
     */
    private fun resolveNavigationTargetUris(
        navContext: MapNavigationContext,
        fallbackCoords: GpsCoordinates?,
        fallbackQuery: String
    ): Pair<String, String> {
        // 1. 若 directionsUrl 非空，優先從 directionsUrl 提取高精度 !3d!4d 或 destination=
        if (navContext.directionsUrl.isNotBlank()) {
            val dirUrl = navContext.directionsUrl.trim()
            val exactPin = extractExactPinCoordsFromUrl(dirUrl)
            if (exactPin != null) {
                return buildNavigationUris(exactPin, navContext.selectedPinTitle)
            }
            val dirDest = extractDirectionsDestinationFromUrl(dirUrl)
            if (!dirDest.isNullOrBlank()) {
                val destCoords = extractLatLngFromText(dirDest)
                return if (destCoords != null) {
                    buildNavigationUris(destCoords, navContext.selectedPinTitle)
                } else {
                    buildNavigationUris(null, dirDest)
                }
            }
            val generalCoords = extractLatLngFromUrl(dirUrl)
            if (generalCoords != null) {
                return buildNavigationUris(generalCoords, navContext.selectedPinTitle)
            }
        }

        // 2. 若無 directionsUrl 但 placeUrl 非空：
        if (navContext.placeUrl.isNotBlank()) {
            val placeUrl = navContext.placeUrl.trim()

            // 2.1 優先檢查 placeUrl 內明確的 !3dLAT!4dLNG 真實地標座標
            val exactPin = extractExactPinCoordsFromUrl(placeUrl)
            if (exactPin != null) {
                return buildNavigationUris(exactPin, navContext.selectedPinTitle)
            }

            // 2.2 檢查明確目標參數（destination= / daddr= / q=lat,lng / query=lat,lng）
            val queryParamRegex = Regex(
                "(?:[?&](?:destination|daddr|query|q)=)(-?\\d{1,2}(?:\\.\\d+)?)\\s*,\\s*(-?\\d{1,3}(?:\\.\\d+)?)",
                RegexOption.IGNORE_CASE
            )
            queryParamRegex.find(placeUrl)?.let { match ->
                val lat = match.groupValues[1].toDoubleOrNull()
                val lng = match.groupValues[2].toDoubleOrNull()
                if (lat != null && lng != null && LocationHelper.isValidLatLng(lat, lng)) {
                    return buildNavigationUris(
                        GpsCoordinates(lat, lng, provider = "URL_PARAM"),
                        navContext.selectedPinTitle
                    )
                }
            }

            // 2.3 若 placeUrl 帶有 Google 地點識別（如 /maps/place/<地點名稱>/、cid=、ftid=），優先使用官方地名對準官方地標
            val officialName = extractPlaceNameFromMapsUrl(placeUrl)
            if (!officialName.isNullOrBlank()) {
                return buildNavigationUris(null, officialName)
            }
        }

        // 3. 保底退回原本 bestCoords 與 bestQuery
        return buildNavigationUris(fallbackCoords, fallbackQuery)
    }

    /**
     * 透過 `Intent(Intent.ACTION_VIEW, Uri.parse(...))` 直接喚起手機內的官方 Google Maps App
     * (`com.google.android.apps.maps`)；若手機未安裝 Google Maps App 則自動降級以外部瀏覽器開啟。
     *
     * @return `true` 表示成功發起跳轉（含外部瀏覽器備援）
     */
    fun launchGoogleMapsApp(
        context: Context,
        mode: GoogleMapsLaunchMode,
        navContext: MapNavigationContext,
        fallbackGps: GpsCoordinates? = null,
        customTargetInput: String? = null
    ): Boolean {
        val (primaryAppUri, browserFallbackUrl) = resolveGoogleMapsTargetUris(
            mode = mode,
            navContext = navContext,
            fallbackGps = fallbackGps,
            customTargetInput = customTargetInput
        )

        // 1. 優先指定套件名稱 com.google.android.apps.maps 喚起官方 Google Maps App
        try {
            val mapsIntent = Intent(Intent.ACTION_VIEW, Uri.parse(primaryAppUri)).apply {
                setPackage(GOOGLE_MAPS_PACKAGE)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(mapsIntent)
            val actionDesc = when (mode) {
                GoogleMapsLaunchMode.NAVIGATION -> "🧭 已喚起 Google Maps App 進行路線導航"
                GoogleMapsLaunchMode.STREET_VIEW -> "🏙️ 已喚起 Google Maps App 查看街景"
                GoogleMapsLaunchMode.MAP_VIEWER_BY_MID -> "🗺️ 已在 Google Maps App 開啟雲端我的地圖"
                GoogleMapsLaunchMode.PLACE_PIN,
                GoogleMapsLaunchMode.SMART_OPEN -> "🗺️ 已在 Google Maps App 開啟目標位置"
            }
            Toast.makeText(context, actionDesc, Toast.LENGTH_SHORT).show()
            Log.i(TAG, "Launched official Google Maps App ($mode): $primaryAppUri")
            return true
        } catch (notFound: ActivityNotFoundException) {
            Log.w(TAG, "Official Google Maps App not available for $primaryAppUri, falling back to browser.")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to launch Google Maps package directly: ${e.message}")
        }

        // 2. 若未安裝官方 Google Maps App，以外部瀏覽器開啟標準 HTTPS 網址
        return try {
            val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(browserFallbackUrl)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(browserIntent)
            Toast.makeText(
                context,
                "🌐 未偵測到 Google Maps App，已透過外部瀏覽器開啟",
                Toast.LENGTH_SHORT
            ).show()
            Log.i(TAG, "Launched external browser fallback ($mode): $browserFallbackUrl")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open external browser fallback: ${e.message}", e)
            Toast.makeText(
                context,
                "⚠️ 無法開啟外部地圖應用程式：${e.localizedMessage ?: "未知錯誤"}",
                Toast.LENGTH_SHORT
            ).show()
            false
        }
    }

    // ========================================================================
    // 3. KML / KMZ 匯出檔名解析與 DownloadManager 檔案下載邏輯
    // ========================================================================

    /**
     * 根據地圖 `mid` 建構官方直接匯出下載 KML / KMZ 的網址
     * @param mid Google 我的地圖 ID
     * @param exportAsKml `true` 時匯出純 `.kml` (`&forcekml=1`)；`false` 時匯出預設 `.kmz`
     */
    fun buildDirectKmlExportUrl(mid: String, exportAsKml: Boolean = false): String {
        val encodedMid = urlEncode(mid.trim())
        return if (exportAsKml) {
            "https://www.google.com/maps/d/kml?mid=$encodedMid&forcekml=1"
        } else {
            "https://www.google.com/maps/d/kml?mid=$encodedMid"
        }
    }

    /**
     * 從 HTTP `Content-Disposition` 標頭解析檔案名稱。
     * 支援：
     * 1. RFC 5987 / RFC 6266 UTF-8 編碼格式：`filename*=UTF-8''%E6%88%91%E7%9A%84%E5%9C%B0%E5%9C%96.kmz`
     * 2. 雙引號包裹格式：`filename="My Map.kmz"`
     * 3. 無引號格式：`filename=my_map.kml`
     */
    fun parseFileNameFromContentDisposition(contentDisposition: String?): String? {
        if (contentDisposition.isNullOrBlank()) return null

        // 1. 優先匹配 filename*=UTF-8''... 或 filename*=utf-8''...
        val utf8StarRegex = Regex("filename\\*\\s*=\\s*(?:UTF-8|ISO-8859-1)?'[^']*'([^;\\r\\n]+)", RegexOption.IGNORE_CASE)
        utf8StarRegex.find(contentDisposition)?.let { match ->
            val rawEncoded = match.groupValues[1].trim().trim('"', '\'')
            if (rawEncoded.isNotEmpty()) {
                val decoded = try {
                    URLDecoder.decode(rawEncoded, "UTF-8")
                } catch (_: Exception) {
                    rawEncoded
                }
                val cleaned = sanitizeFileName(decoded)
                if (cleaned.isNotEmpty()) return cleaned
            }
        }

        // 2. 匹配帶雙引號的 filename="xxx.kmz"
        val quotedRegex = Regex("filename\\s*=\\s*\"([^\"]+)\"", RegexOption.IGNORE_CASE)
        quotedRegex.find(contentDisposition)?.let { match ->
            val rawQuoted = match.groupValues[1].trim()
            if (rawQuoted.isNotEmpty()) {
                val decoded = try {
                    if (rawQuoted.contains("%")) URLDecoder.decode(rawQuoted, "UTF-8") else rawQuoted
                } catch (_: Exception) {
                    rawQuoted
                }
                val cleaned = sanitizeFileName(decoded)
                if (cleaned.isNotEmpty()) return cleaned
            }
        }

        // 3. 匹配不帶引號的 filename=xxx.kml
        val unquotedRegex = Regex("filename\\s*=\\s*([^;\\r\\n\"']+)", RegexOption.IGNORE_CASE)
        unquotedRegex.find(contentDisposition)?.let { match ->
            val rawUnquoted = match.groupValues[1].trim()
            if (rawUnquoted.isNotEmpty()) {
                val decoded = try {
                    if (rawUnquoted.contains("%")) URLDecoder.decode(rawUnquoted, "UTF-8") else rawUnquoted
                } catch (_: Exception) {
                    rawUnquoted
                }
                val cleaned = sanitizeFileName(decoded)
                if (cleaned.isNotEmpty()) return cleaned
            }
        }

        return null
    }

    /**
     * 判斷此次匯出下載是否為純 `.kml` 格式（若否則預設為 `.kmz` 壓縮圖資格式）
     */
    fun isKmlFormat(
        url: String?,
        contentDisposition: String?,
        mimeType: String?
    ): Boolean {
        val lowerMime = mimeType?.lowercase(Locale.ROOT).orEmpty()
        val lowerDisp = contentDisposition?.lowercase(Locale.ROOT).orEmpty()
        val lowerUrl = url?.lowercase(Locale.ROOT).orEmpty()

        if (lowerDisp.contains(".kml")) return true
        if (lowerDisp.contains(".kmz")) return false
        if (lowerMime.contains("kml+xml") || (lowerMime.contains("kml") && !lowerMime.contains("kmz"))) {
            return true
        }
        if (lowerMime.contains("kmz")) return false
        if (lowerUrl.contains("forcekml=1") || lowerUrl.contains("forcekml=true") || lowerUrl.endsWith(".kml")) {
            return true
        }
        return false
    }

    /**
     * 解析最終儲存至 `Environment.DIRECTORY_DOWNLOADS` 的檔名，
     * 確保自動從 `Content-Disposition` 提取並保證具備 `.kmz` 或 `.kml` 副檔名。
     */
    fun resolveDownloadFileName(
        url: String?,
        contentDisposition: String?,
        mimeType: String?,
        fallbackTitle: String? = null
    ): String {
        val preferKml = isKmlFormat(url, contentDisposition, mimeType)
        val defaultExt = if (preferKml) ".kml" else ".kmz"

        // 1. 優先從 Content-Disposition 解析
        val fromDisposition = parseFileNameFromContentDisposition(contentDisposition)
        if (!fromDisposition.isNullOrBlank()) {
            return ensureKmlOrKmzExtension(fromDisposition, defaultExt)
        }

        // 2. 嘗試透過 Android URLUtil.guessFileName 解析（單元測試環境若為 Stub 則自動跳過）
        val guessed = try {
            URLUtil.guessFileName(url, contentDisposition, mimeType)?.trim()
        } catch (_: Throwable) {
            null
        }
        if (!guessed.isNullOrBlank() &&
            !guessed.startsWith("downloadfile", ignoreCase = true) &&
            !guessed.equals("kml.bin", ignoreCase = true) &&
            !guessed.equals("kml.html", ignoreCase = true) &&
            !guessed.equals("kml", ignoreCase = true)
        ) {
            val cleanedGuessed = sanitizeFileName(guessed)
            if (cleanedGuessed.isNotEmpty()) {
                return ensureKmlOrKmzExtension(cleanedGuessed, defaultExt)
            }
        }

        // 3. 使用網頁標題或 URL mid 作為預設檔名基底
        val cleanTitle = fallbackTitle
            ?.replace("- Google 我的地圖", "")
            ?.replace("- Google My Maps", "")
            ?.trim()
            ?.let { sanitizeFileName(it) }
            .orEmpty()

        val mid = extractMidFromUrl(url)
        val baseName = when {
            cleanTitle.isNotEmpty() && cleanTitle != "Google 我的地圖" && cleanTitle != "Google My Maps" ->
                cleanTitle
            !mid.isNullOrBlank() -> "MyGMap_${sanitizeFileName(mid.take(12))}"
            else -> "MyGMap_Export_${System.currentTimeMillis() / 1000}"
        }

        return ensureKmlOrKmzExtension(baseName, defaultExt)
    }

    /**
     * 處理 WebView `setDownloadListener` 觸發的 KML / KMZ 匯出與檔案下載：
     * 1. 同步讀取 `CookieManager.getInstance().getCookie(url)` 與目前的 `User-Agent`。
     * 2. 建立 `DownloadManager.Request` 將檔案下載至系統 `Environment.DIRECTORY_DOWNLOADS`。
     * 3. 以 Toast 提示使用者下載已開始。
     */
    fun handleWebViewDownload(
        context: Context,
        url: String?,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?,
        pageTitle: String? = null
    ) {
        val cleanUrl = url?.trim().orEmpty()
        if (cleanUrl.isEmpty()) {
            Toast.makeText(context, "⚠️ 下載網址無效", Toast.LENGTH_SHORT).show()
            return
        }

        // 若為非 http/https (例如特殊协议)，交由外部瀏覽器處理
        if (!cleanUrl.startsWith("http://", ignoreCase = true) &&
            !cleanUrl.startsWith("https://", ignoreCase = true)
        ) {
            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(cleanUrl)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            } catch (e: Exception) {
                Log.e(TAG, "Cannot handle non-http download URL: $cleanUrl", e)
            }
            return
        }

        val fileName = resolveDownloadFileName(
            url = cleanUrl,
            contentDisposition = contentDisposition,
            mimeType = mimeType,
            fallbackTitle = pageTitle
        )
        val resolvedMime = when {
            fileName.endsWith(".kml", ignoreCase = true) -> MIME_TYPE_KML
            fileName.endsWith(".kmz", ignoreCase = true) -> MIME_TYPE_KMZ
            !mimeType.isNullOrBlank() -> mimeType
            else -> MIME_TYPE_KMZ
        }

        // 同步讀取 CookieManager Cookie 與目前的 User-Agent，確保 Google 認證 Session 可通過下載驗證
        val cookie = try {
            CookieManager.getInstance().getCookie(cleanUrl)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to read cookie for download: ${e.message}")
            null
        }
        val effectiveUserAgent = userAgent?.trim()?.takeIf { it.isNotEmpty() }
            ?: MyMapWebViewClient.DESKTOP_CHROME_UA

        try {
            val request = DownloadManager.Request(Uri.parse(cleanUrl)).apply {
                if (!cookie.isNullOrBlank()) {
                    addRequestHeader("Cookie", cookie)
                }
                addRequestHeader("User-Agent", effectiveUserAgent)
                setMimeType(resolvedMime)
                setTitle(fileName)
                setDescription("Google 我的地圖匯出檔案 ($fileName)")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                @Suppress("DEPRECATION")
                allowScanningByMediaScanner()
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            }

            val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
            if (downloadManager != null) {
                val downloadId = downloadManager.enqueue(request)
                Log.i(
                    TAG,
                    "Enqueued KML/KMZ download (id=$downloadId, file=$fileName, mime=$resolvedMime, url=$cleanUrl)"
                )
                Toast.makeText(
                    context,
                    "📥 已開始下載「$fileName」至系統「下載 (Downloads)」資料夾",
                    Toast.LENGTH_LONG
                ).show()
                return
            }
        } catch (e: Exception) {
            Log.e(TAG, "DownloadManager enqueue failed for $cleanUrl: ${e.message}", e)
        }

        // 若系統 DownloadManager 因特殊權限或 ROM 限制失敗，自動降級以外部瀏覽器觸發下載
        try {
            val fallbackIntent = Intent(Intent.ACTION_VIEW, Uri.parse(cleanUrl)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(fallbackIntent)
            Toast.makeText(
                context,
                "📥 正在透過外部瀏覽器下載「$fileName」",
                Toast.LENGTH_SHORT
            ).show()
        } catch (e: Exception) {
            Toast.makeText(
                context,
                "⚠️ 無法啟動檔案下載：${e.localizedMessage ?: "未知錯誤"}",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    // ========================================================================
    // 內部輔助函式
    // ========================================================================

    private fun ensureKmlOrKmzExtension(rawName: String, defaultExt: String): String {
        val sanitized = sanitizeFileName(rawName).trim('.')
        if (sanitized.isEmpty()) {
            return "MyGMap_Export$defaultExt"
        }
        val lower = sanitized.lowercase(Locale.ROOT)
        if (lower.endsWith(".kmz") || lower.endsWith(".kml")) {
            return sanitized
        }
        // 移除可能被誤判的 .bin / .xml / .zip / .html 後綴，統一補上 .kmz 或 .kml
        val stripped = sanitized.replace(Regex("\\.(bin|html|htm|txt)$", RegexOption.IGNORE_CASE), "")
        return "$stripped$defaultExt"
    }

    private fun sanitizeFileName(name: String): String {
        return name
            .replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]+"), "_")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    private fun urlEncode(value: String): String {
        return try {
            URLEncoder.encode(value, "UTF-8").replace("+", "%20")
        } catch (_: Exception) {
            value
        }
    }

    private fun unwrapEvaluateJsString(raw: String?): String {
        if (raw.isNullOrBlank()) return ""
        val trimmed = raw.trim()
        if (trimmed == "null" || trimmed == "undefined") return ""
        if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
            return trimmed.substring(1, trimmed.length - 1)
                .replace("\\\"", "\"")
                .replace("\\\\", "\\")
                .replace("\\n", "\n")
                .replace("\\r", "\r")
                .replace("\\t", "\t")
        }
        return trimmed
    }

    private fun optValidDouble(json: JSONObject, rawJson: String, key: String): Double? {
        return try {
            if (json.has(key) && !json.isNull(key)) {
                val v = json.optDouble(key, Double.NaN)
                if (!v.isNaN() && !v.isInfinite()) v else extractJsonDoubleField(rawJson, key)
            } else {
                extractJsonDoubleField(rawJson, key)
            }
        } catch (_: Throwable) {
            extractJsonDoubleField(rawJson, key)
        }
    }

    private fun extractJsonStringField(json: String, key: String): String {
        val regex = Regex("\"${Regex.escape(key)}\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"")
        val match = regex.find(json) ?: return ""
        return match.groupValues[1]
            .replace("\\\"", "\"")
            .replace("\\/", "/")
            .replace("\\\\", "\\")
    }

    private fun extractJsonDoubleField(json: String, key: String): Double? {
        val regex = Regex("\"${Regex.escape(key)}\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)")
        val match = regex.find(json) ?: return null
        return match.groupValues[1].toDoubleOrNull()
    }
}
