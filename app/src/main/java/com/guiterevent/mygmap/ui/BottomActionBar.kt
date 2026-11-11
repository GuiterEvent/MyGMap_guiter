package com.guiterevent.mygmap.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AddLocationAlt
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DesktopWindows
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Navigation
import androidx.compose.material.icons.filled.PanTool
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Streetview
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.guiterevent.mygmap.BuildConfig
import com.guiterevent.mygmap.location.GpsCoordinates
import com.guiterevent.mygmap.webview.GoogleMapsLaunchMode
import com.guiterevent.mygmap.webview.MapNavigationContext

/**
 * Phase 3：單手操作友善的 Material 3 原生底部工具列 (`BottomActionBar`)
 *
 * 所有按鈕觸控熱區皆確保至少 `48dp x 48dp` 以上，包含五個核心動作：
 * 1. 🗂️ 圖層 (`Layers`)：呼叫 `window.MyGMapHelper.toggleLayerDrawer()` 展開或收合左側圖層抽屜，並同步顯示高亮狀態。
 * 2. 🔍 搜尋 (`Search`)：彈出 Android 原生快速搜尋對話框，自動填入 `#mapsprosearch-field` 並提供一鍵「➕ 加入地圖」。
 * 3. 📌 插針 (`Add Marker`)：呼叫 `window.MyGMapHelper.activateAddMarkerTool()` 啟動插針模式，並顯示頂部引導橫幅。
 * 4. 🏠 列表 (`Home`)：快速返回 `https://www.google.com/maps/d/` 地圖總覽頁。
 * 5. ⚙️ 模式 (`More / Mode`)：展開選單，支援切換「📱 手機優化排版 / 🖥️ 原始桌面排版」、開關「🔍 DOM 探測除錯模式」、觸發「↩️ 復原 (Undo)」與「↪️ 重做 (Redo)」。
 */
