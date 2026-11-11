package com.guiterevent.mygmap.webview

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * 儲存從 `inject_script.js` 開發者 DOM 探測模式 (Inspect Mode) 回傳的單一 DOM 元素詳細資訊。
 */
data class DomInspectInfo(
    val tagName: String,
    val id: String,
    val className: String,
    val ariaLabel: String,
    val dataTooltip: String,
    val title: String,
    val role: String,
    val dataMygmapRole: String,
    val text: String,
    val selector: String,
    val rectSummary: String,
    val rawJson: String
) {
    /**
     * 產生適合在頂部除錯橫幅快速檢視的精簡摘要字串
     */
    fun toBannerSummary(): String {
        val parts = mutableListOf<String>()
        parts.add("<${tagName.ifBlank { "UNKNOWN" }}>")
        if (id.isNotBlank()) parts.add("#$id")
        if (ariaLabel.isNotBlank()) parts.add("aria=\"$ariaLabel\"")
        if (dataTooltip.isNotBlank()) parts.add("tooltip=\"$dataTooltip\"")
        if (dataMygmapRole.isNotBlank()) parts.add("mygmap=\"$dataMygmapRole\"")
        if (className.isNotBlank() && id.isBlank() && ariaLabel.isBlank()) {
            val shortCls = className.split(Regex("\\s+")).take(2).joinToString(".")
            parts.add(".$shortCls")
        }
        return parts.joinToString(" | ")
    }
}

/**
 * 儲存從 `inject_script.js` Phase 4 自動化打卡狀態機 (`addGpsPinToMap`) 回報的進度與完成狀態。
 */
data class GpsPinStatusInfo(
    val step: String,
    val message: String,
    val subMessage: String = "",
    val isCompleted: Boolean = false,
    val isError: Boolean = false,
    val fallbackUsed: Boolean = false,
    val pinAdded: Boolean = false,
    val title: String = "",
    val description: String = "",
    val clipboardText: String = "",
    val rawJson: String = ""
)

/**
 * WebView 與 Android 原生層的雙向通訊橋樑 (`window.AndroidBridge`)。
 *
 * 注意：`@JavascriptInterface` 方法皆由 WebView 內部的 `JavaBridge` 背景執行緒呼叫，
 * 因此所有 UI 狀態回呼皆統一透過 `mainHandler` 切換回 Android 主執行緒執行。
 */
