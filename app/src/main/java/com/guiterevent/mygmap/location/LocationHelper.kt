package com.guiterevent.mygmap.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 封裝手機取得的即時 GPS 經緯度座標資訊。
 */
data class GpsCoordinates(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float? = null,
    val provider: String = "FusedLocation",
    val timestampMillis: Long = System.currentTimeMillis()
) {
    /**
     * 格式化為 Google My Maps 搜尋框可直接識別的 `"lat, lng"` 字串（預設小數點後 6 位，約 0.11 公尺精度）。
     */
    fun formatLatLng(decimals: Int = 6): String {
        return String.format(Locale.US, "%.${decimals}f, %.${decimals}f", latitude, longitude)
    }

    /**
     * 產生精準度與來源摘要標籤（例如 `"±6m • GPS"`）。
     */
    fun formatAccuracySummary(): String {
        val accPart = if (accuracyMeters != null && accuracyMeters > 0f) {
            "±${accuracyMeters.toInt()}m"
        } else {
            null
        }
        return when {
            accPart != null && provider.isNotBlank() -> "$accPart • $provider"
            accPart != null -> accPart
            provider.isNotBlank() -> provider
            else -> "GPS"
        }
    }
}

/**
 * 定位請求結果封裝。
 */
sealed class LocationFetchResult {
    data class Success(val coordinates: GpsCoordinates) : LocationFetchResult()
    data object PermissionDenied : LocationFetchResult()
    data object LocationServicesDisabled : LocationFetchResult()
    data class Error(val message: String) : LocationFetchResult()
}

/**
 * Phase 4：Android 原生高精準度定位輔助模組 (`LocationHelper`)
 *
 * 核心設計：
 * 1. 整合 `ACCESS_FINE_LOCATION` 與 `ACCESS_COARSE_LOCATION` 權限檢查與系統定位服務開關狀態檢查。
 * 2. 優先使用 Google Play Services `FusedLocationProviderClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, ...)`
 *    取得高精準度即時座標。
 * 3. 內建原生 `LocationManager` (`GPS_PROVIDER` / `NETWORK_PROVIDER` 即時監聽 + `lastKnownLocation`) 雙重備援，
 *    確保在室內、地下室或 GMS 延遲時依然能快速取得最佳經緯度 `(latitude, longitude)`。
 */
object LocationHelper {
    private const val TAG = "LocationHelper"

