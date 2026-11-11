package com.guiterevent.mygmap

import com.guiterevent.mygmap.webview.MyMapJsBridge
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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

        // Phase 10 required Map Canvas Protection & Visibility Rules
        assertTrue("JS must define containsMapOrEditorRoot", jsText.contains("containsMapOrEditorRoot"))
        assertTrue(
            "JS must protect map canvas and editor roots from layer-panel tagging",
            jsText.contains("#map-canvas") && jsText.contains(".gm-style") && jsText.contains("#mapsprosearch-field")
        )
        assertTrue("JS must dispatch resize event after drawer layout", jsText.contains("new Event('resize')"))

        val mapCanvasRuleStart = cssText.indexOf("body.mygmap-mobile-mode #map-canvas")
        assertTrue("CSS must contain map-canvas mobile rule", mapCanvasRuleStart >= 0)
        val mapCanvasRuleEnd = cssText.indexOf("}", mapCanvasRuleStart)
        val mapCanvasRuleBlock = cssText.substring(mapCanvasRuleStart, mapCanvasRuleEnd)
        assertTrue("Map canvas rule must enforce right: 0 !important", mapCanvasRuleBlock.contains("right: 0 !important;"))
        assertTrue("Map canvas rule must enforce visibility: visible !important", mapCanvasRuleBlock.contains("visibility: visible !important;"))
        assertTrue("Map canvas rule must enforce opacity: 1 !important", mapCanvasRuleBlock.contains("opacity: 1 !important;"))

        // Phase 11 required External Navigation Interception & InfoWindow Directions Touch Targets
        assertTrue("JS must call onExternalNavigationRequested", jsText.contains("onExternalNavigationRequested"))
        assertTrue("JS must wrap window.open", jsText.contains("installWindowOpenInterceptor"))
        assertTrue("JS must check external Google Maps URLs", jsText.contains("isExternalGoogleMapsUrl"))
        assertTrue("JS must support .gm-style-iw and [role=\"dialog\"] containers", jsText.contains(".gm-style-iw") && jsText.contains("[role=\"dialog\"]"))
        assertTrue("JS must detect #map-infowindow-directions-button", jsText.contains("#map-infowindow-directions-button"))
        assertTrue("CSS must style #map-infowindow-directions-button", cssText.contains("#map-infowindow-directions-button"))
        assertTrue("CSS must style InfoWindow /maps/dir links", cssText.contains("a[href*=\"/maps/dir\"]"))

        // Phase 12 required POI InfoWindow Beautification & Selected Pin Bridge State
        assertTrue("CSS must constrain .gm-style-iw-c and .gm-style-iw-d width", cssText.contains(".gm-style-iw-c") && cssText.contains(".gm-style-iw-d"))
        assertTrue("CSS must enforce max-width calc(100vw - 28px)", cssText.contains("calc(100vw - 28px)"))
        assertTrue("CSS must enforce word wrapping inside InfoWindow", cssText.contains("overflow-wrap: anywhere !important"))
        assertTrue("CSS must enable flex-wrap for InfoWindow buttons", cssText.contains("flex-wrap: wrap !important"))
        assertTrue("CSS must style InfoWindow maps links", cssText.contains("a[href*=\"maps\"]"))
        assertTrue("JS must define extractSelectedPinUiState", jsText.contains("extractSelectedPinUiState"))
        assertTrue("JS must report onSelectedPinStateChanged", jsText.contains("onSelectedPinStateChanged"))
        assertTrue("JS must expose triggerInfoWindowEdit", jsText.contains("triggerInfoWindowEdit"))
        assertTrue("JS must expose closeInfoWindow", jsText.contains("closeInfoWindow"))
        assertTrue("CSS must support hiding web InfoWindow in view mode", cssText.contains("mygmap-pin-view-hidden"))
        assertTrue("CSS must support centering edit InfoWindow", cssText.contains("mygmap-pin-editing"))
        assertTrue("JS must define centerEditInfoWindowInViewport", jsText.contains("centerEditInfoWindowInViewport"))
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

    @Test
    fun `parseSelectedPinInfo parses visible, edit mode and hidden states`() {
        val visibleJson = """
            {
              "visible": true,
              "title": "大安森林公園音樂露台",
              "details": "台北市大安區新生南路二段1號",
              "rating": "4.7",
              "coordinates": "25.029654, 121.536210",
              "lat": 25.029654,
              "lng": 121.536210,
              "isEditMode": false,
              "photoUrls": ["https://lh3.googleusercontent.com/p/photo1", "https://lh3.googleusercontent.com/p/photo2"]
            }
        """.trimIndent()

        val visiblePin = MyMapJsBridge.parseSelectedPinInfo(visibleJson)
        assertTrue(visiblePin.visible)
        assertEquals("大安森林公園音樂露台", visiblePin.title)
        assertEquals("台北市大安區新生南路二段1號", visiblePin.details)
        assertEquals("4.7", visiblePin.rating)
        assertEquals("25.029654, 121.536210", visiblePin.coordinates)
        assertEquals(25.029654, visiblePin.lat!!, 0.000001)
        assertEquals(121.536210, visiblePin.lng!!, 0.000001)
        assertFalse(visiblePin.isEditMode)
        assertEquals(2, visiblePin.photoUrls.size)
        assertEquals("https://lh3.googleusercontent.com/p/photo1", visiblePin.photoUrls[0])

        val editModeJson = """
            {
              "visible": true,
              "title": "編輯中景點",
              "details": "",
              "rating": "",
              "coordinates": "",
              "lat": null,
              "lng": null,
              "isEditMode": true
            }
        """.trimIndent()

        val editingPin = MyMapJsBridge.parseSelectedPinInfo(editModeJson)
        assertTrue(editingPin.visible)
        assertTrue(editingPin.isEditMode)
        assertEquals("編輯中景點", editingPin.title)
        assertNull(editingPin.lat)
        assertNull(editingPin.lng)

        val hiddenPin = MyMapJsBridge.parseSelectedPinInfo("""{"visible": false}""")
        assertFalse(hiddenPin.visible)
        assertEquals("", hiddenPin.title)

        val blankPin = MyMapJsBridge.parseSelectedPinInfo("")
        assertFalse(blankPin.visible)
    }
}
