package com.guiterevent.mygmap.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddLocationAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.EditLocationAlt
import androidx.compose.material.icons.filled.GpsFixed
import androidx.compose.material.icons.filled.LocationOff
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.guiterevent.mygmap.location.GpsCoordinates
import com.guiterevent.mygmap.location.LocationHelper
import com.guiterevent.mygmap.webview.GpsPinStatusInfo

/**
 * Phase 4：「📍 快速新增目前位置」Android 原生對話框 (`QuickPinDialog`)
 *
 * 功能重點：
 * 1. 顯示手機目前取得的 GPS 經緯度座標（例如 `25.033964, 121.564468`），支援「📋 一鍵複製」、「🔄 重新定位」與直接手動微調座標。
 * 2. 提供「📌 地點名稱（標題）」輸入框（留空時自動帶入 `"GPS 標記 (HH:mm)"`）與「📝 備註說明」輸入框。
 * 3. 提供兩個核心動作按鈕：
 *    - **「🔍 僅定位搜尋」**：將 `"lat, lng"` 填入 `#mapsprosearch-field` 並縮放地圖至目前位置。
 *    - **「📍 一鍵加入我的地圖」**：啟動 JS `addGpsPinToMap(lat, lng, title, description)` 自動化狀態機，
 *      依序自動完成「確認圖層 -> 座標搜尋 -> 點擊新增至地圖 -> 自動填入標題與備註並儲存」！
 */
