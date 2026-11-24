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

        // Phase 13 required Exact Maps Coordinates Extraction & Action URLs
        assertTrue("JS must define extractExactCoordsFromMapsUrl", jsText.contains("extractExactCoordsFromMapsUrl"))
        assertTrue("JS must define findInfoWindowActionUrls", jsText.contains("findInfoWindowActionUrls"))
        assertTrue("JS extractExactCoordsFromMapsUrl must prioritize !3d!4d pattern", jsText.contains("!3d") && jsText.contains("!4d"))

        // Phase 14 required Layer Drawer Interactivity, Scrolling & Backdrop Boundary Rules
        assertTrue("CSS must enforce touch-action: pan-y in drawer", cssText.contains("touch-action: pan-y !important;"))
        assertTrue("CSS must elevate .goog-menu and [role=\"menu\"]", cssText.contains(".goog-menu") && cssText.contains("[role=\"menu\"]"))
        assertTrue("CSS must elevate menu z-index to 10050", cssText.contains("z-index: 10050 !important;"))
        assertTrue("CSS must unlock layer-panel-shell", cssText.contains("layer-panel-shell"))
        assertTrue("CSS must enforce layer-panel-shell z-index and overflow", cssText.contains("z-index: 9988 !important;") && cssText.contains("overflow: visible !important;"))
        assertTrue("CSS must align drawer backdrop to right edge", cssText.contains("right: 0 !important;") && cssText.contains("width: auto !important;"))

        assertTrue("JS must define syncDrawerBackdropBounds", jsText.contains("syncDrawerBackdropBounds"))
        assertTrue("JS must define syncLayerPanelShells", jsText.contains("syncLayerPanelShells"))
        assertTrue("JS must tag layer-panel-shell", jsText.contains("layer-panel-shell"))
        assertTrue("JS must dynamically set backdrop left offset", jsText.contains("backdrop.style.setProperty('left'"))

        // Phase 15 required Native EditPinDialog CSS Lock & JS Background Edit/Save/Cancel/Delete APIs
        assertTrue("CSS must define mygmap-native-pin-editing lock rule", cssText.contains("mygmap-native-pin-editing"))
        assertTrue("JS must expose openNativePinEdit", jsText.contains("openNativePinEdit"))
        assertTrue("JS must expose saveNativePinEdit", jsText.contains("saveNativePinEdit"))
        assertTrue("JS must expose cancelNativePinEdit", jsText.contains("cancelNativePinEdit"))
        assertTrue("JS must expose deleteSelectedPin", jsText.contains("deleteSelectedPin"))
        assertTrue("JS must expose fallbackToWebPinEdit", jsText.contains("fallbackToWebPinEdit"))
        assertTrue("JS must call onPinEditFormReady", jsText.contains("onPinEditFormReady"))
        assertTrue("JS must call onPinEditResult", jsText.contains("onPinEditResult"))

        // Phase 16 required Anti-Flicker Default Hide, Untagged Input Selector, PreventScroll & Viewport Scroll Lock
        assertTrue(
            "CSS must hide InfoWindow by default unless editing or addtomap visible",
            cssText.contains("mygmap-addtomap-visible") &&
                cssText.contains("body.mygmap-mobile-mode:not(.mygmap-pin-editing):not(.mygmap-addtomap-visible)")
        )
        assertTrue("CSS must lock overflow hidden on mobile root", cssText.contains("overflow: hidden !important;"))
        assertTrue("JS must use focus({ preventScroll: true })", jsText.contains("preventScroll: true"))
        assertTrue("JS must define resetMapViewportScrollLock", jsText.contains("resetMapViewportScrollLock"))
        assertTrue(
            "JS must support <input> without explicit type=\"text\" in InfoWindow edit selector",
            jsText.contains("input:not([type=\"hidden\"]):not([type=\"checkbox\"]):not([type=\"radio\"]):not([type=\"button\"]):not([type=\"submit\"]):not([type=\"file\"])")
        )
        assertTrue("JS must toggle mygmap-addtomap-visible for search green pins", jsText.contains("mygmap-addtomap-visible"))
        assertTrue("JS must install InfoWindow focus/scrollIntoView guard", jsText.contains("installInfoWindowFocusScrollGuard"))
        assertTrue("JS must dispatch focus/focusin and clear label-input-label for Closure LabelInput", jsText.contains("dispatchEditableFocusEvents") && jsText.contains("label-input-label"))
        assertTrue("JS must match any contenteditable including plaintext-only and empty attr", jsText.contains("[contenteditable]:not([contenteditable=\"false\"])") && jsText.contains("isContentEditableNode"))
        assertTrue("JS must wait for editable fields on lazy save", jsText.contains("hasReadyEditableFields") && jsText.contains("findEditableByAttrIds"))
        assertTrue("CSS must collapse hidden InfoWindow card to 8px to stop Google Maps autoPan", cssText.contains("width: 8px !important;") && cssText.contains("height: 8px !important;"))

        // Phase 17 required Inner Closure Button Resolution & Strict Save Exit Verification
        assertTrue("JS must define resolveClickableButton", jsText.contains("resolveClickableButton"))
        assertTrue("JS must define clickInfoWindowControl", jsText.contains("clickInfoWindowControl"))
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
              "description": "週末下午常有街頭藝人與吉他表演",
              "details": "台北市大安區新生南路二段1號",
              "rating": "4.7",
              "coordinates": "25.029654, 121.536210",
              "lat": 25.029654,
              "lng": 121.536210,
              "isEditMode": false,
              "photoUrls": ["https://lh3.googleusercontent.com/p/photo1", "https://lh3.googleusercontent.com/p/photo2"],
              "placeUrl": "https://www.google.com/maps/place/Bogen+Hostel+as/@68.51358,17.01783,16z/data=!3d68.514123!4d17.012345",
              "directionsUrl": "https://www.google.com/maps/dir/?api=1&destination=68.514123,17.012345"
            }
        """.trimIndent()

        val visiblePin = MyMapJsBridge.parseSelectedPinInfo(visibleJson)
        assertTrue(visiblePin.visible)
        assertEquals("大安森林公園音樂露台", visiblePin.title)
        assertEquals("週末下午常有街頭藝人與吉他表演", visiblePin.description)
        assertEquals("台北市大安區新生南路二段1號", visiblePin.details)
        assertEquals("4.7", visiblePin.rating)
        assertEquals("25.029654, 121.536210", visiblePin.coordinates)
        assertEquals(25.029654, visiblePin.lat!!, 0.000001)
        assertEquals(121.536210, visiblePin.lng!!, 0.000001)
        assertFalse(visiblePin.isEditMode)
        assertEquals(2, visiblePin.photoUrls.size)
        assertEquals("https://lh3.googleusercontent.com/p/photo1", visiblePin.photoUrls[0])
        assertEquals("https://www.google.com/maps/place/Bogen+Hostel+as/@68.51358,17.01783,16z/data=!3d68.514123!4d17.012345", visiblePin.placeUrl)
        assertEquals("https://www.google.com/maps/dir/?api=1&destination=68.514123,17.012345", visiblePin.directionsUrl)

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
        assertEquals("", editingPin.placeUrl)
        assertEquals("", editingPin.directionsUrl)

        val hiddenPin = MyMapJsBridge.parseSelectedPinInfo("""{"visible": false}""")
        assertFalse(hiddenPin.visible)
        assertEquals("", hiddenPin.title)
        assertEquals("", hiddenPin.placeUrl)
        assertEquals("", hiddenPin.directionsUrl)

        val blankPin = MyMapJsBridge.parseSelectedPinInfo("")
        assertFalse(blankPin.visible)
    }

    @Test
    fun `parsePinEditFormState parses title, description, extraFields, canDelete and failure state`() {
        val successJson = """
            {
              "ok": true,
              "title": "象山親山步道觀景台",
              "description": "傍晚看台北 101 夕陽與夜景最佳位置",
              "extraFields": [
                {
                  "id": "map-infowindow-attr-分類-value",
                  "label": "分類",
                  "value": "攝影秘境",
                  "multiline": false
                },
                {
                  "id": "map-infowindow-attr-交通方式-value",
                  "label": "交通方式",
                  "value": "捷運象山站步行 15 分鐘",
                  "multiline": true
                }
              ],
              "canDelete": true,
              "canEditPhoto": true,
              "canEditStyle": true,
              "errorMessage": ""
            }
        """.trimIndent()

        val form = MyMapJsBridge.parsePinEditFormState(successJson)
        assertTrue(form.ok)
        assertEquals("象山親山步道觀景台", form.title)
        assertEquals("傍晚看台北 101 夕陽與夜景最佳位置", form.description)
        assertTrue(form.canDelete)
        assertTrue(form.canEditPhoto)
        assertTrue(form.canEditStyle)
        assertEquals("", form.errorMessage)
        assertEquals(2, form.extraFields.size)
        assertEquals("map-infowindow-attr-分類-value", form.extraFields[0].id)
        assertEquals("分類", form.extraFields[0].label)
        assertEquals("攝影秘境", form.extraFields[0].value)
        assertFalse(form.extraFields[0].multiline)
        assertEquals("map-infowindow-attr-交通方式-value", form.extraFields[1].id)
        assertEquals("交通方式", form.extraFields[1].label)
        assertEquals("捷運象山站步行 15 分鐘", form.extraFields[1].value)
        assertTrue(form.extraFields[1].multiline)

        val failureJson = """
            {
              "ok": false,
              "title": "",
              "description": "",
              "extraFields": [],
              "canDelete": false,
              "errorMessage": "此地圖目前為唯讀檢視模式"
            }
        """.trimIndent()

        val failedForm = MyMapJsBridge.parsePinEditFormState(failureJson)
        assertFalse(failedForm.ok)
        assertFalse(failedForm.canDelete)
        assertTrue(failedForm.extraFields.isEmpty())
        assertEquals("此地圖目前為唯讀檢視模式", failedForm.errorMessage)

        val saveResult = MyMapJsBridge.parsePinEditResult("""{"ok": true, "action": "save", "message": "✅ 已儲存地點變更"}""")
        assertTrue(saveResult.ok)
        assertEquals("save", saveResult.action)
        assertEquals("✅ 已儲存地點變更", saveResult.message)
    }
}
