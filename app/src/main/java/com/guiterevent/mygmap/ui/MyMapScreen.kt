package com.guiterevent.mygmap.ui

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Rect
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.ViewCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.guiterevent.mygmap.BuildConfig
import com.guiterevent.mygmap.R
import com.guiterevent.mygmap.location.GpsCoordinates
import com.guiterevent.mygmap.location.LocationFetchResult
import com.guiterevent.mygmap.location.LocationHelper
import com.guiterevent.mygmap.webview.DomInspectInfo
import com.guiterevent.mygmap.webview.GoogleMapsLaunchMode
import com.guiterevent.mygmap.webview.GpsPinStatusInfo
import com.guiterevent.mygmap.webview.MapExportAndIntentHelper
import com.guiterevent.mygmap.webview.MapNavigationContext
import com.guiterevent.mygmap.webview.MyMapJsBridge
import com.guiterevent.mygmap.webview.MyMapWebViewClient
import com.guiterevent.mygmap.webview.WebViewInjector
import java.util.Locale

/**
 * MyGMap 主畫面 (Phase 1 ~ Phase 5 完整整合：
 * WebView 核心載入、動態 UA 偽裝、JS Bridge 雙向通訊、左側圖層抽屜化、CSS 逃生門、
 * DOM 探測工具、單手操作底部工具列 `BottomActionBar`、「📍 一鍵新增目前 GPS 位置」自動化打卡工作流、
 * 「🗺️ 在 Google Maps App 開啟」導航/街景跳轉、`DownloadListener` KML/KMZ 匯出下載、
 * 多點觸控手勢防衝突與離線防呆機制)
 */
