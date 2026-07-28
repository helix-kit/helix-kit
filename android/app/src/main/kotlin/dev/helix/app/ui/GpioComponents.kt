// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** A single decoded packet shown in the log. */
data class PacketLogEntry(val id: Long, val timestamp: String, val json: String)

/** Transport-neutral GPIO board state shared by the BLE and MQTT screens. */
data class GpioBoardState(
    val connected: Boolean = false,
    val busyAction: String? = null,
    val pinLevels: Map<Int, Int> = emptyMap(),
    val error: String? = null,
    val log: List<PacketLogEntry> = emptyList(),
)

val GPIO_TEST_PINS = listOf(2, 16, 17, 23)
private const val MIN_PIN = 0
private const val MAX_PIN = 39

/**
 * The transport-agnostic GPIO controls: state bar, test-pin toggles, a custom
 * pin, error surface, and packet log. Each transport screen supplies its own
 * connection header above this board.
 */
@Composable
fun GpioBoard(
    state: GpioBoardState,
    onRefresh: () -> Unit,
    onSetPin: (pin: Int, high: Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        GpioStateBar(state, onRefresh)
        GPIO_TEST_PINS.forEach { pin ->
            PinControl(pin = pin, level = state.pinLevels[pin], state = state, onSet = onSetPin)
        }
        CustomPinControl(state = state, onSet = onSetPin)
        state.error?.let { ErrorCard(it) }
        PacketLog(state)
    }
}

@Composable
fun InfoCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(label.uppercase(), fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, fontSize = 14.sp, maxLines = 1, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

@Composable
fun StatusChip(label: String, active: Boolean) {
    val color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(modifier = Modifier.size(8.dp).clip(CircleShape).background(color))
            Text(label.uppercase(), fontSize = 11.sp, color = color)
        }
    }
}

@Composable
private fun GpioStateBar(state: GpioBoardState, onRefresh: () -> Unit) {
    val known = state.pinLevels.keys.sorted().joinToString(", ")
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("GPIO state", fontSize = 14.sp, fontWeight = FontWeight.Medium)
                Text(
                    if (known.isNotEmpty()) "Known pins: $known" else "No GPIO response yet",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            OutlinedButton(onClick = onRefresh, enabled = state.connected && state.busyAction == null) {
                Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                Text("  Refresh")
            }
        }
    }
}

@Composable
private fun PinControl(pin: Int, level: Int?, state: GpioBoardState, onSet: (Int, Boolean) -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(modifier = Modifier.size(10.dp).clip(CircleShape).background(levelColor(level)))
                    Text("GPIO $pin", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                }
                Text(levelLabel(level), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { onSet(pin, false) }, enabled = state.connected && state.busyAction == null) { Text("Low") }
                Button(onClick = { onSet(pin, true) }, enabled = state.connected && state.busyAction == null) { Text("High") }
            }
        }
    }
}

@Composable
private fun CustomPinControl(state: GpioBoardState, onSet: (Int, Boolean) -> Unit) {
    var customPin by remember { mutableStateOf("16") }
    val pin = customPin.toIntOrNull()
    val valid = pin != null && pin in MIN_PIN..MAX_PIN
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            OutlinedTextField(
                value = customPin,
                onValueChange = { customPin = it.filter(Char::isDigit).take(2) },
                label = { Text("Custom GPIO pin") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            OutlinedButton(onClick = { pin?.let { onSet(it, false) } }, enabled = state.connected && state.busyAction == null && valid) { Text("Low") }
            Button(onClick = { pin?.let { onSet(it, true) } }, enabled = state.connected && state.busyAction == null && valid) { Text("High") }
        }
    }
}

@Composable
private fun PacketLog(state: GpioBoardState) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(modifier = Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Packet log", fontSize = 14.sp, fontWeight = FontWeight.Medium)
            if (state.log.isEmpty()) {
                Text("No packets received.", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                state.log.forEach { entry -> Mono("${entry.timestamp}  ${entry.json}") }
            }
        }
    }
}

@Composable
fun ErrorCard(message: String) {
    Card(colors = CardDefaults.cardColors(containerColor = Color(0x33F87171))) {
        Text(message, modifier = Modifier.padding(14.dp), fontSize = 13.sp, color = MaterialTheme.colorScheme.error)
    }
}

@Composable
fun Mono(text: String) {
    Surface(color = Color(0xFF0B0B0D), shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
        Text(
            text,
            modifier = Modifier.padding(10.dp),
            fontFamily = FontFamily.Monospace,
            fontSize = 11.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun levelLabel(level: Int?): String = when (level) {
    1 -> "High"
    0 -> "Low"
    else -> "Unknown"
}

@Composable
private fun levelColor(level: Int?): Color = when (level) {
    1 -> MaterialTheme.colorScheme.primary
    0 -> MaterialTheme.colorScheme.onSurfaceVariant
    else -> MaterialTheme.colorScheme.outline
}
