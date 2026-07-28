// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.flash

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/** Fetches an [Esp32FirmwareManifest] and its artifacts, verifying each artifact's size and SHA-256. */
class FirmwareDownloader(
    private val client: OkHttpClient = defaultClient,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /** Fetches and validates the manifest at [manifestUrl]. */
    suspend fun fetchManifest(manifestUrl: String): Esp32FirmwareManifest = withContext(Dispatchers.IO) {
        val body = get(manifestUrl)
        val manifest = json.decodeFromString(Esp32FirmwareManifest.serializer(), String(body, Charsets.UTF_8))
        manifest.validate()
        manifest
    }

    /** Downloads and verifies every artifact of [manifest]. */
    suspend fun downloadArtifacts(
        manifest: Esp32FirmwareManifest,
        onLog: (String) -> Unit = {},
    ): List<DownloadedArtifact> = withContext(Dispatchers.IO) {
        manifest.artifacts.map { artifact ->
            onLog("Downloading and verifying ${artifact.name}…")
            val data = get(artifact.url)
            require(data.size.toLong() == artifact.size) {
                "${artifact.name} size mismatch: expected ${artifact.size}, got ${data.size}."
            }
            val digest = sha256Hex(data)
            require(digest == artifact.sha256.trim().lowercase()) {
                "${artifact.name} SHA-256 verification failed."
            }
            DownloadedArtifact(artifact, data)
        }
    }

    private fun get(url: String): ByteArray {
        val request = Request.Builder().url(url).header("Cache-Control", "no-store").build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("Request to $url failed with HTTP ${response.code}.")
            }
            return response.body.bytes()
        }
    }

    private fun sha256Hex(data: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(data)
        return digest.joinToString("") { "%02x".format(it) }
    }

    private companion object {
        val defaultClient: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
    }
}
