package com.guiterevent.mygmap

import com.guiterevent.mygmap.webview.MyMapJsBridge
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class JsBridgeAndAssetsTest {

    @Test
    fun `parseDomInspectInfo extracts tagName, id, ariaLabel, dataTooltip and selector`() {
        val sampleJson = """
            {
              "tagName": "DIV",
              "id": "addtomap-button",
              "className": "goog-inline-block jfk-button",
              "ariaLabel": "新增標記",
              "dataTooltip": "Add marker",
              "title": "",
              "role": "button",
              "dataMygmapRole": "tool-add-marker",
              "text": "新增至地圖",
              "selector": "#addtomap-button"
            }
        """.trimIndent()

        val info = MyMapJsBridge.parseDomInspectInfo(sampleJson)

        assertEquals("DIV", info.tagName)
        assertEquals("addtomap-button", info.id)
        assertEquals("新增標記", info.ariaLabel)
        assertEquals("Add marker", info.dataTooltip)
        assertEquals("tool-add-marker", info.dataMygmapRole)
        assertEquals("#addtomap-button", info.selector)
        assertTrue(info.toBannerSummary().contains("#addtomap-button"))
    }

    @Test
    fun `inject_style_css and inject_script_js assets exist and contain required rules`() {
        val projectRoot = File(System.getProperty("user.dir") ?: ".")
        val assetsDir = if (File(projectRoot, "src/main/assets").exists()) {
            File(projectRoot, "src/main/assets")
        } else {
            File(projectRoot, "app/src/main/assets")
        }

        val cssFile = File(assetsDir, "inject_style.css")
        val jsFile = File(assetsDir, "inject_script.js")

        assertTrue("inject_style.css should exist", cssFile.exists())
        assertTrue("inject_script.js should exist", jsFile.exists())

        val cssText = cssFile.readText(Charsets.UTF_8)
        assertTrue("CSS must scope rules under body.mygmap-mobile-mode", cssText.contains("body.mygmap-mobile-mode"))
        assertTrue("CSS must support mygmap-drawer-closed", cssText.contains("mygmap-drawer-closed"))
        assertTrue("CSS must support mygmap-drawer-open", cssText.contains("mygmap-drawer-open"))
        assertTrue("CSS must style #mapsprosearch-field", cssText.contains("#mapsprosearch-field"))
        assertTrue("CSS must style #addtomap-button", cssText.contains("#addtomap-button"))

        val jsText = jsFile.readText(Charsets.UTF_8)
        assertTrue("JS must expose window.MyGMapHelper", jsText.contains("window.MyGMapHelper"))
        assertTrue("JS must enforce viewport meta", jsText.contains("width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"))
        assertTrue("JS must report onPageModeChanged", jsText.contains("onPageModeChanged"))
        assertTrue("JS must report onDomInspected", jsText.contains("onDomInspected"))

        // Phase 3 required JS Helper APIs & Closure event sequence
        assertTrue("JS must expose simulateClick", jsText.contains("simulateClick"))
        assertTrue(
            "JS simulateClick must dispatch full pointer/mouse sequence",
            jsText.contains("['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']")
        )
        assertTrue("JS must expose toggleLayerDrawer", jsText.contains("toggleLayerDrawer"))
        assertTrue("JS must expose searchPlace", jsText.contains("searchPlace"))
        assertTrue("JS must expose clickAddToMap", jsText.contains("clickAddToMap"))
        assertTrue("JS must expose activateAddMarkerTool", jsText.contains("activateAddMarkerTool"))
        assertTrue("JS must expose activatePanTool", jsText.contains("activatePanTool"))
        assertTrue("JS must expose toggleMobileCssMode", jsText.contains("toggleMobileCssMode"))
        assertTrue("JS must expose triggerUndo", jsText.contains("triggerUndo"))
        assertTrue("JS must expose triggerRedo", jsText.contains("triggerRedo"))

        // Phase 4 required GPS Pin Automation State Machine APIs & InfoWindow selectors
        assertTrue("JS must expose addGpsPinToMap", jsText.contains("addGpsPinToMap"))
        assertTrue("JS must report onGpsPinStatus", jsText.contains("onGpsPinStatus"))
        assertTrue("JS must check #map-infowindow-attr-名稱-value", jsText.contains("map-infowindow-attr-名稱-value"))
        assertTrue("JS must check #map-infowindow-attr-name-value", jsText.contains("map-infowindow-attr-name-value"))
        assertTrue("JS must check #map-infowindow-done-editing-button", jsText.contains("map-infowindow-done-editing-button"))

        // Phase 5 required Navigation Context Extraction & Touch Isolation
        assertTrue("JS must expose extractNavigationContext", jsText.contains("extractNavigationContext"))
        assertTrue("CSS must isolate drawer touch-action and overscroll", cssText.contains("overscroll-behavior: contain"))
    }

    @Test
    fun `parseGpsPinStatusInfo extracts step, message, fallbackUsed and clipboardText`() {
        val statusJson = """
            {
              "step": "FALLBACK_CLIPBOARD",
              "message": "📍 圖釘已加入地圖！請直接長按氣泡窗貼上標題與備註",
              "subMessage": "📋 已自動複製到剪貼簿",
              "isCompleted": true,
              "isError": false,
              "fallbackUsed": true,
              "pinAdded": true,
              "title": "象山觀景台",
              "description": "夜景拍攝點",
              "clipboardText": "象山觀景台 - 夜景拍攝點"
            }
        """.trimIndent()

        val status = MyMapJsBridge.parseGpsPinStatusInfo(statusJson)

        assertEquals("FALLBACK_CLIPBOARD", status.step)
        assertTrue(status.isCompleted)
        assertTrue(status.fallbackUsed)
        assertTrue(status.pinAdded)
        assertEquals("象山觀景台", status.title)
        assertEquals("夜景拍攝點", status.description)
        assertEquals("象山觀景台 - 夜景拍攝點", status.clipboardText)
    }
}
