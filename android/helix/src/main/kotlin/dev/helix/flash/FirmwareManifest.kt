// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.flash

import kotlinx.serialization.Serializable

private val SHA256_HEX = Regex("^[a-fA-F0-9]{64}$")

/**
 * A flashable ESP32 firmware manifest, mirroring the web
 * `@helix/esp32-flasher` `Esp32FirmwareManifest` so the Android app consumes the
 * same server payload (`helix release serve-firmware` or the appliance). Each
 * artifact is one binary written at [Esp32Artifact.offset].
 */
@Serializable
data class Esp32FirmwareManifest(
    val chip: String,
    val baudRate: Int,
    val flashMode: String,
    val flashFreq: String,
    val flashSize: String,
    val profile: String,
    val artifacts: List<Esp32Artifact>,
) {
    fun validate() {
        require(chip == "esp32") { "Unsupported firmware chip $chip." }
        require(artifacts.isNotEmpty()) { "Firmware manifest contains no artifacts." }
        val offsets = mutableSetOf<Long>()
        for (artifact in artifacts) {
            require(artifact.offset >= 0) { "Artifact ${artifact.name} has an invalid offset." }
            require(artifact.size > 0) { "Artifact ${artifact.name} has an invalid size." }
            require(SHA256_HEX.matches(artifact.sha256.trim())) {
                "Artifact ${artifact.name} has an invalid SHA-256 digest."
            }
            require(offsets.add(artifact.offset)) { "Manifest repeats offset ${artifact.offset}." }
        }
    }
}

@Serializable
data class Esp32Artifact(
    val id: String,
    val name: String,
    val offset: Long,
    val sha256: String,
    val size: Long,
    val url: String,
)

/** A downloaded, verified artifact ready to write to flash. */
data class DownloadedArtifact(
    val artifact: Esp32Artifact,
    val data: ByteArray,
) {
    @Suppress("ArrayInDataClass")
    override fun equals(other: Any?): Boolean = this === other

    override fun hashCode(): Int = artifact.hashCode()
}
