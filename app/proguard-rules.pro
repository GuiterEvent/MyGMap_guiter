# Add project specific ProGuard rules here.
# Keep JavascriptInterface methods for WebView bridge
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-keep class com.guiterevent.mygmap.webview.** { *; }