@Composable
fun BottomActionBar(
    isEditorPage: Boolean,
    isDrawerOpen: Boolean,
    isSearchPanelActive: Boolean,
    isAddMarkerMode: Boolean,
    isMobileMode: Boolean,
    isInspectMode: Boolean,
    onToggleLayerDrawer: () -> Unit,
    onOpenSearch: () -> Unit,
    onToggleAddMarker: () -> Unit,
    onActivatePanTool: () -> Unit,
    onNavigateHome: () -> Unit,
    onToggleMobileCssMode: () -> Unit,
    onToggleInspectMode: () -> Unit,
    onUndo: () -> Unit,
    onRedo: () -> Unit,
    onOpenInGoogleMaps: () -> Unit = {},
    onExportKmlKmz: () -> Unit = {},
    onResetGoogleLogin: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    var showModeMenu by remember { mutableStateOf(false) }

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = Color(0xFF0F172A),
        contentColor = Color.White,
        tonalElevation = 8.dp,
        shadowElevation = 10.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 6.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            // 1. 🗂️ 圖層 (Layers)
            BottomActionButton(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.Layers,
                label = if (isDrawerOpen) "🗂️ 收合" else "🗂️ 圖層",
                isSelected = isDrawerOpen,
                selectedColor = Color(0xFF2563EB),
                onClick = onToggleLayerDrawer
            )

            // 2. 🔍 搜尋 (Search)
            BottomActionButton(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.Search,
                label = "🔍 搜尋",
                isSelected = isSearchPanelActive,
                selectedColor = Color(0xFF0284C7),
                onClick = onOpenSearch
            )

            // 3. 📌 插針 (Add Marker)
            BottomActionButton(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.AddLocationAlt,
                label = if (isAddMarkerMode) "📌 插針中" else "📌 插針",
                isSelected = isAddMarkerMode,
                selectedColor = Color(0xFFD97706),
                onClick = onToggleAddMarker
            )

            // 4. 🏠 列表 (Home)
            BottomActionButton(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.Home,
                label = "🏠 列表",
                isSelected = !isEditorPage,
                selectedColor = Color(0xFF334155),
                onClick = onNavigateHome
            )

            // 5. ⚙️ 模式 (More / Mode) + DropdownMenu
            Box(modifier = Modifier.weight(1f)) {
                BottomActionButton(
                    modifier = Modifier.fillMaxWidth(),
                    icon = Icons.Default.Settings,
                    label = "⚙️ 模式",
                    isSelected = showModeMenu || isInspectMode || !isMobileMode,
                    selectedColor = if (isInspectMode) Color(0xFFB91C1C) else Color(0xFF0F766E),
                    onClick = { showModeMenu = true }
                )

                DropdownMenu(
                    expanded = showModeMenu,
                    onDismissRequest = { showModeMenu = false }
                ) {
                    // 選單項目 1：切換手機優化排版 / 原始桌面排版
                    DropdownMenuItem(
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        leadingIcon = {
                            Icon(
                                imageVector = if (isMobileMode) Icons.Default.PhoneAndroid else Icons.Default.DesktopWindows,
                                contentDescription = null,
                                tint = if (isMobileMode) Color(0xFF0F766E) else Color(0xFF475569)
                            )
                        },
                        text = {
                            Column {
                                Text(
                                    text = if (isMobileMode) {
                                        "📱 目前：手機優化排版"
                                    } else {
                                        "🖥️ 目前：原始桌面排版"
                                    },
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 14.sp
                                )
                                Text(
                                    text = if (isMobileMode) {
                                        "點擊切換回原始桌面排版 (CSS 逃生門)"
                                    } else {
                                        "點擊啟用行動版抽屜與大按鈕優化"
                                    },
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        },
                        onClick = {
                            showModeMenu = false
                            onToggleMobileCssMode()
                        }
                    )

                    // 選單項目 2：開關 DOM 探測除錯模式
                    DropdownMenuItem(
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.BugReport,
                                contentDescription = null,
                                tint = if (isInspectMode) Color(0xFFDC2626) else Color(0xFF475569)
                            )
                        },
                        text = {
                            Column {
                                Text(
                                    text = if (isInspectMode) {
                                        "🔍 關閉 DOM 探測除錯模式"
                                    } else {
                                        "🔍 開啟 DOM 探測除錯模式"
                                    },
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 14.sp,
                                    color = if (isInspectMode) Color(0xFFDC2626) else Color.Unspecified
                                )
                                Text(
                                    text = "點擊網頁元素可檢視並複製 CSS Selector",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        },
                        onClick = {
                            showModeMenu = false
                            onToggleInspectMode()
                        }
                    )

                    HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

                    // 選單項目 3：觸發網頁「↩️ 復原 (Undo)」
                    DropdownMenuItem(
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.Undo,
                                contentDescription = null
                            )
                        },
                        text = {
                            Text(
                                text = "↩️ 復原上一步 (Undo)",
                                fontSize = 14.sp
                            )
                        },
                        onClick = {
                            showModeMenu = false
                            onUndo()
                        }
                    )

                    // 選單項目 4：觸發網頁「↪️ 重做 (Redo)」
                    DropdownMenuItem(
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.Redo,
                                contentDescription = null
                            )
                        },
                        text = {
                            Text(
                                text = "↪️ 重做下一步 (Redo)",
                                fontSize = 14.sp
                            )
                        },
                        onClick = {
                            showModeMenu = false
                            onRedo()
                        }
                    )

                    HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

                    // 選單項目 5：切換回手型選取/平移模式
                    DropdownMenuItem(
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.PanTool,
                                contentDescription = null
                            )
                        },
                        text = {
                            Text(
                                text = "🖐️ 手型選取 / 平移模式",
                                fontSize = 14.sp
                            )
                        },
                        onClick = {
                            showModeMenu = false
                            onActivatePanTool()
                        }
                    )

                    HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

                    // 選單項目 6 (Phase 5)：「🗺️ 在 Google Maps App 開啟」導航 / 查看街景 / 雲端地圖
                    DropdownMenuItem(
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.Map,
                                contentDescription = null,
                                tint = Color(0xFF1A73E8)
                            )
                        },
                        text = {
                            Column {
                                Text(
                                    text = "🗺️ 在 Google Maps App 開啟",
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 14.sp,
                                    color = Color(0xFF1A73E8)
                                )
                                Text(
                                    text = "提取 mid 或選取座標，一鍵導航 / 查看街景",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        },
                        onClick = {
                            showModeMenu = false
                            onOpenInGoogleMaps()
                        }
                    )

                    // 選單項目 7 (Phase 5)：「📥 匯出地圖為 KML / KMZ」快捷下載
                    DropdownMenuItem(
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.Download,
                                contentDescription = null,
                                tint = Color(0xFF0F766E)
                            )
                        },
                        text = {
                            Column {
                                Text(
                                    text = "📥 匯出為 KML / KMZ 檔案",
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 14.sp
                                )
                                Text(
                                    text = "下載目前地圖圖資至手機 Downloads 資料夾",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        },
                        onClick = {
                            showModeMenu = false
                            onExportKmlKmz()
                        }
                    )

                    HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

                    // 選單項目 8 (Phase 9)：「🔄 清除登入快取並重試」— 頂部橫幅僅在登入遭拒時顯示，此處提供隨時可用的手動入口
                    DropdownMenuItem(
                        modifier = Modifier.defaultMinSize(minHeight = 48.dp),
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = null,
                                tint = Color(0xFFB45309)
                            )
                        },
                        text = {
                            Column {
                                Text(
                                    text = "🔄 清除登入快取並重試",
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 14.sp,
                                    color = Color(0xFFB45309)
                                )
                                Text(
                                    text = "清除 Google 登入 Cookie、切換相容模式並重新開啟登入頁",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        },
                        onClick = {
                            showModeMenu = false
                            onResetGoogleLogin()
                        }
                    )

                    HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

                    Text(
                        text = "版本：v${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)
                    )
                }
            }
        }
    }
}