    /**
     * 供 `ActivityResultContracts.RequestMultiplePermissions` 使用的定位權限陣列
     */
    val REQUIRED_PERMISSIONS: Array<String> = arrayOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION
    )

    private val mainHandler: Handler by lazy { Handler(Looper.getMainLooper()) }

    /**
     * 檢查是否已授予任一定位權限 (`ACCESS_FINE_LOCATION` 或 `ACCESS_COARSE_LOCATION`)
     */
    fun hasLocationPermission(context: Context): Boolean {
        val fineGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val coarseGranted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        return fineGranted || coarseGranted
    }

    /**
     * 檢查是否已授予高精準度定位權限 (`ACCESS_FINE_LOCATION`)
     */
    fun hasFineLocationPermission(context: Context): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * 檢查系統定位服務 (GPS / 網路定位) 是否已開啟
     */
    fun isLocationEnabled(context: Context): Boolean {
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            ?: return false
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                locationManager.isLocationEnabled
            } else {
                locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                    locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
            }
        } catch (e: Exception) {
            Log.w(TAG, "isLocationEnabled check failed: ${e.message}")
            true
        }
    }

    /**
     * 驗證經緯度數值是否合法（排除 NaN、超出範圍與 `(0.0, 0.0)` 無效座標）
     */
    fun isValidLatLng(lat: Double, lng: Double): Boolean {
        if (lat.isNaN() || lng.isNaN() || lat.isInfinite() || lng.isInfinite()) return false
        if (lat < -90.0 || lat > 90.0 || lng < -180.0 || lng > 180.0) return false
        if (lat == 0.0 && lng == 0.0) return false
        return true
    }

    /**
     * 解析使用者在 `QuickPinDialog` 輸入或微調的 `"lat, lng"` 字串。
     * 支援逗號或空白分隔，例如 `"25.033964, 121.564468"`。
     */
    fun parseCoordinateString(rawText: String): GpsCoordinates? {
        val cleaned = rawText.trim()
        if (cleaned.isEmpty()) return null

        val parts = if (cleaned.contains(",")) {
            cleaned.split(",")
        } else {
            cleaned.split(Regex("\\s+"))
        }
        if (parts.size != 2) return null

        val lat = parts[0].trim().toDoubleOrNull() ?: return null
        val lng = parts[1].trim().toDoubleOrNull() ?: return null
        if (!isValidLatLng(lat, lng)) return null

        return GpsCoordinates(
            latitude = lat,
            longitude = lng,
            accuracyMeters = null,
            provider = "Manual/Adjusted"
        )
    }

    /**
     * 產生預設地點名稱：`"GPS 標記 (HH:mm)"`
     */
    fun buildDefaultPinTitle(now: Date = Date()): String {
        val formatter = SimpleDateFormat("HH:mm", Locale.getDefault())
        return "GPS 標記 (${formatter.format(now)})"
    }

    /**
     * 產生容錯保底剪貼簿字串：若備註非空則為 `"標題 - 備註"`，否則為 `"標題"`
     */
    fun buildClipboardFallbackText(title: String, description: String): String {
        val cleanTitle = title.trim().ifEmpty { buildDefaultPinTitle() }
        val cleanDesc = description.trim()
        return if (cleanDesc.isNotEmpty()) {
            "$cleanTitle - $cleanDesc"
        } else {
            cleanTitle
        }
    }

    /**
     * 引導使用者前往系統定位設定頁開啟 GPS
     */
    fun openSystemLocationSettings(context: Context) {
        try {
            val intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open location settings: ${e.message}")
        }
    }

    /**
     * 引導使用者前往本 App 的系統應用程式權限設定頁
     */
    fun openAppPermissionSettings(context: Context) {
        try {
            val intent = Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", context.packageName, null)
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open app permission settings: ${e.message}")
        }
    }

    /**
     * 取得手機目前高精準度 GPS 座標。
     *
     * 流程：
     * 1. 檢查權限與系統定位開關。
     * 2. 同時啟動 `FusedLocationProviderClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, ...)`
     *    與原生 `LocationManager` 備援監聽，誰先回傳有效的高精準度座標即採用。
     * 3. 若在 `timeoutMs` (預設 9 秒) 內未收到即時更新，則自動回退採用最佳 `lastLocation` / `lastKnownLocation` 快取座標。
     */
    @SuppressLint("MissingPermission")
    fun fetchCurrentLocation(
        context: Context,
        timeoutMs: Long = 9_000L,
        onResult: (LocationFetchResult) -> Unit
    ) {
        val appContext = context.applicationContext
        if (!hasLocationPermission(appContext)) {
            mainHandler.post { onResult(LocationFetchResult.PermissionDenied) }
            return
        }

        if (!isLocationEnabled(appContext)) {
            mainHandler.post { onResult(LocationFetchResult.LocationServicesDisabled) }
            return
        }

        val completed = AtomicBoolean(false)
        val cancellationTokenSource = CancellationTokenSource()
        val locationManager = appContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        var fallbackListener: LocationListener? = null
        var bestCandidateLocation: Location? = getBestLastKnownLocation(locationManager)

        fun cleanupAndDeliver(result: LocationFetchResult) {
            if (!completed.compareAndSet(false, true)) return
            try {
                cancellationTokenSource.cancel()
            } catch (_: Throwable) {
            }
            try {
                if (fallbackListener != null && locationManager != null) {
                    locationManager.removeUpdates(fallbackListener!!)
                }
            } catch (_: Throwable) {
            }
            mainHandler.post {
                onResult(result)
            }
        }

        // 1. 註冊原生 LocationManager 即時監聽作為平行備援（解決部分裝置 GMS 在室內延遲問題）
        if (locationManager != null) {
            val listener = object : LocationListener {
                override fun onLocationChanged(location: Location) {
                    if (isValidLatLng(location.latitude, location.longitude)) {
                        bestCandidateLocation = pickBetterLocation(location, bestCandidateLocation)
                        // 若原生定位精度極佳 (<= 35m) 或來自 GPS，直接完成回報
                        if (!location.hasAccuracy() || location.accuracy <= 35f || location.provider == LocationManager.GPS_PROVIDER) {
                            Log.i(TAG, "Resolved location via native LocationManager (${location.provider})")
                            cleanupAndDeliver(
                                LocationFetchResult.Success(location.toGpsCoordinates("LocationManager:${location.provider ?: "GPS"}"))
                            )
                        }
                    }
                }

                @Deprecated("Deprecated in Android API")
                override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
                override fun onProviderEnabled(provider: String) = Unit
                override fun onProviderDisabled(provider: String) = Unit
            }
            fallbackListener = listener

            try {
                val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
                for (provider in providers) {
                    if (locationManager.isProviderEnabled(provider)) {
                        locationManager.requestLocationUpdates(
                            provider,
                            500L,
                            0f,
                            listener,
                            Looper.getMainLooper()
                        )
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Native LocationManager requestLocationUpdates warning: ${e.message}")
            }
        }

        // 2. 呼叫 Google Play Services FusedLocationProviderClient.getCurrentLocation
        try {
            val fusedClient = LocationServices.getFusedLocationProviderClient(appContext)
            val priority = if (hasFineLocationPermission(appContext)) {
                Priority.PRIORITY_HIGH_ACCURACY
            } else {
                Priority.PRIORITY_BALANCED_POWER_ACCURACY
            }

            // 先非同步讀取 fusedClient.lastLocation 作為備用快取候選
            fusedClient.lastLocation.addOnSuccessListener { lastLoc ->
                if (lastLoc != null && isValidLatLng(lastLoc.latitude, lastLoc.longitude)) {
                    bestCandidateLocation = pickBetterLocation(lastLoc, bestCandidateLocation)
                }
            }

            fusedClient.getCurrentLocation(priority, cancellationTokenSource.token)
                .addOnSuccessListener { location ->
                    if (location != null && isValidLatLng(location.latitude, location.longitude)) {
                        Log.i(TAG, "Resolved location via FusedLocationProviderClient: ${location.latitude}, ${location.longitude}")
                        cleanupAndDeliver(
                            LocationFetchResult.Success(location.toGpsCoordinates("FusedLocation"))
                        )
                    } else {
                        // Fused getCurrentLocation 回傳 null，檢查是否已有可用的備援座標
                        val fallback = bestCandidateLocation ?: getBestLastKnownLocation(locationManager)
                        if (fallback != null && isValidLatLng(fallback.latitude, fallback.longitude)) {
                            Log.i(TAG, "Fused current location null, using fallback location (${fallback.provider})")
                            cleanupAndDeliver(
                                LocationFetchResult.Success(fallback.toGpsCoordinates("Fallback:${fallback.provider ?: "LastKnown"}"))
                            )
                        }
                    }
                }
                .addOnFailureListener { err ->
                    Log.w(TAG, "FusedLocationProviderClient failed: ${err.message}")
                    val fallback = bestCandidateLocation ?: getBestLastKnownLocation(locationManager)
                    if (fallback != null && isValidLatLng(fallback.latitude, fallback.longitude)) {
                        cleanupAndDeliver(
                            LocationFetchResult.Success(fallback.toGpsCoordinates("Fallback:${fallback.provider ?: "LastKnown"}"))
                        )
                    }
                }
        } catch (e: Exception) {
            Log.e(TAG, "FusedLocationProviderClient exception: ${e.message}", e)
        }

        // 3. Timeout 防呆機制：若超時仍未取得全新 GPS 點，優先採用候選快取座標，否則回報逾時提示
        mainHandler.postDelayed({
            if (!completed.get()) {
                val fallback = bestCandidateLocation ?: getBestLastKnownLocation(locationManager)
                if (fallback != null && isValidLatLng(fallback.latitude, fallback.longitude)) {
                    Log.i(TAG, "Location request timed out, using best candidate location")
                    cleanupAndDeliver(
                        LocationFetchResult.Success(fallback.toGpsCoordinates("Cached:${fallback.provider ?: "GPS"}"))
                    )
                } else {
                    cleanupAndDeliver(
                        LocationFetchResult.Error("定位逾時，請確認手機處於可接收訊號環境，或直接手動輸入經緯度座標。")
                    )
                }
            }
        }, timeoutMs)
    }

    @SuppressLint("MissingPermission")
    private fun getBestLastKnownLocation(locationManager: LocationManager?): Location? {
        if (locationManager == null) return null
        val providers = listOf(
            LocationManager.GPS_PROVIDER,
            LocationManager.NETWORK_PROVIDER,
            LocationManager.PASSIVE_PROVIDER
        )
        var best: Location? = null
        for (provider in providers) {
            try {
                val loc = locationManager.getLastKnownLocation(provider)
                if (loc != null && isValidLatLng(loc.latitude, loc.longitude)) {
                    best = pickBetterLocation(loc, best)
                }
            } catch (_: Exception) {
            }
        }
        return best
    }

    private fun pickBetterLocation(candidate: Location, currentBest: Location?): Location {
        if (currentBest == null) return candidate
        val timeDelta = candidate.time - currentBest.time
        val isSignificantlyNewer = timeDelta > 60_000L
        val isSignificantlyOlder = timeDelta < -60_000L

        if (isSignificantlyNewer) return candidate
        if (isSignificantlyOlder) return currentBest

        val candidateAcc = if (candidate.hasAccuracy()) candidate.accuracy else 999f
        val bestAcc = if (currentBest.hasAccuracy()) currentBest.accuracy else 999f
        return if (candidateAcc <= bestAcc) candidate else currentBest
    }

    private fun Location.toGpsCoordinates(sourceLabel: String): GpsCoordinates {
        return GpsCoordinates(
            latitude = this.latitude,
            longitude = this.longitude,
            accuracyMeters = if (this.hasAccuracy()) this.accuracy else null,
            provider = sourceLabel,
            timestampMillis = if (this.time > 0L) this.time else System.currentTimeMillis()
        )
    }
}

