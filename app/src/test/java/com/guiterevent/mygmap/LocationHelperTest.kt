package com.guiterevent.mygmap

import com.guiterevent.mygmap.location.GpsCoordinates
import com.guiterevent.mygmap.location.LocationHelper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationHelperTest {

    @Test
    fun `formatLatLng formats coordinates to 6 decimal places`() {
        val coords = GpsCoordinates(
            latitude = 25.03396412,
            longitude = 121.5644689,
            accuracyMeters = 6.4f,
            provider = "FusedLocation"
        )
        assertEquals("25.033964, 121.564469", coords.formatLatLng(6))
        assertEquals("±6m • FusedLocation", coords.formatAccuracySummary())
    }

    @Test
    fun `parseCoordinateString parses valid comma and space separated lat lng`() {
        val fromComma = LocationHelper.parseCoordinateString("25.033964, 121.564468")
        assertNotNull(fromComma)
        assertEquals(25.033964, fromComma!!.latitude, 1e-6)
        assertEquals(121.564468, fromComma.longitude, 1e-6)

        val fromSpace = LocationHelper.parseCoordinateString("  24.147736   120.673648 ")
        assertNotNull(fromSpace)
        assertEquals(24.147736, fromSpace!!.latitude, 1e-6)
        assertEquals(120.673648, fromSpace.longitude, 1e-6)
    }

    @Test
    fun `parseCoordinateString rejects out of range or invalid strings`() {
        assertNull(LocationHelper.parseCoordinateString(""))
        assertNull(LocationHelper.parseCoordinateString("invalid, coords"))
        assertNull(LocationHelper.parseCoordinateString("95.0, 121.0"))
        assertNull(LocationHelper.parseCoordinateString("25.0, 195.0"))
        assertNull(LocationHelper.parseCoordinateString("0.0, 0.0"))
        assertFalse(LocationHelper.isValidLatLng(0.0, 0.0))
        assertTrue(LocationHelper.isValidLatLng(25.033964, 121.564468))
    }

    @Test
    fun `buildDefaultPinTitle and buildClipboardFallbackText follow Phase 4 spec`() {
        val defaultTitle = LocationHelper.buildDefaultPinTitle()
        assertTrue(defaultTitle.startsWith("GPS 標記 ("))
        assertTrue(defaultTitle.endsWith(")"))

        val clipWithDesc = LocationHelper.buildClipboardFallbackText("台北 101", "信義區地標")
        assertEquals("台北 101 - 信義區地標", clipWithDesc)

        val clipWithoutDesc = LocationHelper.buildClipboardFallbackText("台北 101", "   ")
        assertEquals("台北 101", clipWithoutDesc)
    }
}