/**
 * 單一底部工具列按鈕元件：確保觸控熱區至少為 `48dp x 52dp`
 */
@Composable
private fun BottomActionButton(
    icon: ImageVector,
    label: String,
    isSelected: Boolean,
    selectedColor: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val containerColor = if (isSelected) selectedColor else Color.Transparent
    val contentColor = if (isSelected) Color.White else Color(0xFFCBD5E1)

    Column(
        modifier = modifier
            .padding(horizontal = 2.dp)
            .defaultMinSize(minWidth = 48.dp, minHeight = 52.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(containerColor)
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = contentColor,
            modifier = Modifier.size(22.dp)
        )
        Spacer(modifier = Modifier.height(3.dp))
        Text(
            text = label,
            color = contentColor,
            fontSize = 11.sp,
            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/**
 * Phase 3：「📌 插針模式」頂部醒目提示橫幅
 * 顯示「📌 插針模式已啟動：請點擊地圖任意位置放置圖釘」，並提供一鍵切換回「🖐️ 手型選取/平移模式 (`activatePanTool()`)」的快捷按鈕。
 */
@Composable
fun AddMarkerModeBanner(
    onSwitchToPanMode: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = Color(0xFFFEF3C7),
        contentColor = Color(0xFF78350F),
        shadowElevation = 4.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "📌 插針模式已啟動：請點擊地圖任意位置放置圖釘",
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF92400E),
                modifier = Modifier
                    .weight(1f)
                    .padding(end = 8.dp)
            )

            Button(
                onClick = onSwitchToPanMode,
                modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 40.dp),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFFD97706),
                    contentColor = Color.White
                ),
                shape = RoundedCornerShape(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.PanTool,
                    contentDescription = null,
                    modifier = Modifier.size(15.dp)
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = "🖐️ 手型選取/平移",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }
    }
}

/**
 * Phase 3：搜尋後浮動於底部工具列上方的「➕ 加入地圖 (`clickAddToMap()`)」快捷面板
 */
@Composable
fun SearchAddToMapFloatingBar(
    searchQuery: String,
    onClickAddToMap: () -> Unit,
    onReopenSearch: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 10.dp),
        shape = RoundedCornerShape(14.dp),
        color = Color(0xFF1E293B),
        contentColor = Color.White,
        shadowElevation = 8.dp,
        tonalElevation = 6.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clickable { onReopenSearch() }
                    .padding(end = 8.dp)
            ) {
                Text(
                    text = "🔍 搜尋：「$searchQuery」",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "點選地圖上的綠釘後，可一鍵加入當前圖層",
                    fontSize = 11.sp,
                    color = Color(0xFF94A3B8),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Button(
                onClick = onClickAddToMap,
                modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF1A73E8),
                    contentColor = Color.White
                ),
                shape = RoundedCornerShape(10.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Add,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = "➕ 加入地圖",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            Spacer(modifier = Modifier.width(4.dp))

            IconButton(
                onClick = onDismiss,
                modifier = Modifier.size(48.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "關閉搜尋快捷列",
                    tint = Color(0xFFCBD5E1)
                )
            }
        }
    }
}

