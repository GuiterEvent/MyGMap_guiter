package com.guiterevent.mygmap.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.EditLocationAlt
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.guiterevent.mygmap.webview.PinEditFormState
import com.guiterevent.mygmap.webview.PinEditableField

/**
 * Phase 15：原生 Material 3「✏️ 編輯地點」對話框 (`EditPinDialog`)
 *
 * 徹底取代會隨鍵盤彈起與焦點切換不斷飄離視窗的網頁原版氣泡窗編輯表單：
 * - 固定置中、支援流暢垂直捲動與手機鍵盤避讓，視覺與 `SelectedPinBottomCard` / `QuickPinDialog` 一致。
 * - 支援編輯「📌 地點名稱（標題）」、「📝 說明 / 備註」及動態自訂圖層屬性欄位。
 * - 提供「🗑️ 刪除地點（附二次確認防誤刪）」與「🌐 改用原網頁編輯（相片/樣式）」逃生門。
 */
@Composable
fun EditPinDialog(
    formState: PinEditFormState,
    coordinatesDisplay: String = "",
    isSaving: Boolean = false,
    onSave: (title: String, description: String, extraFields: List<PinEditableField>) -> Unit,
    onCancel: () -> Unit,
    onDelete: () -> Unit,
    onFallbackToWebEdit: () -> Unit
) {
    var titleInput by remember(formState) { mutableStateOf(formState.title) }
    var descriptionInput by remember(formState) { mutableStateOf(formState.description) }
    val extraFieldValues = remember(formState) {
        mutableStateListOf<String>().apply {
            formState.extraFields.forEach { add(it.value) }
        }
    }
    var showDeleteConfirmDialog by remember { mutableStateOf(false) }

    Dialog(
        onDismissRequest = {
            if (!isSaving) {
                onCancel()
            }
        },
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            dismissOnBackPress = !isSaving,
            dismissOnClickOutside = !isSaving
        )
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 20.dp),
            shape = RoundedCornerShape(20.dp),
            color = Color.White,
            tonalElevation = 6.dp,
            shadowElevation = 14.dp,
            border = BorderStroke(1.dp, Color(0xFFE2E8F0))
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // 頂部標題列：Google 藍重點圖示徽章 + 標題 + 關閉按鈕
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = Color(0xFFE8F0FE),
                        modifier = Modifier.size(38.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = Icons.Default.EditLocationAlt,
                                contentDescription = null,
                                tint = Color(0xFF1A73E8),
                                modifier = Modifier.size(22.dp)
                            )
                        }
                    }

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "✏️ 編輯地點",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF0F172A),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = "修改名稱、備註或自訂圖層欄位",
                            fontSize = 11.sp,
                            color = Color(0xFF64748B),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }

                    IconButton(
                        onClick = {
                            if (!isSaving) onCancel()
                        },
                        enabled = !isSaving,
                        modifier = Modifier.size(34.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "取消編輯",
                            tint = Color(0xFF64748B),
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }

                HorizontalDivider(color = Color(0xFFE2E8F0))

                // 可垂直捲動的表單內容區（避免鍵盤彈起時遮擋輸入框）
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 440.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // 1. 📌 地點名稱（標題）
                    OutlinedTextField(
                        value = titleInput,
                        onValueChange = { titleInput = it },
                        enabled = !isSaving,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("📌 地點名稱（標題）") },
                        placeholder = { Text("輸入地點名稱…") },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp),
                        trailingIcon = {
                            if (titleInput.isNotEmpty() && !isSaving) {
                                IconButton(onClick = { titleInput = "" }) {
                                    Icon(
                                        imageVector = Icons.Default.Close,
                                        contentDescription = "清除標題",
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            }
                        },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next)
                    )

                    // 2. 📝 說明 / 備註
                    OutlinedTextField(
                        value = descriptionInput,
                        onValueChange = { descriptionInput = it },
                        enabled = !isSaving,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("📝 說明 / 備註") },
                        placeholder = { Text("輸入地點筆記、地址、營業時間或旅遊備註…") },
                        minLines = 3,
                        maxLines = 6,
                        shape = RoundedCornerShape(12.dp),
                        trailingIcon = {
                            if (descriptionInput.isNotEmpty() && !isSaving) {
                                IconButton(onClick = { descriptionInput = "" }) {
                                    Icon(
                                        imageVector = Icons.Default.Close,
                                        contentDescription = "清除說明",
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            }
                        }
                    )

                    // 3. 動態自訂屬性欄位區（若該圖層除了名稱與說明外有其他欄位）
                    if (formState.extraFields.isNotEmpty()) {
                        Text(
                            text = "🗂️ 自訂圖層欄位",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color(0xFF475569),
                            modifier = Modifier.padding(top = 2.dp)
                        )
                        formState.extraFields.forEachIndexed { idx, field ->
                            val currentVal = extraFieldValues.getOrElse(idx) { field.value }
                            OutlinedTextField(
                                value = currentVal,
                                onValueChange = { nextVal ->
                                    if (idx < extraFieldValues.size) {
                                        extraFieldValues[idx] = nextVal
                                    }
                                },
                                enabled = !isSaving,
                                modifier = Modifier.fillMaxWidth(),
                                label = { Text(field.label.ifBlank { field.id }) },
                                singleLine = !field.multiline,
                                minLines = if (field.multiline) 2 else 1,
                                maxLines = if (field.multiline) 5 else 1,
                                shape = RoundedCornerShape(12.dp),
                                trailingIcon = {
                                    if (currentVal.isNotEmpty() && !isSaving) {
                                        IconButton(
                                            onClick = {
                                                if (idx < extraFieldValues.size) {
                                                    extraFieldValues[idx] = ""
                                                }
                                            }
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.Close,
                                                contentDescription = "清除欄位",
                                                modifier = Modifier.size(18.dp)
                                            )
                                        }
                                    }
                                }
                            )
                        }
                    }

                    // 4. 唯讀資訊膠囊：目前圖釘座標（若有）+ 雲端同步提示
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        color = Color(0xFFF8FAFC),
                        border = BorderStroke(1.dp, Color(0xFFE2E8F0))
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            if (coordinatesDisplay.isNotBlank()) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Place,
                                        contentDescription = null,
                                        tint = Color(0xFF1A73E8),
                                        modifier = Modifier.size(14.dp)
                                    )
                                    Text(
                                        text = coordinatesDisplay,
                                        fontSize = 11.sp,
                                        fontFamily = FontFamily.Monospace,
                                        fontWeight = FontWeight.Medium,
                                        color = Color(0xFF1E40AF),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.CloudDone,
                                    contentDescription = null,
                                    tint = Color(0xFF0F766E),
                                    modifier = Modifier.size(14.dp)
                                )
                                Text(
                                    text = "儲存後將即時同步至 Google 我的地圖雲端",
                                    fontSize = 11.sp,
                                    color = Color(0xFF475569)
                                )
                            }
                        }
                    }

                    // 5. 輔助動作列：「🗑️ 刪除地點」與「🌐 改用原網頁編輯（相片/樣式）」逃生門
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        if (formState.canDelete) {
                            OutlinedButton(
                                onClick = { showDeleteConfirmDialog = true },
                                enabled = !isSaving,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .defaultMinSize(minHeight = 42.dp),
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, Color(0xFFFCA5A5)),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = Color(0xFFDC2626)
                                )
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Delete,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "🗑️ 刪除地點",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        }

                        TextButton(
                            onClick = onFallbackToWebEdit,
                            enabled = !isSaving,
                            modifier = Modifier.fillMaxWidth(),
                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Language,
                                contentDescription = null,
                                tint = Color(0xFF64748B),
                                modifier = Modifier.size(15.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "🌐 改用原網頁編輯（相片/樣式）",
                                fontSize = 12.sp,
                                color = Color(0xFF64748B)
                            )
                        }
                    }
                }

                HorizontalDivider(color = Color(0xFFE2E8F0))

                // 6. 底部主動作列：「取消」與「💾 儲存」
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedButton(
                        onClick = onCancel,
                        enabled = !isSaving,
                        modifier = Modifier
                            .weight(1f)
                            .defaultMinSize(minHeight = 46.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text(
                            text = "取消",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    Button(
                        onClick = {
                            val updatedExtras = formState.extraFields.mapIndexed { idx, field ->
                                field.copy(value = extraFieldValues.getOrElse(idx) { field.value })
                            }
                            onSave(titleInput.trim(), descriptionInput.trim(), updatedExtras)
                        },
                        enabled = !isSaving,
                        modifier = Modifier
                            .weight(1.3f)
                            .defaultMinSize(minHeight = 46.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF1A73E8),
                            contentColor = Color.White
                        )
                    ) {
                        if (isSaving) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.2.dp,
                                color = Color.White
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "儲存中…",
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Default.Save,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "💾 儲存",
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }
        }
    }

    // 二次確認刪除對話框，防止誤刪地點
    if (showDeleteConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirmDialog = false },
            title = {
                Text(
                    text = "🗑️ 確定要刪除此地點？",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF0F172A)
                )
            },
            text = {
                val targetName = titleInput.trim().ifBlank { "此地點" }
                Text(
                    text = "確定要將「$targetName」從 Google 我的地圖中永久移除嗎？",
                    fontSize = 14.sp,
                    color = Color(0xFF334155)
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showDeleteConfirmDialog = false
                        onDelete()
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFDC2626),
                        contentColor = Color.White
                    ),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text("確定刪除", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirmDialog = false }) {
                    Text("取消")
                }
            }
        )
    }
}