@SuppressLint("ClickableViewAccessibility", "SetJavaScriptEnabled")
@Composable
fun MyMapScreen(
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var loadingProgress by remember { mutableFloatStateOf(0.1f) }
    var currentUrl by remember { mutableStateOf(MyMapWebViewClient.MY_MAPS_HOME_URL) }
    var pageTitle by remember { mutableStateOf("Google 我的地圖") }
    var canGoBack by remember { mutableStateOf(false) }
    var uaMode by remember { mutableStateOf(MyMapWebViewClient.UserAgentMode.DESKTOP_EDITOR) }
    var webError by remember { mutableStateOf<String?>(null) }
    var showExitDialog by remember { mutableStateOf(false) }

    // Phase 2: JS Bridge 狀態與 CSS 改造/DOM 探測控制狀態
    var isEditorPage by remember { mutableStateOf(false) }
    var isMobileMode by remember { mutableStateOf(true) }
    var isDrawerOpen by remember { mutableStateOf(false) }
    var isInspectMode by remember { mutableStateOf(false) }
    var latestInspectedDom by remember { mutableStateOf<DomInspectInfo?>(null) }
    var showInspectDetailDialog by remember { mutableStateOf(false) }

    // Phase 3: 原生底部工具列互動狀態 (快速搜尋對話框、一鍵加入地圖浮動面板、插針模式引導橫幅)
    var showSearchDialog by remember { mutableStateOf(false) }
    var lastEnteredSearchText by remember { mutableStateOf("") }
    var activeSearchQuery by remember { mutableStateOf<String?>(null) }
    var isAddMarkerMode by remember { mutableStateOf(false) }

    // Phase 4: 「📍 標記目前位置」GPS 定位、快速新增對話框與自動化打卡狀態機進度
    var isLocatingGps by remember { mutableStateOf(false) }
    var currentGpsCoordinates by remember { mutableStateOf<GpsCoordinates?>(null) }
    var showQuickPinDialog by remember { mutableStateOf(false) }
    var showLocationGuideDialog by remember { mutableStateOf(false) }
    var locationPermissionDenied by remember { mutableStateOf(false) }
    var locationServicesDisabled by remember { mutableStateOf(false) }
    var locationErrorMessage by remember { mutableStateOf<String?>(null) }
    var gpsPinAutomationStatus by remember { mutableStateOf<GpsPinStatusInfo?>(null) }

    // Phase 5: 跳轉官方 Google Maps App 對話框、導航上下文與即時離線狀態監測
    var showOpenInGoogleMapsDialog by remember { mutableStateOf(false) }
    var extractedNavContext by remember { mutableStateOf(MapNavigationContext()) }
    var isOffline by remember { mutableStateOf(!MyMapWebViewClient.isNetworkAvailable(context)) }

    // Phase 6 坑洞 3 防護：暫存來自 WebView HTML5 Geolocation (navigator.geolocation) 的權限請求回呼
    var pendingGeolocationRequest by remember {
        mutableStateOf<Pair<String?, GeolocationPermissions.Callback?>?>(null)
    }
    var pendingNativeGpsPinRequest by remember { mutableStateOf(false) }
    var openDialogAfterPermissionGranted by remember { mutableStateOf(true) }

    val currentMobileMode by rememberUpdatedState(isMobileMode)
    val currentDrawerOpen by rememberUpdatedState(isDrawerOpen)
    val currentInspectMode by rememberUpdatedState(isInspectMode)
    val currentPageTitle by rememberUpdatedState(pageTitle)

    // Phase 5：從網頁與目前網址提取 mid 及選取座標，並開啟「🗺️ 在 Google Maps App 開啟」對話框
    fun openGoogleMapsActionDialog() {
        val wv = webViewRef
        if (wv != null) {
            WebViewInjector.extractNavigationContext(wv) { navInfo ->
                val fallbackSearch = activeSearchQuery?.trim().orEmpty()
                val fallbackCoords = MapExportAndIntentHelper.extractLatLngFromText(fallbackSearch)
                extractedNavContext = if (navInfo.searchBoxText.isBlank() && fallbackSearch.isNotEmpty()) {
                    navInfo.copy(
                        searchBoxText = fallbackSearch,
                        searchBoxLat = navInfo.searchBoxLat ?: fallbackCoords?.latitude,
                        searchBoxLng = navInfo.searchBoxLng ?: fallbackCoords?.longitude
                    )
                } else {
                    navInfo
                }
                showOpenInGoogleMapsDialog = true
            }
        } else {
            extractedNavContext = MapExportAndIntentHelper.parseNavigationContextJson(
                rawEvaluateJsResult = null,
                fallbackUrl = currentUrl
            )
            showOpenInGoogleMapsDialog = true
        }
    }

    // Phase 5：一鍵觸發當前地圖的 KML / KMZ 匯出下載
    fun triggerDirectKmlExport(exportAsKml: Boolean) {
        val mid = MapExportAndIntentHelper.extractMidFromUrl(currentUrl)
            ?: extractedNavContext.mid.takeIf { it.isNotBlank() }
        if (mid.isNullOrBlank()) {
            Toast.makeText(
                context,
                "ℹ️ 請先進入任一張「我的地圖」編輯頁，或從地圖選單點擊「匯出為 KML/KMZ」",
                Toast.LENGTH_LONG
            ).show()
            return
        }
        val exportUrl = MapExportAndIntentHelper.buildDirectKmlExportUrl(mid, exportAsKml = exportAsKml)
        val ua = webViewRef?.settings?.userAgentString ?: MyMapWebViewClient.DESKTOP_CHROME_UA
        val mime = if (exportAsKml) {
            MapExportAndIntentHelper.MIME_TYPE_KML
        } else {
            MapExportAndIntentHelper.MIME_TYPE_KMZ
        }
        MapExportAndIntentHelper.handleWebViewDownload(
            context = context,
            url = exportUrl,
            userAgent = ua,
            contentDisposition = null,
            mimeType = mime,
            pageTitle = pageTitle
        )
    }

    // Phase 4：封裝啟動高精準度 GPS 定位並在成功後開啟 QuickPinDialog 的流程
    fun triggerGpsLocationFetch(openDialogWhenResolved: Boolean) {
        if (!LocationHelper.isLocationEnabled(context)) {
            isLocatingGps = false
            locationPermissionDenied = false
            locationServicesDisabled = true
            locationErrorMessage = null
            showLocationGuideDialog = true
            return
        }

        isLocatingGps = true
        LocationHelper.fetchCurrentLocation(context) { result ->
            isLocatingGps = false
            when (result) {
                is LocationFetchResult.Success -> {
                    currentGpsCoordinates = result.coordinates
                    locationPermissionDenied = false
                    locationServicesDisabled = false
                    locationErrorMessage = null
                    if (openDialogWhenResolved) {
                        showQuickPinDialog = true
                    } else {
                        Toast.makeText(
                            context,
                            "📍 已更新座標：${result.coordinates.formatLatLng(6)}",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                }
                is LocationFetchResult.PermissionDenied -> {
                    locationPermissionDenied = true
                    locationServicesDisabled = false
                    locationErrorMessage = null
                    showLocationGuideDialog = true
                }
                is LocationFetchResult.LocationServicesDisabled -> {
                    locationPermissionDenied = false
                    locationServicesDisabled = true
                    locationErrorMessage = null
                    showLocationGuideDialog = true
                }
                is LocationFetchResult.Error -> {
                    locationPermissionDenied = false
                    locationServicesDisabled = false
                    locationErrorMessage = result.message
                    showLocationGuideDialog = true
                }
            }
        }
    }

    // Phase 4 & Phase 6：使用 ActivityResultContracts.RequestMultiplePermissions 同時整合：
    // 1. 原生底部「📍 標記目前位置」定位請求
    // 2. WebView 內建 HTML5 Geolocation (navigator.geolocation -> onGeolocationPermissionsShowPrompt) 授權回呼
    val locationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val fineGranted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true
        val coarseGranted = permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        val granted = fineGranted || coarseGranted || LocationHelper.hasLocationPermission(context)

        // Phase 6 坑洞 3 防護：若存在暫存的 HTML5 Geolocation 權限請求，立即回呼 callback.invoke(origin, granted, false)
        val pendingGeo = pendingGeolocationRequest
        if (pendingGeo != null) {
            pendingGeolocationRequest = null
            val (origin, callback) = pendingGeo
            callback?.invoke(origin, granted, false)
            if (!granted && !pendingNativeGpsPinRequest) {
                Toast.makeText(
                    context,
                    "⚠️ 未授予手機定位權限，網頁內建定位功能無法取得目前 GPS 位置",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }

        // 若此次權限請求同時或由原生「📍 標記目前位置」發起，接續執行原生定位與對話框流程
        if (pendingNativeGpsPinRequest || pendingGeo == null) {
            val shouldOpenDialog = openDialogAfterPermissionGranted
            pendingNativeGpsPinRequest = false
            openDialogAfterPermissionGranted = true
            if (granted) {
                triggerGpsLocationFetch(openDialogWhenResolved = shouldOpenDialog)
            } else {
                isLocatingGps = false
                locationPermissionDenied = true
                locationServicesDisabled = false
                locationErrorMessage = null
                showLocationGuideDialog = true
            }
        }
    }

    val currentLocationPermissionLauncher by rememberUpdatedState(locationPermissionLauncher)

    fun onMarkCurrentLocationClick() {
        if (isLocatingGps) return
        if (!LocationHelper.hasLocationPermission(context)) {
            pendingNativeGpsPinRequest = true
            openDialogAfterPermissionGranted = true
            locationPermissionLauncher.launch(LocationHelper.REQUIRED_PERMISSIONS)
        } else {
            triggerGpsLocationFetch(openDialogWhenResolved = true)
        }
    }

    // 處理系統返回鍵與手勢：
    // 1. 若左側圖層抽屜開啟中，優先收合抽屜
    // 2. 若處於「📌 插針模式」，優先切回「🖐️ 手型選取/平移模式」
    // 3. 若 WebView 可返回上一頁則返回
    // 4. 否則詢問是否離開 App
    BackHandler(enabled = true) {
        val wv = webViewRef
        when {
            isDrawerOpen && wv != null -> {
                isDrawerOpen = false
                WebViewInjector.setDrawerOpen(wv, false)
            }
            isAddMarkerMode && wv != null -> {
                isAddMarkerMode = false
                WebViewInjector.activatePanTool(wv)
            }
            wv != null && wv.canGoBack() -> {
                wv.goBack()
            }
            else -> {
                showExitDialog = true
            }
        }
    }

    // Phase 5：即時監聽系統網路連線狀態 (ConnectivityManager.NetworkCallback)，提供離線防呆與自動恢復提示
    DisposableEffect(context) {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val mainHandler = Handler(Looper.getMainLooper())
        val networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                mainHandler.post {
                    val wasOffline = isOffline
                    isOffline = false
                    if (wasOffline && webError != null) {
                        webError = null
                        webViewRef?.reload()
                    }
                }
            }

            override fun onLost(network: Network) {
                mainHandler.post {
                    isOffline = !MyMapWebViewClient.isNetworkAvailable(context)
                }
            }
        }
        try {
            cm?.registerDefaultNetworkCallback(networkCallback)
        } catch (_: Exception) {
        }
        onDispose {
            try {
                cm?.unregisterNetworkCallback(networkCallback)
            } catch (_: Exception) {
            }
        }
    }

    // 監聽 Activity 生命週期：
    // 1. ON_RESUME：執行 Phase 6 白屏防呆檢查（若 webView.url.isNullOrBlank() 或停留在 about:blank 則自動重載 MY_MAPS_HOME_URL）
    // 2. ON_PAUSE / ON_STOP：強制執行 CookieManager.getInstance().flush() 將 Cookie 寫入磁碟，確保重開 App 登入狀態不遺失
    // 3. onDispose：畫面銷毀時完整釋放 WebView 避免記憶體洩漏
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> {
                    isOffline = !MyMapWebViewClient.isNetworkAvailable(context)
                    webViewRef?.let { wv ->
                        wv.onResume()
                        if (wv.settings.userAgentString != MyMapWebViewClient.DESKTOP_CHROME_UA) {
                            wv.settings.userAgentString = MyMapWebViewClient.DESKTOP_CHROME_UA
                        }
                        val activeUrl = wv.url
                        if (activeUrl.isNullOrBlank() || MyMapWebViewClient.isBlankOrInvalidUrl(activeUrl)) {
                            val recoveryUrl = MyMapWebViewClient.resolveRecoveryUrl(
                                currentUrl,
                                MyMapWebViewClient.MY_MAPS_HOME_URL
                            )
                            wv.loadUrl(recoveryUrl)
                        } else if (!isLoading) {
                            wv.evaluateJavascript(
                                "(function(){ return (!document.body || document.body.innerHTML.trim().length === 0) ? 'BLANK' : 'OK'; })()"
                            ) { domResult ->
                                if (domResult?.contains("BLANK") == true && !isLoading) {
                                    val recoveryUrl = MyMapWebViewClient.resolveRecoveryUrl(
                                        wv.url,
                                        MyMapWebViewClient.MY_MAPS_HOME_URL
                                    )
                                    wv.loadUrl(recoveryUrl)
                                }
                            }
                        }
                    }
                }
                Lifecycle.Event.ON_PAUSE -> {
                    CookieManager.getInstance().flush()
                    MyMapWebViewClient.flushCookies()
                    webViewRef?.onPause()
                }
                Lifecycle.Event.ON_STOP -> {
                    CookieManager.getInstance().flush()
                    MyMapWebViewClient.flushCookies()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            pendingGeolocationRequest = null
            CookieManager.getInstance().flush()
            MyMapWebViewClient.flushCookies()
            webViewRef?.let { wv ->
                try {
                    WebViewInjector.cancelActiveGpsPinTask(wv)
                    wv.stopLoading()
                    wv.setDownloadListener(null)
                    wv.removeJavascriptInterface(MyMapJsBridge.BRIDGE_NAME)
                    (wv.parent as? ViewGroup)?.removeView(wv)
                    wv.destroy()
                } catch (_: Throwable) {
                }
            }
            webViewRef = null
        }
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            Column(modifier = Modifier.fillMaxWidth()) {
                TopStatusHeader(
                    title = pageTitle,
                    currentUrl = currentUrl,
                    uaMode = uaMode,
                    isEditorPage = isEditorPage,
                    canGoBack = canGoBack,
                    onBackClick = {
                        val wv = webViewRef
                        if (isDrawerOpen && wv != null) {
                            isDrawerOpen = false
                            WebViewInjector.setDrawerOpen(wv, false)
                        } else if (isAddMarkerMode && wv != null) {
                            isAddMarkerMode = false
                            WebViewInjector.activatePanTool(wv)
                        } else if (wv != null && wv.canGoBack()) {
                            wv.goBack()
                        }
                    },
                    onOpenInGoogleMapsClick = {
                        openGoogleMapsActionDialog()
                    },
                    onHomeClick = {
                        webError = null
                        isDrawerOpen = false
                        isAddMarkerMode = false
                        activeSearchQuery = null
                        webViewRef?.loadUrl(MyMapWebViewClient.MY_MAPS_HOME_URL)
                    },
                    onReloadClick = {
                        isOffline = !MyMapWebViewClient.isNetworkAvailable(context)
                        webError = null
                        isAddMarkerMode = false
                        webViewRef?.reload()
                    }
                )

                // Phase 3：當啟動「📌 插針模式」時，於畫面上方顯示醒目提示橫幅與切回「🖐️ 手型選取/平移模式」快捷按鈕
                AnimatedVisibility(visible = isAddMarkerMode) {
                    AddMarkerModeBanner(
                        onSwitchToPanMode = {
                            isAddMarkerMode = false
                            webViewRef?.let { wv ->
                                WebViewInjector.activatePanTool(wv)
                            }
                            Toast.makeText(
                                context,
                                "🖐️ 已切換回手型選取/平移模式",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    )
                }

                // Phase 4：當執行「📍 一鍵新增目前 GPS 位置」自動化狀態機時，即時顯示 Step 1 ~ Step 3 進度與結果橫幅
                AnimatedVisibility(visible = gpsPinAutomationStatus != null) {
                    gpsPinAutomationStatus?.let { statusInfo ->
                        GpsPinAutomationBanner(
                            status = statusInfo,
                            onDismiss = {
                                gpsPinAutomationStatus = null
                                webViewRef?.let { WebViewInjector.cancelActiveGpsPinTask(it) }
                            }
                        )
                    }
                }

                // 頂部 DOM 探測除錯橫幅 (當開啟探測模式或有最新探測結果時顯示)
                AnimatedVisibility(visible = isInspectMode || latestInspectedDom != null) {
                    DomInspectBanner(
                        inspectModeActive = isInspectMode,
                        info = latestInspectedDom,
                        onOpenDetails = {
                            if (latestInspectedDom != null) {
                                showInspectDetailDialog = true
                            }
                        },
                        onCopySelector = { selector ->
                            copyToClipboard(context, "DOM Selector", selector)
                            Toast.makeText(context, "已複製 Selector: $selector", Toast.LENGTH_SHORT).show()
                        },
                        onDismiss = {
                            latestInspectedDom = null
                            if (isInspectMode) {
                                isInspectMode = false
                                webViewRef?.let { WebViewInjector.setInspectMode(it, false) }
                            }
                        }
                    )
                }

                // 頂部細長載入進度條
                AnimatedVisibility(visible = isLoading) {
                    LinearProgressIndicator(
                        progress = { loadingProgress.coerceIn(0.05f, 1.0f) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(3.dp),
                        color = Color(0xFF1A73E8),
                        trackColor = Color(0xFFE8F0FE)
                    )
                }
            }
        },
        bottomBar = {
            // Phase 3：於非 OAuth 登入頁顯示單手操作友善的 Material 3 原生底部工具列
            if (uaMode == MyMapWebViewClient.UserAgentMode.DESKTOP_EDITOR) {
                BottomActionBar(
                    isEditorPage = isEditorPage,
                    isDrawerOpen = isDrawerOpen,
                    isSearchPanelActive = showSearchDialog || activeSearchQuery != null,
                    isAddMarkerMode = isAddMarkerMode,
                    isMobileMode = isMobileMode,
                    isInspectMode = isInspectMode,
                    onToggleLayerDrawer = {
                        val wv = webViewRef
                        if (wv != null) {
                            val nextOpen = !isDrawerOpen
                            isDrawerOpen = nextOpen
                            if (nextOpen && !isMobileMode) {
                                isMobileMode = true
                            }
                            WebViewInjector.toggleLayerDrawer(wv) { actualOpen ->
                                isDrawerOpen = actualOpen
                            }
                        }
                    },
                    onOpenSearch = {
                        showSearchDialog = true
                    },
                    onToggleAddMarker = {
                        val wv = webViewRef
                        if (wv != null) {
                            if (!isAddMarkerMode) {
                                WebViewInjector.activateAddMarkerTool(wv) { ok ->
                                    if (ok) {
                                        isAddMarkerMode = true
                                        isDrawerOpen = false
                                    } else {
                                        Toast.makeText(
                                            context,
                                            "⚠️ 找不到「新增標記」工具，請確認已進入地圖編輯頁",
                                            Toast.LENGTH_SHORT
                                        ).show()
                                    }
                                }
                            } else {
                                isAddMarkerMode = false
                                WebViewInjector.activatePanTool(wv)
                                Toast.makeText(
                                    context,
                                    "🖐️ 已切換回手型選取/平移模式",
                                    Toast.LENGTH_SHORT
                                ).show()
                            }
                        }
                    },
                    onActivatePanTool = {
                        isAddMarkerMode = false
                        webViewRef?.let { wv ->
                            WebViewInjector.activatePanTool(wv)
                        }
                        Toast.makeText(
                            context,
                            "🖐️ 已切換回手型選取/平移模式",
                            Toast.LENGTH_SHORT
                        ).show()
                    },
                    onNavigateHome = {
                        webError = null
                        isDrawerOpen = false
                        isAddMarkerMode = false
                        activeSearchQuery = null
                        webViewRef?.loadUrl(MyMapWebViewClient.MY_MAPS_HOME_URL)
                    },
                    onToggleMobileCssMode = {
                        val wv = webViewRef
                        if (wv != null) {
                            val nextMobile = !isMobileMode
                            isMobileMode = nextMobile
                            if (!nextMobile) {
                                isDrawerOpen = false
                            }
                            WebViewInjector.toggleMobileCssMode(wv) { actualMobile ->
                                isMobileMode = actualMobile
                                val modeMsg = if (actualMobile) {
                                    "已切換為：📱 手機優化排版"
                                } else {
                                    "已切換為：🖥️ 原始桌面排版 (CSS Bypass 逃生門)"
                                }
                                Toast.makeText(context, modeMsg, Toast.LENGTH_SHORT).show()
                            }
                        }
                    },
                    onToggleInspectMode = {
                        val nextInspect = !isInspectMode
                        isInspectMode = nextInspect
                        webViewRef?.let { WebViewInjector.setInspectMode(it, nextInspect) }
                        if (nextInspect) {
                            Toast.makeText(
                                context,
                                "🔍 DOM 探測模式已開啟：請點擊網頁上任意按鈕檢視 Selector",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    },
                    onUndo = {
                        webViewRef?.let { wv ->
                            WebViewInjector.triggerUndo(wv) { ok ->
                                val msg = if (ok) "↩️ 已觸發復原 (Undo)" else "⚠️ 目前無可復原的動作"
                                Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
                            }
                        }
                    },
                    onRedo = {
                        webViewRef?.let { wv ->
                            WebViewInjector.triggerRedo(wv) { ok ->
                                val msg = if (ok) "↪️ 已觸發重做 (Redo)" else "⚠️ 目前無可重做的動作"
                                Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
                            }
                        }
                    },
                    onOpenInGoogleMaps = {
                        openGoogleMapsActionDialog()
                    },
                    onExportKmlKmz = {
                        triggerDirectKmlExport(exportAsKml = false)
                    }
                )
            }
        },
        floatingActionButton = {
            // Phase 4：於右下方加入醒目的 ExtendedFloatingActionButton「📍 標記目前位置」
            if (uaMode == MyMapWebViewClient.UserAgentMode.DESKTOP_EDITOR) {
                ExtendedFloatingActionButton(
                    onClick = { onMarkCurrentLocationClick() },
                    modifier = Modifier.padding(
                        bottom = if (activeSearchQuery != null && webError == null) 66.dp else 0.dp
                    ),
                    containerColor = Color(0xFF0F766E),
                    contentColor = Color.White,
                    shape = RoundedCornerShape(16.dp),
                    icon = {
                        if (isLocatingGps) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.4.dp,
                                color = Color.White
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Default.MyLocation,
                                contentDescription = "標記目前位置",
                                modifier = Modifier.size(22.dp)
                            )
                        }
                    },
                    text = {
                        Text(
                            text = if (isLocatingGps) "📡 GPS 定位中…" else "📍 標記目前位置",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                )
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    // Debug 建置下開啟 Chrome DevTools 遠端除錯 (chrome://inspect)
                    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

                    WebView(ctx).apply {
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                        overScrollMode = View.OVER_SCROLL_NEVER
                        isVerticalScrollBarEnabled = false
                        isHorizontalScrollBarEnabled = false

                        // Phase 5：手勢防衝突優化
                        // 1. 當使用者於地圖進行單指拖曳或雙指縮放 (Pinch-to-Zoom) 時，要求父容器禁止攔截觸控事件
                        setOnTouchListener { v, event ->
                            when (event.actionMasked) {
                                MotionEvent.ACTION_DOWN,
                                MotionEvent.ACTION_POINTER_DOWN,
                                MotionEvent.ACTION_MOVE -> {
                                    v.parent?.requestDisallowInterceptTouchEvent(true)
                                }
                                MotionEvent.ACTION_UP,
                                MotionEvent.ACTION_CANCEL -> {
                                    v.parent?.requestDisallowInterceptTouchEvent(false)
                                }
                            }
                            false
                        }

                        // 2. Android 10+ 系統邊緣手勢排除區 (保護畫面中段 180dp 地圖拖曳區，避免邊緣平移地圖時誤觸系統返回手勢)
                        addOnLayoutChangeListener { v, left, top, right, bottom, _, _, _, _ ->
                            val width = right - left
                            val height = bottom - top
                            if (width > 0 && height > 0) {
                                val density = v.resources.displayMetrics.density
                                val edgeWidthPx = (36 * density).toInt().coerceAtMost(width / 4)
                                val bandHeightPx = (180 * density).toInt().coerceAtMost(height)
                                val bandTop = ((height - bandHeightPx) / 2).coerceAtLeast(0)
                                val bandBottom = (bandTop + bandHeightPx).coerceAtMost(height)
                                ViewCompat.setSystemGestureExclusionRects(
                                    v,
                                    listOf(
                                        Rect(0, bandTop, edgeWidthPx, bandBottom),
                                        Rect(width - edgeWidthPx, bandTop, width, bandBottom)
                                    )
                                )
                            }
                        }

                        // 初始化 WebSettings、開啟第一方與第三方 Cookie，並取得移除 `; wv` 後的乾淨 Auth UA
                        val sanitizedAuthUa = MyMapWebViewClient.configureWebView(this)

                        // Phase 5：註冊 setDownloadListener 支援 KML / KMZ 匯出與檔案下載
                        // 同步讀取 CookieManager Cookie 與目前的 User-Agent，透過 DownloadManager 下載至系統 DIRECTORY_DOWNLOADS
                        setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
                            val effectiveUa = userAgent?.takeIf { it.isNotBlank() }
                                ?: this.settings.userAgentString
                                ?: MyMapWebViewClient.DESKTOP_CHROME_UA
                            MapExportAndIntentHelper.handleWebViewDownload(
                                context = ctx,
                                url = url,
                                userAgent = effectiveUa,
                                contentDisposition = contentDisposition,
                                mimeType = mimetype,
                                pageTitle = currentPageTitle
                            )
                        }

                        // 掛載 Phase 2 ~ Phase 4 JS Bridge (window.AndroidBridge)
                        val jsBridge = MyMapJsBridge(
                            onPageModeChangedCallback = { editorMode ->
                                isEditorPage = editorMode
                                if (!editorMode) {
                                    isAddMarkerMode = false
                                    activeSearchQuery = null
                                }
                            },
                            onDomInspectedCallback = { domInfo ->
                                latestInspectedDom = domInfo
                            },
                            onDrawerStateChangedCallback = { open ->
                                isDrawerOpen = open
                            },
                            onMobileModeChangedCallback = { mobile ->
                                isMobileMode = mobile
                            },
                            onInspectModeChangedCallback = { inspect ->
                                isInspectMode = inspect
                            },
                            onActiveToolChangedCallback = { toolName ->
                                isAddMarkerMode = (toolName == "addMarker")
                            },
                            onGpsPinStatusCallback = { statusInfo ->
                                gpsPinAutomationStatus = statusInfo
                                if (statusInfo.fallbackUsed) {
                                    val clipText = statusInfo.clipboardText.ifBlank {
                                        LocationHelper.buildClipboardFallbackText(
                                            statusInfo.title,
                                            statusInfo.description
                                        )
                                    }
                                    copyToClipboard(context, "MyGMap GPS Pin", clipText)
                                    Toast.makeText(
                                        context,
                                        "📋 已複製「$clipText」至剪貼簿，可直接長按氣泡窗貼上！",
                                        Toast.LENGTH_LONG
                                    ).show()
                                } else if (statusInfo.isCompleted && !statusInfo.isError) {
                                    Toast.makeText(
                                        context,
                                        statusInfo.message,
                                        Toast.LENGTH_SHORT
                                    ).show()
                                }
                            }
                        )
                        addJavascriptInterface(jsBridge, MyMapJsBridge.BRIDGE_NAME)

                        webViewClient = MyMapWebViewClient(
                            sanitizedAuthUserAgent = sanitizedAuthUa,
                            onPageLoadingChanged = { loading ->
                                isLoading = loading
                                canGoBack = this.canGoBack()
                            },
                            onUrlChanged = { url ->
                                currentUrl = url
                                canGoBack = this.canGoBack()
                            },
                            onUserAgentModeChanged = { mode ->
                                uaMode = mode
                            },
                            onErrorReceived = { err ->
                                webError = err
                            },
                            onPageReadyForInjection = { view, _ ->
                                WebViewInjector.injectAll(
                                    webView = view,
                                    mobileMode = currentMobileMode,
                                    drawerOpen = currentDrawerOpen,
                                    inspectMode = currentInspectMode
                                )
                            },
                            onRenderProcessGoneRecovered = { view, _ ->
                                isLoading = false
                                webError = null
                                val recoveryUrl = MyMapWebViewClient.resolveRecoveryUrl(
                                    view?.url,
                                    currentUrl
                                )
                                currentUrl = recoveryUrl
                            }
                        )

                        webChromeClient = object : WebChromeClient() {
                            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                                super.onProgressChanged(view, newProgress)
                                loadingProgress = newProgress / 100f
                                isLoading = newProgress < 100
                                canGoBack = view?.canGoBack() == true
                            }

                            override fun onReceivedTitle(view: WebView?, title: String?) {
                                super.onReceivedTitle(view, title)
                                if (!title.isNullOrBlank()) {
                                    pageTitle = title
                                }
                            }

                            /**
                             * Phase 6 坑洞 3 防護：
                             * 支援 Google 我的地圖網頁內建 HTML5 定位按鈕 (W3C navigator.geolocation)。
                             * - 若 App 已具備定位權限，立即呼叫 callback?.invoke(origin, true, false) 自動放行。
                             * - 若尚未授權，暫存 (origin, callback) 並觸發系統定位權限請求，待使用者授權返回後無縫回呼！
                             */
                            override fun onGeolocationPermissionsShowPrompt(
                                origin: String?,
                                callback: GeolocationPermissions.Callback?
                            ) {
                                if (LocationHelper.hasLocationPermission(ctx)) {
                                    callback?.invoke(origin, true, false)
                                } else {
                                    pendingGeolocationRequest = origin to callback
                                    currentLocationPermissionLauncher.launch(
                                        LocationHelper.REQUIRED_PERMISSIONS
                                    )
                                }
                            }

                            override fun onGeolocationPermissionsHidePrompt() {
                                super.onGeolocationPermissionsHidePrompt()
                                pendingGeolocationRequest = null
                            }
                        }

                        webViewRef = this
                        loadUrl(MyMapWebViewClient.MY_MAPS_HOME_URL)
                    }
                },
                update = { view ->
                    webViewRef = view
                }
            )

            // Phase 3：搜尋後的一鍵「➕ 加入地圖 (clickAddToMap())」快捷浮動面板
            AnimatedVisibility(
                visible = activeSearchQuery != null && webError == null,
                modifier = Modifier.align(Alignment.BottomCenter)
            ) {
                SearchAddToMapFloatingBar(
                    searchQuery = activeSearchQuery ?: "",
                    onClickAddToMap = {
                        webViewRef?.let { wv ->
                            WebViewInjector.clickAddToMap(wv) { ok ->
                                if (ok) {
                                    Toast.makeText(
                                        context,
                                        "✅ 已將「${activeSearchQuery ?: "搜尋地點"}」加入當前地圖圖層！",
                                        Toast.LENGTH_SHORT
                                    ).show()
                                } else {
                                    Toast.makeText(
                                        context,
                                        "ℹ️ 請先點擊地圖上的綠色搜尋圖釘打開資訊氣泡，再按「➕ 加入地圖」",
                                        Toast.LENGTH_LONG
                                    ).show()
                                }
                            }
                        }
                    },
                    onReopenSearch = {
                        showSearchDialog = true
                    },
                    onDismiss = {
                        activeSearchQuery = null
                    }
                )
            }

            // Phase 5：離線防呆與網頁載入異常提示面板（支援重新整理與直接跳轉官方 Google Maps App）
            if (isOffline || webError != null) {
                Surface(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(
                            start = 12.dp,
                            end = 12.dp,
                            bottom = if (activeSearchQuery != null) 76.dp else 14.dp
                        )
                        .fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = if (isOffline) Color(0xFFFEF3C7) else MaterialTheme.colorScheme.errorContainer,
                    tonalElevation = 8.dp,
                    shadowElevation = 8.dp
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.WifiOff,
                                contentDescription = null,
                                tint = if (isOffline) Color(0xFFB45309) else MaterialTheme.colorScheme.onErrorContainer,
                                modifier = Modifier.size(20.dp)
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = if (isOffline) {
                                        stringResource(id = R.string.offline_banner_title)
                                    } else {
                                        "⚠️ 網頁載入異常"
                                    },
                                    style = MaterialTheme.typography.titleSmall,
                                    color = if (isOffline) Color(0xFF78350F) else MaterialTheme.colorScheme.onErrorContainer,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = if (isOffline) {
                                        stringResource(id = R.string.offline_banner_message)
                                    } else {
                                        webError ?: ""
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (isOffline) Color(0xFF92400E) else MaterialTheme.colorScheme.onErrorContainer,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            OutlinedButton(
                                onClick = { openGoogleMapsActionDialog() },
                                shape = RoundedCornerShape(8.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Map,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Google Maps 開啟", fontSize = 12.sp)
                            }
                            Spacer(modifier = Modifier.width(8.dp))
                            Button(
                                onClick = {
                                    isOffline = !MyMapWebViewClient.isNetworkAvailable(context)
                                    webError = null
                                    webViewRef?.reload()
                                },
                                shape = RoundedCornerShape(8.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Refresh,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("重新整理", fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
        }
    }

    // Phase 3：Android 原生快速搜尋地點對話框
    if (showSearchDialog) {
        QuickSearchDialog(
            initialQuery = lastEnteredSearchText,
            onDismiss = { showSearchDialog = false },
            onConfirmSearch = { query ->
                showSearchDialog = false
                lastEnteredSearchText = query
                activeSearchQuery = query
                isDrawerOpen = false
                isAddMarkerMode = false

                webViewRef?.let { wv ->
                    WebViewInjector.searchPlace(wv, query) { ok ->
                        if (ok) {
                            Toast.makeText(
                                context,
                                "🔍 已搜尋「$query」，點選綠釘後可按下方「➕ 加入地圖」",
                                Toast.LENGTH_SHORT
                            ).show()
                        } else {
                            Toast.makeText(
                                context,
                                "⚠️ 找不到地圖搜尋框 (#mapsprosearch-field)，請確認已進入地圖編輯頁",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                }
            },
            onQuickAddToMap = {
                showSearchDialog = false
                webViewRef?.let { wv ->
                    WebViewInjector.clickAddToMap(wv) { ok ->
                        if (ok) {
                            Toast.makeText(
                                context,
                                "✅ 已將目前搜尋地點加入地圖！",
                                Toast.LENGTH_SHORT
                            ).show()
                        } else {
                            Toast.makeText(
                                context,
                                "ℹ️ 畫面上尚未開啟搜尋結果氣泡 (#addtomap-button)",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                }
            }
        )
    }

    // Phase 4：「📍 快速新增目前 GPS 位置」原生對話框
    if (showQuickPinDialog) {
        QuickPinDialog(
            initialCoordinates = currentGpsCoordinates,
            isRefreshingLocation = isLocatingGps,
            isEditorPage = isEditorPage,
            onRefreshLocation = {
                if (!LocationHelper.hasLocationPermission(context)) {
                    pendingNativeGpsPinRequest = true
                    openDialogAfterPermissionGranted = false
                    locationPermissionLauncher.launch(LocationHelper.REQUIRED_PERMISSIONS)
                } else {
                    triggerGpsLocationFetch(openDialogWhenResolved = false)
                }
            },
            onCopyCoordinates = { coordText ->
                copyToClipboard(context, "GPS Coordinates", coordText)
                Toast.makeText(context, "📋 已複製經緯度：$coordText", Toast.LENGTH_SHORT).show()
            },
            onSearchOnly = { lat, lng ->
                showQuickPinDialog = false
                val coordQuery = String.format(Locale.US, "%.6f, %.6f", lat, lng)
                lastEnteredSearchText = coordQuery
                activeSearchQuery = coordQuery
                isDrawerOpen = false
                isAddMarkerMode = false

                webViewRef?.let { wv ->
                    WebViewInjector.searchPlace(wv, coordQuery) { ok ->
                        if (ok) {
                            Toast.makeText(
                                context,
                                "🔍 已定位搜尋目前座標 ($coordQuery)",
                                Toast.LENGTH_SHORT
                            ).show()
                        } else {
                            Toast.makeText(
                                context,
                                "⚠️ 找不到地圖搜尋框 (#mapsprosearch-field)，請確認已進入地圖編輯頁",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                }
            },
            onOneClickAddPin = { lat, lng, title, description ->
                showQuickPinDialog = false
                isDrawerOpen = false
                isAddMarkerMode = false
                activeSearchQuery = null

                val wv = webViewRef
                if (wv != null) {
                    WebViewInjector.addGpsPinToMap(
                        webView = wv,
                        lat = lat,
                        lng = lng,
                        title = title,
                        description = description
                    ) { started ->
                        if (!started) {
                            // 若 JS 腳本因非編輯頁未能啟動，執行 Android 端剪貼簿保底
                            val clipText = LocationHelper.buildClipboardFallbackText(title, description)
                            copyToClipboard(context, "MyGMap GPS Pin", clipText)
                            Toast.makeText(
                                context,
                                "⚠️ 請先進入地圖編輯頁！已為您複製「$clipText」至剪貼簿",
                                Toast.LENGTH_LONG
                            ).show()
                        }
                    }
                }
            },
            onDismiss = {
                showQuickPinDialog = false
            }
        )
    }

    // Phase 4：當定位權限遭拒或系統定位未開啟時的引導與手動座標保底對話框
    if (showLocationGuideDialog) {
        LocationGuideDialog(
            isPermissionDenied = locationPermissionDenied,
            isLocationDisabled = locationServicesDisabled,
            errorMessage = locationErrorMessage,
            onRequestPermissionAgain = {
                showLocationGuideDialog = false
                if (!LocationHelper.hasLocationPermission(context)) {
                    pendingNativeGpsPinRequest = true
                    openDialogAfterPermissionGranted = true
                    locationPermissionLauncher.launch(LocationHelper.REQUIRED_PERMISSIONS)
                } else {
                    triggerGpsLocationFetch(openDialogWhenResolved = true)
                }
            },
            onOpenAppPermissionSettings = {
                showLocationGuideDialog = false
                LocationHelper.openAppPermissionSettings(context)
            },
            onOpenSystemLocationSettings = {
                showLocationGuideDialog = false
                LocationHelper.openSystemLocationSettings(context)
            },
            onManualCoordinateFallback = {
                showLocationGuideDialog = false
                showQuickPinDialog = true
            },
            onDismiss = {
                showLocationGuideDialog = false
            }
        )
    }

    // DOM 探測詳細資訊對話框
    if (showInspectDetailDialog && latestInspectedDom != null) {
        val info = latestInspectedDom!!
        AlertDialog(
            onDismissRequest = { showInspectDetailDialog = false },
            title = {
                Text(
                    text = "🎯 DOM 元素探測詳情",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    InspectDetailRow("推薦 Selector", info.selector.ifBlank { "(無)" })
                    InspectDetailRow("Tag 名稱", "<${info.tagName}>")
                    InspectDetailRow("id", info.id.ifBlank { "(無)" })
                    InspectDetailRow("aria-label", info.ariaLabel.ifBlank { "(無)" })
                    InspectDetailRow("data-tooltip", info.dataTooltip.ifBlank { "(無)" })
                    InspectDetailRow("title", info.title.ifBlank { "(無)" })
                    InspectDetailRow("role", info.role.ifBlank { "(無)" })
                    InspectDetailRow("data-mygmap-role", info.dataMygmapRole.ifBlank { "(無)" })
                    InspectDetailRow("className", info.className.ifBlank { "(無)" })
                    InspectDetailRow("內部文字", info.text.ifBlank { "(無)" })
                    InspectDetailRow("座標與尺寸", info.rectSummary.ifBlank { "(無)" })
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        copyToClipboard(context, "DOM Inspect JSON", info.rawJson)
                        Toast.makeText(context, "已複製完整 JSON 至剪貼簿", Toast.LENGTH_SHORT).show()
                        showInspectDetailDialog = false
                    }
                ) {
                    Text("複製 JSON")
                }
            },
            dismissButton = {
                Row {
                    if (info.selector.isNotBlank()) {
                        TextButton(
                            onClick = {
                                copyToClipboard(context, "DOM Selector", info.selector)
                                Toast.makeText(
                                    context,
                                    "已複製 Selector: ${info.selector}",
                                    Toast.LENGTH_SHORT
                                ).show()
                            }
                        ) {
                            Text("複製 Selector")
                        }
                    }
                    TextButton(onClick = { showInspectDetailDialog = false }) {
                        Text("關閉")
                    }
                }
            }
        )
    }

    // Phase 5：「🗺️ 在 Google Maps App 開啟」導航 / 街景 / 載入雲端地圖與匯出 KML/KMZ 原生對話框
    if (showOpenInGoogleMapsDialog) {
        OpenInGoogleMapsDialog(
            navContext = extractedNavContext,
            fallbackGps = currentGpsCoordinates,
            onLaunchMode = { mode: GoogleMapsLaunchMode, customTargetInput: String ->
                showOpenInGoogleMapsDialog = false
                MapExportAndIntentHelper.launchGoogleMapsApp(
                    context = context,
                    mode = mode,
                    navContext = extractedNavContext,
                    fallbackGps = currentGpsCoordinates,
                    customTargetInput = customTargetInput
                )
            },
            onExportKmz = {
                showOpenInGoogleMapsDialog = false
                triggerDirectKmlExport(exportAsKml = false)
            },
            onExportKml = {
                showOpenInGoogleMapsDialog = false
                triggerDirectKmlExport(exportAsKml = true)
            },
            onDismiss = {
                showOpenInGoogleMapsDialog = false
            }
        )
    }

    // 確認退出對話框
    if (showExitDialog) {
        AlertDialog(
            onDismissRequest = { showExitDialog = false },
            title = { Text(text = stringResource(id = R.string.exit_dialog_title)) },
            text = { Text(text = stringResource(id = R.string.exit_dialog_message)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        showExitDialog = false
                        MyMapWebViewClient.flushCookies()
                        (context as? Activity)?.finish()
                    }
                ) {
                    Text(text = stringResource(id = R.string.confirm))
                }
            },
            dismissButton = {
                TextButton(onClick = { showExitDialog = false }) {
                    Text(text = stringResource(id = R.string.cancel))
                }
            }
        )
    }
}

/**
 * 頂部精簡導航與狀態列：顯示目前標題、頁面模式徽章 (編輯頁/列表頁)、UA 偽裝模式徽章與返回/Google Maps 開啟/首頁/重整按鈕
 */
@Composable
private fun TopStatusHeader(
    title: String,
    currentUrl: String,
    uaMode: MyMapWebViewClient.UserAgentMode,
    isEditorPage: Boolean,
    canGoBack: Boolean,
    onBackClick: () -> Unit,
    onOpenInGoogleMapsClick: () -> Unit,
    onHomeClick: () -> Unit,
    onReloadClick: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color(0xFF1E293B),
        contentColor = Color.White,
        shadowElevation = 4.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (canGoBack) {
                IconButton(
                    onClick = onBackClick,
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "返回上一頁",
                        tint = Color.White
                    )
                }
            } else {
                Spacer(modifier = Modifier.width(8.dp))
            }

            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 4.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(
                        text = title,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )

                    // 顯示 JS Bridge 回報的頁面模式標籤
                    if (uaMode == MyMapWebViewClient.UserAgentMode.DESKTOP_EDITOR) {
                        val pageBadgeText = if (isEditorPage) "🗺️ 地圖編輯頁" else "📋 地圖列表頁"
                        val pageBadgeColor = if (isEditorPage) Color(0xFF15803D) else Color(0xFF475569)
                        Text(
                            text = pageBadgeText,
                            fontSize = 10.sp,
                            color = Color.White,
                            modifier = Modifier
                                .background(pageBadgeColor, RoundedCornerShape(4.dp))
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }

                    // 顯示目前生效的動態 User-Agent 模式標籤
                    val badgeText = when (uaMode) {
                        MyMapWebViewClient.UserAgentMode.AUTH_CLEAN_CHROME -> "🔐 OAuth 登入模式"
                        MyMapWebViewClient.UserAgentMode.DESKTOP_EDITOR -> "🖥️ 桌面核心"
                    }
                    val badgeColor = when (uaMode) {
                        MyMapWebViewClient.UserAgentMode.AUTH_CLEAN_CHROME -> Color(0xFF0F766E)
                        MyMapWebViewClient.UserAgentMode.DESKTOP_EDITOR -> Color(0xFF1D4ED8)
                    }
                    Text(
                        text = badgeText,
                        fontSize = 10.sp,
                        color = Color.White,
                        modifier = Modifier
                            .background(badgeColor, RoundedCornerShape(4.dp))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }

                Text(
                    text = currentUrl,
                    fontSize = 10.sp,
                    color = Color(0xFF94A3B8),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            IconButton(
                onClick = onOpenInGoogleMapsClick,
                modifier = Modifier.size(36.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Map,
                    contentDescription = "在 Google Maps App 開啟",
                    tint = Color(0xFF60A5FA)
                )
            }

            IconButton(
                onClick = onHomeClick,
                modifier = Modifier.size(36.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Home,
                    contentDescription = "回到我的地圖列表",
                    tint = Color.White
                )
            }

            IconButton(
                onClick = onReloadClick,
                modifier = Modifier.size(36.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Refresh,
                    contentDescription = "重新整理",
                    tint = Color.White
                )
            }
        }
    }
}

/**
 * 頂部開發者 DOM 探測除錯橫幅：即時顯示使用者點擊網頁元素的 Selector 與語意屬性
 */
@Composable
private fun DomInspectBanner(
    inspectModeActive: Boolean,
    info: DomInspectInfo?,
    onOpenDetails: () -> Unit,
    onCopySelector: (String) -> Unit,
    onDismiss: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = info != null) { onOpenDetails() },
        color = Color(0xFFFEF2F2),
        contentColor = Color(0xFF7F1D1D)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = if (inspectModeActive) {
                        "🎯 DOM 探測模式開啟中（點擊網頁任意按鈕可攔截並分析，點擊此處查看詳情）"
                    } else {
                        "🎯 最近探測到的 DOM 元素（點擊查看完整屬性）"
                    },
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF991B1B)
                )

                if (info != null) {
                    Text(
                        text = "Selector: ${info.selector.ifBlank { "(無)" }}  •  ${info.toBannerSummary()}",
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color(0xFF7F1D1D),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                } else {
                    Text(
                        text = "尚未點擊任何網頁元素，請直接點選地圖上的工具列或面板按鈕…",
                        fontSize = 11.sp,
                        color = Color(0xFFB91C1C)
                    )
                }
            }

            if (info != null && info.selector.isNotBlank()) {
                IconButton(
                    onClick = { onCopySelector(info.selector) },
                    modifier = Modifier.size(32.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.ContentCopy,
                        contentDescription = "複製 Selector",
                        tint = Color(0xFF991B1B),
                        modifier = Modifier.size(16.dp)
                    )
                }
            }

            IconButton(
                onClick = onDismiss,
                modifier = Modifier.size(32.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "關閉 DOM 探測橫幅",
                    tint = Color(0xFF991B1B),
                    modifier = Modifier.size(16.dp)
                )
            }
        }
    }
}

@Composable
private fun InspectDetailRow(label: String, value: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color(0xFFF8FAFC), RoundedCornerShape(6.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp)
    ) {
        Text(
            text = label,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = Color(0xFF475569)
        )
        Text(
            text = value,
            fontSize = 12.sp,
            fontFamily = FontFamily.Monospace,
            color = Color(0xFF0F172A)
        )
    }
}

private fun copyToClipboard(context: Context, label: String, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
    clipboard?.setPrimaryClip(ClipData.newPlainText(label, text))
}