/**
 * Phase 3：Android 原生快速搜尋地點對話框 (`QuickSearchDialog`)
 * 讓使用者透過手機原生鍵盤流暢輸入地點名稱或座標，一鍵填入 `#mapsprosearch-field` 並觸發搜尋。
 */
@Composable
fun QuickSearchDialog(
    initialQuery: String,
    onDismiss: () -> Unit,
    onConfirmSearch: (String) -> Unit,
    onQuickAddToMap: () -> Unit
) {
    var queryText by remember(initialQuery) { mutableStateOf(initialQuery) }
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        try {
            focusRequester.requestFocus()
        } catch (_: Throwable) {
            // ignore focus request race
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = "🔍 快速搜尋地點",
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = "輸入地點名稱、地址或經緯度座標，將自動填入地圖搜尋框並執行搜尋：",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                OutlinedTextField(
                    value = queryText,
                    onValueChange = { queryText = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(focusRequester),
                    placeholder = { Text("例如：台北 101、東京鐵塔、25.0339, 121.5644") },
                    singleLine = true,
                    trailingIcon = {
                        if (queryText.isNotEmpty()) {
                            IconButton(onClick = { queryText = "" }) {
                                Icon(
                                    imageVector = Icons.Default.Close,
                                    contentDescription = "清除輸入"
                                )
                            }
                        }
                    },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(
                        onSearch = {
                            val trimmed = queryText.trim()
                            if (trimmed.isNotEmpty()) {
                                onConfirmSearch(trimmed)
                            }
                        }
                    )
                )

                OutlinedButton(
                    onClick = onQuickAddToMap,
                    modifier = Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 48.dp),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text(
                        text = "➕ 直接將目前搜尋結果加入地圖",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val trimmed = queryText.trim()
                    if (trimmed.isNotEmpty()) {
                        onConfirmSearch(trimmed)
                    }
                },
                enabled = queryText.trim().isNotEmpty(),
                modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)
            ) {
                Text("🔍 搜尋地點")
            }
        },
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)
            ) {
                Text("取消")
            }
        }
    )
}

/**
 * Phase 5：「🗺️ 在 Google Maps App 開啟」導航 / 查看街景 / 載入雲端地圖原生對話框 (`OpenInGoogleMapsDialog`)
 *
 * 支援自動從目前網址提取 `mid`（地圖 ID）與從網頁目前選取的圖釘氣泡窗 / 搜尋框提取座標，
 * 透過 Android `Intent(Intent.ACTION_VIEW, Uri.parse(...))` 直接喚起手機內的官方 Google Maps App
 * (`com.google.android.apps.maps`) 進行路線導航、查看街景或檢視地圖；若未安裝則自動以外部瀏覽器開啟。
 */