class MyMapJsBridge(
    private val onPageModeChangedCallback: (isEditorPage: Boolean) -> Unit = {},
    private val onDomInspectedCallback: (info: DomInspectInfo) -> Unit = {},
    private val onDrawerStateChangedCallback: (isOpen: Boolean) -> Unit = {},
    private val onMobileModeChangedCallback: (isMobileMode: Boolean) -> Unit = {},
    private val onInspectModeChangedCallback: (isInspectMode: Boolean) -> Unit = {},
    private val onActiveToolChangedCallback: (toolName: String) -> Unit = {},
    private val onGpsPinStatusCallback: (status: GpsPinStatusInfo) -> Unit = {},
    private val onExternalNavigationRequestedCallback: (targetUrl: String?, contextJson: String?) -> Unit = { _, _ -> }
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    companion object {
        private const val TAG = "MyMapJsBridge"

        /** 掛載於 WebView `addJavascriptInterface` 的全域物件名稱 */
        const val BRIDGE_NAME = "AndroidBridge"

        /**
         * 將 JS 傳回的 JSON 字串解析為 [DomInspectInfo]。
         * 內建對 JVM 單元測試環境 (Stub JSONObject) 的正規表達式備援解析。
         */
        fun parseDomInspectInfo(infoJson: String): DomInspectInfo {
            if (infoJson.isBlank()) {
                return DomInspectInfo(
                    tagName = "UNKNOWN",
                    id = "",
                    className = "",
                    ariaLabel = "",
                    dataTooltip = "",
                    title = "",
                    role = "",
                    dataMygmapRole = "",
                    text = "",
                    selector = "",
                    rectSummary = "",
                    rawJson = infoJson
                )
            }

            return try {
                val json = JSONObject(infoJson)
                // 在純 JVM Unit Test 中，JSONObject(str) 可能不會立即拋出例外，而是在呼叫 optString 時拋出 Stub RuntimeException
                val tagName = json.optString("tagName", "")
                val rectObj = json.optJSONObject("rect")
                val rectSummary = if (rectObj != null) {
                    "(${rectObj.optInt("x", 0)}, ${rectObj.optInt("y", 0)}) ${rectObj.optInt("width", 0)}x${rectObj.optInt("height", 0)}"
                } else {
                    ""
                }

                DomInspectInfo(
                    tagName = tagName.ifBlank { extractJsonStringField(infoJson, "tagName") }.ifBlank { "ELEMENT" },
                    id = json.optString("id", ""),
                    className = json.optString("className", ""),
                    ariaLabel = json.optString("ariaLabel", ""),
                    dataTooltip = json.optString("dataTooltip", ""),
                    title = json.optString("title", ""),
                    role = json.optString("role", ""),
                    dataMygmapRole = json.optString("dataMygmapRole", ""),
                    text = json.optString("text", ""),
                    selector = json.optString("selector", ""),
                    rectSummary = rectSummary,
                    rawJson = infoJson
                )
            } catch (_: Throwable) {
                // Fallback parser for local JVM unit tests where android.jar JSONObject is a stub
                DomInspectInfo(
                    tagName = extractJsonStringField(infoJson, "tagName").ifBlank { "ELEMENT" },
                    id = extractJsonStringField(infoJson, "id"),
                    className = extractJsonStringField(infoJson, "className"),
                    ariaLabel = extractJsonStringField(infoJson, "ariaLabel"),
                    dataTooltip = extractJsonStringField(infoJson, "dataTooltip"),
                    title = extractJsonStringField(infoJson, "title"),
                    role = extractJsonStringField(infoJson, "role"),
                    dataMygmapRole = extractJsonStringField(infoJson, "dataMygmapRole"),
                    text = extractJsonStringField(infoJson, "text"),
                    selector = extractJsonStringField(infoJson, "selector"),
                    rectSummary = "",
                    rawJson = infoJson
                )
            }
        }

        /**
         * 將 JS `reportGpsPinStatus` 傳回的 JSON 字串解析為 [GpsPinStatusInfo]。
         * 內建對 JVM 單元測試環境 (Stub JSONObject) 的正規表達式備援解析。
         */
        fun parseGpsPinStatusInfo(statusJson: String): GpsPinStatusInfo {
            if (statusJson.isBlank()) {
                return GpsPinStatusInfo(
                    step = "UNKNOWN",
                    message = "",
                    rawJson = statusJson
                )
            }

            return try {
                val json = JSONObject(statusJson)
                val step = json.optString("step", "")
                GpsPinStatusInfo(
                    step = step.ifBlank { extractJsonStringField(statusJson, "step") }.ifBlank { "UNKNOWN" },
                    message = json.optString("message", "").ifBlank { extractJsonStringField(statusJson, "message") },
                    subMessage = json.optString("subMessage", "").ifBlank { extractJsonStringField(statusJson, "subMessage") },
                    isCompleted = json.optBoolean("isCompleted", extractJsonBooleanField(statusJson, "isCompleted")),
                    isError = json.optBoolean("isError", extractJsonBooleanField(statusJson, "isError")),
                    fallbackUsed = json.optBoolean("fallbackUsed", extractJsonBooleanField(statusJson, "fallbackUsed")),
                    pinAdded = json.optBoolean("pinAdded", extractJsonBooleanField(statusJson, "pinAdded")),
                    title = json.optString("title", "").ifBlank { extractJsonStringField(statusJson, "title") },
                    description = json.optString("description", "").ifBlank { extractJsonStringField(statusJson, "description") },
                    clipboardText = json.optString("clipboardText", "").ifBlank { extractJsonStringField(statusJson, "clipboardText") },
                    rawJson = statusJson
                )
            } catch (_: Throwable) {
                GpsPinStatusInfo(
                    step = extractJsonStringField(statusJson, "step").ifBlank { "UNKNOWN" },
                    message = extractJsonStringField(statusJson, "message"),
                    subMessage = extractJsonStringField(statusJson, "subMessage"),
                    isCompleted = extractJsonBooleanField(statusJson, "isCompleted"),
                    isError = extractJsonBooleanField(statusJson, "isError"),
                    fallbackUsed = extractJsonBooleanField(statusJson, "fallbackUsed"),
                    pinAdded = extractJsonBooleanField(statusJson, "pinAdded"),
                    title = extractJsonStringField(statusJson, "title"),
                    description = extractJsonStringField(statusJson, "description"),
                    clipboardText = extractJsonStringField(statusJson, "clipboardText"),
                    rawJson = statusJson
                )
            }
        }

        private fun extractJsonStringField(json: String, key: String): String {
            val regex = Regex("\"${Regex.escape(key)}\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"")
            val match = regex.find(json) ?: return ""
            return match.groupValues[1]
                .replace("\\\"", "\"")
                .replace("\\\\", "\\")
        }

        private fun extractJsonBooleanField(json: String, key: String): Boolean {
            val regex = Regex("\"${Regex.escape(key)}\"\\s*:\\s*(true|false)")
            val match = regex.find(json) ?: return false
            return match.groupValues[1] == "true"
        }
    }

    /**
     * 由 `inject_script.js` 呼叫：回報目前位於「地圖編輯頁 (`true`)」或「地圖列表首頁 (`false`)」
     */
    @JavascriptInterface
    fun onPageModeChanged(isEditorPage: Boolean) {
        Log.i(TAG, "onPageModeChanged -> isEditorPage=$isEditorPage")
        mainHandler.post {
            onPageModeChangedCallback(isEditorPage)
        }
    }

    /**
     * 由 `inject_script.js` 呼叫：當開發者開啟「DOM 探測模式 (Inspect Mode)」並點擊網頁任意元素時，
     * 傳回包含 `tagName`, `id`, `className`, `ariaLabel`, `dataTooltip` 與建議 `selector` 的 JSON。
     */
    @JavascriptInterface
    fun onDomInspected(infoJson: String) {
        Log.i(TAG, "onDomInspected -> $infoJson")
        val parsed = parseDomInspectInfo(infoJson)
        mainHandler.post {
            onDomInspectedCallback(parsed)
        }
    }

    /**
     * 由 `inject_script.js` 呼叫：同步左側圖層面板抽屜開關狀態（例如使用者點擊網頁遮罩收合抽屜時）
     */
    @JavascriptInterface
    fun onDrawerStateChanged(isOpen: Boolean) {
        Log.d(TAG, "onDrawerStateChanged -> isOpen=$isOpen")
        mainHandler.post {
            onDrawerStateChangedCallback(isOpen)
        }
    }

    /**
     * 由 `inject_script.js` 呼叫：同步手機優化排版 (`true`) / 原始桌面排版逃生門 (`false`) 狀態
     */
    @JavascriptInterface
    fun onMobileModeChanged(isMobileMode: Boolean) {
        Log.d(TAG, "onMobileModeChanged -> isMobileMode=$isMobileMode")
        mainHandler.post {
            onMobileModeChangedCallback(isMobileMode)
        }
    }

    /**
     * 由 `inject_script.js` 呼叫：同步開發者 DOM 探測模式狀態
     */
    @JavascriptInterface
    fun onInspectModeChanged(isInspectMode: Boolean) {
        Log.d(TAG, "onInspectModeChanged -> isInspectMode=$isInspectMode")
        mainHandler.post {
            onInspectModeChangedCallback(isInspectMode)
        }
    }

    /**
     * 由 `inject_script.js` 呼叫：同步目前啟用的地圖編輯工具 (`'pan'` 或 `'addMarker'`)
     */
    @JavascriptInterface
    fun onActiveToolChanged(toolName: String) {
        Log.d(TAG, "onActiveToolChanged -> toolName=$toolName")
        mainHandler.post {
            onActiveToolChangedCallback(toolName)
        }
    }

    /**
     * Phase 4：由 `inject_script.js` 的 `addGpsPinToMap(lat, lng, title, description)` 呼叫，
     * 即時回報自動化打卡狀態機各階段 (`STEP_1_SEARCH`, `STEP_2_ADD_TO_MAP`, `STEP_3_FILL_AND_SAVE`, `COMPLETED`, `FALLBACK_CLIPBOARD`)。
     */
    @JavascriptInterface
    fun onGpsPinStatus(statusJson: String) {
        Log.i(TAG, "onGpsPinStatus -> $statusJson")
        val parsed = parseGpsPinStatusInfo(statusJson)
        mainHandler.post {
            onGpsPinStatusCallback(parsed)
        }
    }

    /**
     * Phase 11：由 `inject_script.js` 呼叫（例如攔截 `window.open` 或氣泡窗「導航 / 規劃路線」按鈕點擊），
     * 請求 Android 原生層開啟官方 Google Maps App 導航或外部地圖連結。
     */
    @JavascriptInterface
    fun onExternalNavigationRequested(targetUrl: String?, contextJson: String?) {
        Log.i(TAG, "onExternalNavigationRequested -> targetUrl=$targetUrl")
        mainHandler.post {
            onExternalNavigationRequestedCallback(targetUrl, contextJson)
        }
    }
}
