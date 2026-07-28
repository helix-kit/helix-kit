// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val HelixDarkColors = darkColorScheme(
    primary = Color(0xFF34D399),
    onPrimary = Color(0xFF04120C),
    secondary = Color(0xFF60A5FA),
    background = Color(0xFF09090B),
    onBackground = Color(0xFFF4F4F5),
    surface = Color(0xFF18181B),
    onSurface = Color(0xFFE4E4E7),
    surfaceVariant = Color(0xFF27272A),
    onSurfaceVariant = Color(0xFFA1A1AA),
    outline = Color(0xFF3F3F46),
    error = Color(0xFFF87171),
)

@Composable
fun HelixTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = HelixDarkColors, content = content)
}
