// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.Usb
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.helix.app.ui.GpioBoard
import dev.helix.app.ui.GpioBoardState
import dev.helix.app.ui.InfoCard
import dev.helix.app.ui.StatusChip
import dev.helix.transport.usbserial.UsbConnectionState

private const val ICON_SIZE_DP = 16

@Composable
fun UsbGpioScreen(viewModel: UsbGpioViewModel = viewModel()) {
    val state by viewModel.ui.collectAsStateWithLifecycle()

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("USB GPIO", fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    "ESP32 gpio-control over Helix USB serial",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    StatusChip(state.connectionState.name, state.connected)
                    if (state.connected) {
                        OutlinedButton(onClick = viewModel::disconnect) {
                            Icon(Icons.Filled.LinkOff, contentDescription = null, modifier = Modifier.size(ICON_SIZE_DP.dp))
                            Text("  Disconnect")
                        }
                    } else {
                        Button(
                            onClick = viewModel::connect,
                            enabled = state.connectionState != UsbConnectionState.Connecting,
                        ) {
                            Icon(Icons.Filled.Usb, contentDescription = null, modifier = Modifier.size(ICON_SIZE_DP.dp))
                            Text(if (state.connectionState == UsbConnectionState.Connecting) "  Connecting…" else "  Connect USB")
                        }
                    }
                }
            }

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                InfoCard("Device", state.deviceInfo?.label ?: "Not connected", Modifier.weight(1f))
                InfoCard("Transport", "USB serial", Modifier.weight(1f))
            }

            GpioBoard(
                state = GpioBoardState(
                    connected = state.connected,
                    busyAction = state.busyAction,
                    pinLevels = state.pinLevels,
                    error = state.error,
                    log = state.log,
                ),
                onRefresh = viewModel::refresh,
                onSetPin = viewModel::setPin,
            )
        }
    }
}
