// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Usb
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.helix.app.ui.HelixTheme

private enum class Screen { Home, Ble, Mqtt, Usb, Flash }

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // A `flashManifestUrl` extra deep-links straight into the flash screen
        // with the URL prefilled (used by the hardware test harness).
        val flashUrl = intent?.getStringExtra("flashManifestUrl")
        setContent {
            HelixTheme {
                AppRoot(flashUrl)
            }
        }
    }
}

@Composable
private fun AppRoot(flashUrl: String?) {
    var screen by remember { mutableStateOf(if (flashUrl != null) Screen.Flash else Screen.Home) }
    when (screen) {
        Screen.Home -> HomeScreen(onOpen = { screen = it })
        Screen.Ble -> BackScaffold(onBack = { screen = Screen.Home }) { BleGpioScreen() }
        Screen.Mqtt -> BackScaffold(onBack = { screen = Screen.Home }) { MqttGpioScreen() }
        Screen.Usb -> BackScaffold(onBack = { screen = Screen.Home }) { UsbGpioScreen() }
        Screen.Flash -> BackScaffold(onBack = { screen = Screen.Home }) { FlashScreen(initialUrl = flashUrl) }
    }
}

@Composable
private fun HomeScreen(onOpen: (Screen) -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Helix", fontSize = 28.sp, fontWeight = FontWeight.Bold)
            Text(
                "Connect to a Helix device and drive the gpio-control service over a transport.",
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(onClick = { onOpen(Screen.Ble) }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.Bluetooth, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("  BLE GPIO")
            }
            Button(onClick = { onOpen(Screen.Mqtt) }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.Cloud, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("  MQTT GPIO")
            }
            Button(onClick = { onOpen(Screen.Usb) }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.Usb, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("  USB GPIO")
            }
            Button(onClick = { onOpen(Screen.Flash) }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("  Flash ESP32")
            }
        }
    }
}

@Composable
private fun BackScaffold(onBack: () -> Unit, content: @Composable () -> Unit) {
    Column(modifier = Modifier.fillMaxSize()) {
        Surface(color = MaterialTheme.colorScheme.background) {
            TextButton(onClick = onBack, modifier = Modifier.padding(start = 8.dp, top = 4.dp)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", modifier = Modifier.size(18.dp))
                Text("  Home")
            }
        }
        content()
    }
}
