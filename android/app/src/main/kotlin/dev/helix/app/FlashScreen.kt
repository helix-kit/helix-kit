// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel

private const val ICON_SIZE_DP = 16

@Composable
fun FlashScreen(initialUrl: String? = null, viewModel: FlashViewModel = viewModel()) {
    val state by viewModel.ui.collectAsStateWithLifecycle()

    LaunchedEffect(initialUrl) {
        if (initialUrl != null) viewModel.setUrl(initialUrl)
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Flash ESP32", fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
            Text(
                "Download firmware from a release server and flash the attached ESP32 over USB.",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            OutlinedTextField(
                value = state.manifestUrl,
                onValueChange = viewModel::setUrl,
                label = { Text("Manifest URL") },
                singleLine = true,
                enabled = !state.busy,
                modifier = Modifier.fillMaxWidth(),
            )

            Button(
                onClick = viewModel::flash,
                enabled = !state.busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Filled.Download, contentDescription = null, modifier = Modifier.size(ICON_SIZE_DP.dp))
                Text(if (state.busy) "  Flashing…" else "  Download & Flash")
            }

            if (state.phase == FlashPhase.Working || state.percent > 0) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        state.currentArtifact?.let { "$it — ${state.percent}%" } ?: state.statusLine,
                        fontSize = 13.sp,
                    )
                    LinearProgressIndicator(
                        progress = { state.percent / 100f },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            state.error?.let { error ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        error,
                        modifier = Modifier.padding(12.dp),
                        color = MaterialTheme.colorScheme.error,
                        fontSize = 13.sp,
                    )
                }
            }

            if (state.phase == FlashPhase.Done) {
                Text(
                    "✓ ${state.statusLine}  Open USB GPIO to talk to the device.",
                    color = MaterialTheme.colorScheme.primary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                )
            }

            if (state.log.isNotEmpty()) {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        for (line in state.log) {
                            Text(line, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                        }
                    }
                }
            }
        }
    }
}
