// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.helix.flash.Esp32Flasher
import dev.helix.flash.Esp32FirmwareManifest
import dev.helix.flash.FirmwareDownloader
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class FlashPhase { Idle, Working, Done, Error }

data class FlashUiState(
    val manifestUrl: String = DEFAULT_MANIFEST_URL,
    val phase: FlashPhase = FlashPhase.Idle,
    val manifest: Esp32FirmwareManifest? = null,
    val statusLine: String = "",
    val currentArtifact: String? = null,
    val percent: Int = 0,
    val log: List<String> = emptyList(),
    val error: String? = null,
) {
    val busy: Boolean get() = phase == FlashPhase.Working
}

const val DEFAULT_MANIFEST_URL = "http://192.168.1.35:8123/manifest.json"

/**
 * Downloads a firmware manifest from a release server and flashes the attached
 * ESP32 over USB-OTG via [Esp32Flasher]. The transport-neutral service layer is
 * untouched — this is a separate provisioning flow that owns the raw serial port
 * for the duration of the flash.
 */
class FlashViewModel(application: Application) : AndroidViewModel(application) {

    private val downloader = FirmwareDownloader()

    private val _ui = MutableStateFlow(FlashUiState())
    val ui: StateFlow<FlashUiState> = _ui.asStateFlow()

    fun setUrl(url: String) {
        _ui.update { it.copy(manifestUrl = url) }
    }

    fun flash() {
        if (_ui.value.busy) return
        val url = _ui.value.manifestUrl.trim()
        _ui.update {
            it.copy(phase = FlashPhase.Working, error = null, log = emptyList(), percent = 0, currentArtifact = null)
        }
        viewModelScope.launch {
            runCatching { runFlash(url) }
                .onSuccess {
                    _ui.update {
                        it.copy(phase = FlashPhase.Done, statusLine = "Flash complete — ESP32 rebooting.", percent = 100)
                    }
                }
                .onFailure { error ->
                    log("ERROR: ${error.message}")
                    _ui.update {
                        it.copy(phase = FlashPhase.Error, error = error.message ?: "Flashing failed.")
                    }
                }
        }
    }

    private suspend fun runFlash(url: String) {
        status("Fetching manifest…")
        val manifest = downloader.fetchManifest(url)
        _ui.update { it.copy(manifest = manifest) }
        log("Manifest: ${manifest.profile} (${manifest.artifacts.size} artifacts, ${manifest.flashSize}).")

        status("Downloading firmware…")
        val artifacts = downloader.downloadArtifacts(manifest) { log(it) }

        Esp32Flasher(getApplication()).flash(
            artifacts = artifacts,
            flashSizeBytes = Esp32Flasher.flashSizeToBytes(manifest.flashSize),
            onLog = { log(it) },
            onProgress = { _, name, written, total ->
                val pct = if (total == 0L) 0 else ((written * 100) / total).toInt()
                _ui.update { it.copy(currentArtifact = name, percent = pct, statusLine = "Writing $name…") }
            },
        )
    }

    private fun status(line: String) {
        _ui.update { it.copy(statusLine = line) }
        log(line)
    }

    private fun log(message: String) {
        _ui.update { it.copy(log = (it.log + message).takeLast(MAX_LOG)) }
    }

    private companion object {
        const val MAX_LOG = 40
    }
}