@Composable
fun OpenInGoogleMapsDialog(
    navContext: MapNavigationContext,
    fallbackGps: GpsCoordinates?,
    onLaunchMode: (mode: GoogleMapsLaunchMode, customTargetInput: String) -> Unit,
    onExportKmz: () -> Unit,
    onExportKml: () -> Unit,
    onDismiss: () -> Unit
) {
    val bestCoords = remember(navContext, fallbackGps) {
        navContext.resolveBestCoordinates(fallbackGps)
    }
    val bestQuery = remember(navContext) {
        navContext.resolveBestQueryOrTitle()
    }
    val initialTargetText = remember(bestCoords, bestQuery) {
        when {
            bestCoords != null -> bestCoords.formatLatLng(6)
            bestQuery.isNotBlank() -> bestQuery
            else -> ""
        }
    }

    var targetInput by remember(initialTargetText) { mutableStateOf(initialTargetText) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Map,
                    contentDescription = null,
                    tint = Color(0xFF1A73E8),
                    modifier = Modifier.size(24.dp)
                )
                Column {
                    Text(
                        text = "🗺️ 在 Google Maps App 開啟",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "喚起官方 Google Maps 進行導航、查看街景或檢視圖資",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // 1. 顯示目前已自動提取到的地圖 mid 與選取圖釘/座標摘要
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = Color(0xFFF1F5F9),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            text = "🔎 自動提取的目前地圖資訊：",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF1E293B)
                        )
                        Text(
                            text = if (navContext.mid.isNotBlank()) {
                                "• 地圖 ID (mid)：${navContext.mid}"
                            } else {
                                "• 地圖 ID (mid)：尚未進入特定地圖 (位於列表頁)"
                            },
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            color = Color(0xFF334155),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (navContext.selectedPinTitle.isNotBlank()) {
                            Text(
                                text = "• 選取圖釘：「${navContext.selectedPinTitle}」",
                                fontSize = 11.sp,
                                color = Color(0xFF0F766E),
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                        if (bestCoords != null) {
                            Text(
                                text = "• 偵測座標：${bestCoords.formatLatLng(6)} (${bestCoords.provider})",
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace,
                                color = Color(0xFF15803D)
                            )
                        }
                    }
                }

                // 2. 目標座標或地點名稱輸入框（預填自動提取結果，亦可手動修改）
                OutlinedTextField(
                    value = targetInput,
                    onValueChange = { targetInput = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("📍 導航 / 街景目標座標或地點") },
                    placeholder = { Text("例如：25.033964, 121.564468 或 台北 101") },
                    singleLine = true,
                    trailingIcon = {
                        if (targetInput.isNotEmpty()) {
                            IconButton(onClick = { targetInput = "" }) {
                                Icon(
                                    imageVector = Icons.Default.Close,
                                    contentDescription = "清除目標"
                                )
                            }
                        }
                    }
                )

                // 3. 核心跳轉動作按鈕群
                // 3.1 路線導航 (Navigation)
                Button(
                    onClick = {
                        onLaunchMode(GoogleMapsLaunchMode.NAVIGATION, targetInput)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 48.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF1A73E8),
                        contentColor = Color.White
                    ),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Navigation,
                        contentDescription = null,
                        modifier = Modifier.size(19.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "🧭 Google Maps 路線導航",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold
                    )
                }

                // 3.2 查看 360° 街景 (Street View)
                Button(
                    onClick = {
                        onLaunchMode(GoogleMapsLaunchMode.STREET_VIEW, targetInput)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 48.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF0F766E),
                        contentColor = Color.White
                    ),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Streetview,
                        contentDescription = null,
                        modifier = Modifier.size(19.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "🏙️ Google Maps 查看 360° 街景",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold
                    )
                }

                // 3.3 在 Google Maps 檢視此座標圖釘 / 地點
                OutlinedButton(
                    onClick = {
                        onLaunchMode(GoogleMapsLaunchMode.PLACE_PIN, targetInput)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 46.dp),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Place,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "📍 在 Google Maps 標示此座標 / 地點",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }

                // 3.4 若網址含有 mid，支援直接在 Google Maps App 開啟整張「我的地圖」與一鍵匯出 KML/KMZ
                if (navContext.mid.isNotBlank()) {
                    OutlinedButton(
                        onClick = {
                            onLaunchMode(GoogleMapsLaunchMode.MAP_VIEWER_BY_MID, targetInput)
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .defaultMinSize(minHeight = 46.dp),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Map,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "🗺️ 在 Google Maps 載入整張地圖 (mid)",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    HorizontalDivider(modifier = Modifier.padding(vertical = 2.dp))

                    Text(
                        text = "📥 快速匯出此地圖圖資 (儲存至系統 Downloads)：",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(
                            onClick = onExportKmz,
                            modifier = Modifier
                                .weight(1f)
                                .defaultMinSize(minHeight = 44.dp),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Download,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("匯出 .KMZ", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }

                        OutlinedButton(
                            onClick = onExportKml,
                            modifier = Modifier
                                .weight(1f)
                                .defaultMinSize(minHeight = 44.dp),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Download,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("匯出 .KML", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onLaunchMode(GoogleMapsLaunchMode.SMART_OPEN, targetInput)
                },
                modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 44.dp)
            ) {
                Text("🗺️ 智慧開啟")
            }
        },
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 44.dp)
            ) {
                Text("關閉")
            }
        }
    )
}