@Composable
fun QuickPinDialog(
    initialCoordinates: GpsCoordinates?,
    isRefreshingLocation: Boolean,
    isEditorPage: Boolean,
    onRefreshLocation: () -> Unit,
    onCopyCoordinates: (String) -> Unit,
    onSearchOnly: (lat: Double, lng: Double) -> Unit,
    onOneClickAddPin: (lat: Double, lng: Double, title: String, description: String) -> Unit,
    onDismiss: () -> Unit
) {
    val defaultTitle = remember { LocationHelper.buildDefaultPinTitle() }

    var coordinateInput by remember(initialCoordinates) {
        mutableStateOf(initialCoordinates?.formatLatLng(6) ?: "25.033964, 121.564468")
    }
    var titleInput by remember { mutableStateOf("") }
    var descriptionInput by remember { mutableStateOf("") }

    // 當外部重新定位成功更新 initialCoordinates 時，同步更新座標輸入框
    LaunchedEffect(initialCoordinates) {
        if (initialCoordinates != null) {
            coordinateInput = initialCoordinates.formatLatLng(6)
        }
    }

    val parsedCoords = remember(coordinateInput) {
        LocationHelper.parseCoordinateString(coordinateInput)
    }
    val isCoordinateValid = parsedCoords != null

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.MyLocation,
                    contentDescription = null,
                    tint = Color(0xFF0F766E),
                    modifier = Modifier.size(24.dp)
                )
                Column {
                    Text(
                        text = "📍 快速標記目前 GPS 位置",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                    if (initialCoordinates != null) {
                        Text(
                            text = "定位來源與精度：${initialCoordinates.formatAccuracySummary()}",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // 若使用者目前還在地圖列表首頁，顯示貼心提醒
                if (!isEditorPage) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = Color(0xFFFEF3C7),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text(
                            text = "💡 提示：請先點選進入任一張「我的地圖」編輯畫面，即可使用自動搜尋與一鍵加入圖層功能。",
                            fontSize = 12.sp,
                            color = Color(0xFF92400E),
                            modifier = Modifier.padding(10.dp)
                        )
                    }
                }

                // 1. 經緯度座標顯示、一鍵複製、重新定位與微調區
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = Color(0xFFF0FDF4),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = "🌐 經緯度座標 (可複製或微調)",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Color(0xFF166534)
                            )

                            Row(verticalAlignment = Alignment.CenterVertically) {
                                TextButton(
                                    onClick = {
                                        if (coordinateInput.isNotBlank()) {
                                            onCopyCoordinates(coordinateInput.trim())
                                        }
                                    },
                                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                                    modifier = Modifier.height(30.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.ContentCopy,
                                        contentDescription = "複製座標",
                                        modifier = Modifier.size(14.dp),
                                        tint = Color(0xFF15803D)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        text = "複製",
                                        fontSize = 11.sp,
                                        color = Color(0xFF15803D),
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }

                                TextButton(
                                    onClick = onRefreshLocation,
                                    enabled = !isRefreshingLocation,
                                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                                    modifier = Modifier.height(30.dp)
                                ) {
                                    if (isRefreshingLocation) {
                                        CircularProgressIndicator(
                                            modifier = Modifier.size(13.dp),
                                            strokeWidth = 2.dp,
                                            color = Color(0xFF0F766E)
                                        )
                                    } else {
                                        Icon(
                                            imageVector = Icons.Default.Refresh,
                                            contentDescription = "重新取得 GPS",
                                            modifier = Modifier.size(14.dp),
                                            tint = Color(0xFF0F766E)
                                        )
                                    }
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        text = if (isRefreshingLocation) "定位中…" else "重抓 GPS",
                                        fontSize = 11.sp,
                                        color = Color(0xFF0F766E),
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }
                            }
                        }

                        OutlinedTextField(
                            value = coordinateInput,
                            onValueChange = { coordinateInput = it },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            isError = !isCoordinateValid,
                            textStyle = TextStyle(
                                fontFamily = FontFamily.Monospace,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold
                            ),
                            placeholder = {
                                Text(
                                    text = "例如：25.033964, 121.564468",
                                    fontSize = 13.sp
                                )
                            },
                            supportingText = if (!isCoordinateValid) {
                                {
                                    Text(
                                        text = "請輸入有效格式「緯度, 經度」（例如 25.033964, 121.564468）",
                                        fontSize = 11.sp,
                                        color = MaterialTheme.colorScheme.error
                                    )
                                }
                            } else {
                                null
                            },
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next)
                        )
                    }
                }

                // 2. 📌 地點名稱（標題）輸入框
                OutlinedTextField(
                    value = titleInput,
                    onValueChange = { titleInput = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("📌 地點名稱（標題）") },
                    placeholder = { Text("留空預設：$defaultTitle") },
                    singleLine = true,
                    trailingIcon = {
                        if (titleInput.isNotEmpty()) {
                            IconButton(onClick = { titleInput = "" }) {
                                Icon(
                                    imageVector = Icons.Default.Close,
                                    contentDescription = "清除標題"
                                )
                            }
                        }
                    },
                    supportingText = {
                        Text(
                            text = "若留空將自動命名為「$defaultTitle」",
                            fontSize = 11.sp
                        )
                    },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next)
                )

                // 3. 📝 備註說明輸入框
                OutlinedTextField(
                    value = descriptionInput,
                    onValueChange = { descriptionInput = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("📝 備註說明（選填）") },
                    placeholder = { Text("輸入現場筆記、地址或打卡資訊…") },
                    minLines = 2,
                    maxLines = 4,
                    trailingIcon = {
                        if (descriptionInput.isNotEmpty()) {
                            IconButton(onClick = { descriptionInput = "" }) {
                                Icon(
                                    imageVector = Icons.Default.Close,
                                    contentDescription = "清除備註"
                                )
                            }
                        }
                    }
                )

                // 4. 動作按鈕區：1.「僅定位搜尋」 2.「一鍵加入我的地圖」
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // 動作按鈕 2 (主動作)：「一鍵加入我的地圖」
                    Button(
                        onClick = {
                            val coords = parsedCoords ?: return@Button
                            val finalTitle = titleInput.trim().ifEmpty { defaultTitle }
                            val finalDesc = descriptionInput.trim()
                            onOneClickAddPin(
                                coords.latitude,
                                coords.longitude,
                                finalTitle,
                                finalDesc
                            )
                        },
                        enabled = isCoordinateValid,
                        modifier = Modifier
                            .fillMaxWidth()
                            .defaultMinSize(minHeight = 50.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF0F766E),
                            contentColor = Color.White
                        ),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.AddLocationAlt,
                            contentDescription = null,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "📍 一鍵加入我的地圖 (自動命名儲存)",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    // 動作按鈕 1 (次動作)：「僅定位搜尋」
                    OutlinedButton(
                        onClick = {
                            val coords = parsedCoords ?: return@OutlinedButton
                            onSearchOnly(coords.latitude, coords.longitude)
                        },
                        enabled = isCoordinateValid,
                        modifier = Modifier
                            .fillMaxWidth()
                            .defaultMinSize(minHeight = 46.dp),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Search,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "🔍 僅定位搜尋 (縮放至目前位置)",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 42.dp)
            ) {
                Text("取消關閉")
            }
        }
    )
}

