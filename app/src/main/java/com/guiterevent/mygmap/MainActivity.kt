package com.guiterevent.mygmap

import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.guiterevent.mygmap.ui.MyMapScreen
import com.guiterevent.mygmap.webview.MyMapWebViewClient

private val MyGMapColorScheme = lightColorScheme(
    primary = Color(0xFF1A73E8),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD2E3FC),
    onPrimaryContainer = Color(0xFF041E49),
    secondary = Color(0xFF1E8E3E),
    onSecondary = Color.White,
    background = Color(0xFFF8FAFC),
    surface = Color.White
)

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Phase 8：預設關閉 WebView 遠端除錯模式，僅於使用者在編輯器手動開啟「🎯 DOM 探測除錯模式」時才動態設為 true
        WebView.setWebContentsDebuggingEnabled(false)

        // 預先啟用系統 CookieManager
        CookieManager.getInstance().setAcceptCookie(true)

        setContent {
            MaterialTheme(colorScheme = MyGMapColorScheme) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MyMapScreen()
                }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        // Activity 進入背景時強制將 Cookie 寫入磁碟，確保重開 App 不需重複登入 Google 帳號
        MyMapWebViewClient.flushCookies()
    }

    override fun onStop() {
        super.onStop()
        MyMapWebViewClient.flushCookies()
    }
}

