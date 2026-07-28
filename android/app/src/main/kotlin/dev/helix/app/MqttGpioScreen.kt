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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.helix.app.ui.GpioBoard
import dev.helix.app.ui.GpioBoardState
import dev.helix.app.ui.StatusChip
import dev.helix.transport.mqtt.MqttConnectionState

private const val ICON_SIZE_DP = 16

@Composable
fun MqttGpioScreen(viewModel: MqttGpioViewModel = viewModel()) {
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
                Text("MQTT GPIO", fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    "gpio-control over the Helix WebSocket→MQTT gateway",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                OutlinedTextField(
                    value = state.gatewayUrl,
                    onValueChange = viewModel::onGatewayUrlChange,
                    label = { Text("Gateway URL") },
                    singleLine = true,
                    enabled = !state.connected,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                )
                OutlinedTextField(
                    value = state.deviceId,
                    onValueChange = viewModel::onDeviceIdChange,
                    label = { Text("Device ID") },
                    singleLine = true,
                    enabled = !state.connected,
                    modifier = Modifier.fillMaxWidth(),
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
                            enabled = state.connectionState != MqttConnectionState.Connecting &&
                                state.gatewayUrl.isNotBlank() && state.deviceId.isNotBlank(),
                        ) {
                            Icon(Icons.Filled.Cloud, contentDescription = null, modifier = Modifier.size(ICON_SIZE_DP.dp))
                            Text(if (state.connectionState == MqttConnectionState.Connecting) "  Connecting…" else "  Connect")
                        }
                    }
                }
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