/**
 * Phase 4：當使用者尚未授予 `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` 權限，
 * 或系統未開啟 GPS 定位服務時的引導對話框。
 */
@Composable
fun LocationGuideDialog(
    isPermissionDenied: Boolean,
    isLocationDisabled: Boolean,
    errorMessage: String?,
    onRequestPermissionAgain: () -> Unit,
    onOpenAppPermissionSettings: () -> Unit,
    onOpenSystemLocationSettings: () -> Unit,
    onManualCoordinateFallback: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.LocationOff,
                    contentDescription = null,
                    tint = Color(0xFFD97706),
                    modifier = Modifier.size(24.dp)
                )
                Text(
                    text = when {
                        isPermissionDenied -> "需要定位權限以取得目前位置"
                        isLocationDisabled -> "尚未開啟系統 GPS 定位服務"
                        else -> "無法取得目前 GPS 座標"
                    },
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = when {
                        isPermissionDenied ->
                            "「📍 標記目前位置」需要存取手機的高精準度 GPS 座標，才能自動將您所在的經緯度加入 Google 我的地圖。\n\n請點擊下方按鈕授予「精確位置」權限，或前往系統設定開啟。"
                        isLocationDisabled ->
                            "偵測到手機系統的「位置資訊 (GPS)」目前為關閉狀態。請先開啟系統定位服務，再重新執行打卡標記。"
                        else ->
                            errorMessage ?: "目前環境訊號較弱或暫時無法取得衛星定位，請重試或直接手動輸入經緯度座標。"
                    },
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // 提供手動微調/輸入座標的保底入口
                OutlinedButton(
                    onClick = onManualCoordinateFallback,
                    modifier = Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 46.dp),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.EditLocationAlt,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "✏️ 直接手動輸入/貼上經緯度標記",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        },
        confirmButton = {
            when {
                isPermissionDenied -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        OutlinedButton(onClick = onOpenAppPermissionSettings) {
                            Icon(
                                imageVector = Icons.Default.Settings,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("權限設定")
                        }
                        Button(onClick = onRequestPermissionAgain) {
                            Text("重新授權")
                        }
                    }
                }
                isLocationDisabled -> {
                    Button(onClick = onOpenSystemLocationSettings) {
                        Icon(
                            imageVector = Icons.Default.GpsFixed,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("開啟系統定位")
                    }
                }
                else -> {
                    Button(onClick = onRequestPermissionAgain) {
                        Text("重新定位")
                    }
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("關閉")
            }
        }
    )
}

/**
 * Phase 4：顯示 JS 自動化打卡狀態機 (`addGpsPinToMap`) 的即時進度橫幅
 */
@Composable
fun GpsPinAutomationBanner(
    status: GpsPinStatusInfo,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    val bgColor = when {
        status.isCompleted && !status.fallbackUsed -> Color(0xFFDCFCE7)
        status.isCompleted && status.fallbackUsed -> Color(0xFFFEF3C7)
        status.isError -> Color(0xFFFEE2E2)
        else -> Color(0xFFE0F2FE)
    }
    val textColor = when {
        status.isCompleted && !status.fallbackUsed -> Color(0xFF14532D)
        status.isCompleted && status.fallbackUsed -> Color(0xFF78350F)
        status.isError -> Color(0xFF7F1D1D)
        else -> Color(0xFF0C4A6E)
    }

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = bgColor,
        contentColor = textColor,
        shadowElevation = 4.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (!status.isCompleted && !status.isError) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    strokeWidth = 2.2.dp,
                    color = Color(0xFF0284C7)
                )
                Spacer(modifier = Modifier.width(10.dp))
            }

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = status.message,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = textColor,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                if (status.subMessage.isNotBlank()) {
                    Text(
                        text = status.subMessage,
                        fontSize = 11.sp,
                        color = textColor.copy(alpha = 0.85f),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }

            IconButton(
                onClick = onDismiss,
                modifier = Modifier.size(30.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "關閉打卡狀態橫幅",
                    tint = textColor,
                    modifier = Modifier.size(16.dp)
                )
            }
        }
    }
}

