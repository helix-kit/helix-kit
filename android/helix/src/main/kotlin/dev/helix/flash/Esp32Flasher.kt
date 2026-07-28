// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.flash

import android.content.Context
import android.os.SystemClock
import com.hoho.android.usbserial.driver.UsbSerialPort
import dev.helix.transport.usbserial.UsbSerialConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.util.zip.Deflater

/**
 * A minimal ESP32 ROM-bootloader flasher — a focused Kotlin port of esptool's
 * `--no-stub` path — driving an open [UsbSerialPort]. It resets the chip into
 * download mode over DTR/RTS, speaks the SLIP-framed loader protocol, and writes
 * compressed (zlib) flash blocks. The web flashes via `esptool-js` over Web
 * Serial; this is the Android equivalent over USB-OTG, consuming the same
 * [Esp32FirmwareManifest].
 *
 * Pure ROM loader (no stub upload) keeps the library self-contained — no vendored
 * Espressif stub blob — at the cost of the ROM's 1 KB write blocks.
 */
class Esp32Flasher(private val context: Context) {

    fun interface ProgressListener {
        fun onProgress(artifactIndex: Int, artifactName: String, bytesWritten: Long, bytesTotal: Long)
    }

    private lateinit var port: UsbSerialPort
    private val inBuf = ByteArray(4096)
    private var inLen = 0
    private var inPos = 0

    /**
     * Opens the attached ESP32 over USB, flashes every [artifacts] entry at its
     * offset, then resets the chip to run the new firmware. [flashSizeBytes]
     * sizes the erase parameters. The serial port is opened and closed here, so
     * the caller never handles it.
     */
    suspend fun flash(
        artifacts: List<DownloadedArtifact>,
        flashSizeBytes: Long,
        onLog: (String) -> Unit = {},
        onProgress: ProgressListener = ProgressListener { _, _, _, _ -> },
    ) = withContext(Dispatchers.IO) {
        onLog("Opening USB serial port…")
        val opened = UsbSerialConnection.open(context, baudRate = FLASH_BAUD_RATE)
        onLog("Opened ${opened.device.productName ?: "USB device"} for flashing.")
        port = opened.port
        try {
            onLog("Resetting ESP32 into download mode…")
            if (!connectLoader()) {
                throw IllegalStateException("Could not sync with the ESP32 bootloader. Check the cable/board.")
            }
            onLog("Bootloader ready. Configuring flash…")
            spiAttach()
            spiSetParams(flashSizeBytes)

            artifacts.forEachIndexed { index, downloaded ->
                writeArtifact(index, downloaded, onLog, onProgress)
            }

            runCatching { flashDeflEnd() }.onFailure { onLog("(flash-end ignored: ${it.message})") }
            onLog("Flash complete. Rebooting…")
            hardReset()
        } finally {
            runCatching { opened.port.close() }
        }
    }

    private fun writeArtifact(
        index: Int,
        downloaded: DownloadedArtifact,
        onLog: (String) -> Unit,
        onProgress: ProgressListener,
    ) {
        val artifact = downloaded.artifact
        val uncompressed = downloaded.data
        val compressed = zlibCompress(uncompressed)
        val numBlocks = ceilDiv(compressed.size, FLASH_WRITE_SIZE)
        val eraseBlocks = ceilDiv(uncompressed.size, FLASH_WRITE_SIZE)
        val writeSize = eraseBlocks * FLASH_WRITE_SIZE

        onLog(
            "Writing ${artifact.name} (${uncompressed.size} B → ${compressed.size} B) " +
                "at 0x${artifact.offset.toString(16)}…",
        )
        flashDeflBegin(writeSize, numBlocks, artifact.offset.toInt())

        var seq = 0
        var sent = 0L
        val total = compressed.size.toLong()
        while (seq < numBlocks) {
            val start = seq * FLASH_WRITE_SIZE
            val end = minOf(start + FLASH_WRITE_SIZE, compressed.size)
            val block = compressed.copyOfRange(start, end)
            flashDeflData(block, seq)
            seq++
            sent += block.size
            onProgress.onProgress(index, artifact.name, sent, total)
        }
    }

    // --- loader connect ---------------------------------------------------

    private fun connectLoader(): Boolean {
        repeat(5) {
            classicReset()
            flushInput(300)
            repeat(7) {
                if (trySync()) {
                    flushInput(100)
                    return true
                }
            }
        }
        return false
    }

    private fun trySync(): Boolean {
        val payload = ByteArray(36)
        payload[0] = 0x07; payload[1] = 0x07; payload[2] = 0x12.toByte(); payload[3] = 0x20
        for (i in 4 until 36) payload[i] = 0x55
        sendCommand(CMD_SYNC, payload, 0)
        val response = readFrame(deadline(120)) ?: return false
        // Drain the ROM's extra SYNC echoes so they don't shift later reads.
        repeat(7) { readFrame(deadline(40)) }
        return response.size >= 2 && (response[0].toInt() and 0xFF) == 0x01
    }

    // --- loader commands --------------------------------------------------

    private fun spiAttach() {
        checkCommand(CMD_SPI_ATTACH, le32(0) + le32(0), timeoutMs = 3000)
    }

    private fun spiSetParams(totalBytes: Long) {
        val data = le32(0) + le32(totalBytes.toInt()) + le32(0x10000) + le32(0x1000) + le32(0x100) + le32(0xFFFF)
        checkCommand(CMD_SPI_SET_PARAMS, data, timeoutMs = 3000)
    }

    private fun flashDeflBegin(writeSize: Int, numBlocks: Int, offset: Int) {
        val data = le32(writeSize) + le32(numBlocks) + le32(FLASH_WRITE_SIZE) + le32(offset)
        checkCommand(CMD_FLASH_DEFL_BEGIN, data, timeoutMs = 20_000)
    }

    private fun flashDeflData(block: ByteArray, seq: Int) {
        val header = le32(block.size) + le32(seq) + le32(0) + le32(0)
        checkCommand(CMD_FLASH_DEFL_DATA, header + block, checksum(block), timeoutMs = 5000)
    }

    private fun flashDeflEnd() {
        // reboot flag: 1 = stay in loader (we hard-reset over DTR/RTS instead).
        checkCommand(CMD_FLASH_DEFL_END, le32(1), timeoutMs = 3000)
    }

    /** Sends a command and throws if the loader reports a non-zero status. */
    private fun checkCommand(op: Int, data: ByteArray, checksum: Int = 0, timeoutMs: Long) {
        sendCommand(op, data, checksum)
        val frame = readResponse(op, deadline(timeoutMs))
            ?: throw IllegalStateException("No response to loader command 0x${op.toString(16)}.")
        val status = if (frame.size >= 10) frame[8].toInt() and 0xFF else 1
        if (status != 0) {
            val err = if (frame.size >= 11) frame[9].toInt() and 0xFF else -1
            throw IllegalStateException("Loader command 0x${op.toString(16)} failed (status=$status err=$err).")
        }
    }

    private fun readResponse(op: Int, deadline: Long): ByteArray? {
        while (true) {
            val frame = readFrame(deadline) ?: return null
            // dir=0x01 response, echoed op in byte 1.
            if (frame.size >= 2 && (frame[0].toInt() and 0xFF) == 0x01 && (frame[1].toInt() and 0xFF) == op) {
                return frame
            }
        }
    }

    // --- SLIP framing -----------------------------------------------------

    private fun sendCommand(op: Int, data: ByteArray, checksum: Int) {
        val header = ByteArray(8)
        header[0] = 0x00 // direction: request
        header[1] = op.toByte()
        header[2] = (data.size and 0xFF).toByte()
        header[3] = ((data.size shr 8) and 0xFF).toByte()
        header[4] = (checksum and 0xFF).toByte()
        header[5] = ((checksum shr 8) and 0xFF).toByte()
        header[6] = ((checksum shr 16) and 0xFF).toByte()
        header[7] = ((checksum shr 24) and 0xFF).toByte()
        writeFrame(header + data)
    }

    private fun writeFrame(payload: ByteArray) {
        val out = ByteArrayOutputStream(payload.size + 8)
        out.write(SLIP_END)
        for (byte in payload) {
            when (byte.toInt() and 0xFF) {
                SLIP_END -> { out.write(SLIP_ESC); out.write(SLIP_ESC_END) }
                SLIP_ESC -> { out.write(SLIP_ESC); out.write(SLIP_ESC_ESC) }
                else -> out.write(byte.toInt())
            }
        }
        out.write(SLIP_END)
        port.write(out.toByteArray(), WRITE_TIMEOUT_MS)
    }

    private fun readFrame(deadline: Long): ByteArray? {
        var byte = nextByte(deadline)
        while (byte != SLIP_END) {
            if (byte < 0) return null
            byte = nextByte(deadline)
        }
        val out = ByteArrayOutputStream(64)
        while (true) {
            byte = nextByte(deadline)
            if (byte < 0) return null
            when (byte) {
                SLIP_END -> if (out.size() > 0) return out.toByteArray() // else: skip repeated delimiter
                SLIP_ESC -> {
                    val next = nextByte(deadline)
                    if (next < 0) return null
                    out.write(if (next == SLIP_ESC_END) SLIP_END else if (next == SLIP_ESC_ESC) SLIP_ESC else next)
                }
                else -> out.write(byte)
            }
        }
    }

    private fun nextByte(deadline: Long): Int {
        while (inPos >= inLen) {
            val remaining = deadline - SystemClock.elapsedRealtime()
            if (remaining <= 0) return -1
            val read = port.read(inBuf, remaining.coerceAtMost(200L).toInt())
            if (read > 0) {
                inLen = read
                inPos = 0
            }
        }
        return inBuf[inPos++].toInt() and 0xFF
    }

    private fun flushInput(durationMs: Long) {
        val end = SystemClock.elapsedRealtime() + durationMs
        while (SystemClock.elapsedRealtime() < end) {
            val read = port.read(inBuf, 50)
            if (read <= 0) break
        }
        inLen = 0
        inPos = 0
    }

    // --- reset lines ------------------------------------------------------

    /** Classic auto-reset into download mode (esptool ClassicReset). */
    private fun classicReset() {
        port.setDTR(false)
        port.setRTS(true)
        SystemClock.sleep(100)
        port.setDTR(true)
        port.setRTS(false)
        SystemClock.sleep(50)
        port.setDTR(false)
    }

    /** Pulse EN to reboot the chip and run the freshly flashed app. */
    private fun hardReset() {
        port.setDTR(false)
        port.setRTS(true)
        SystemClock.sleep(100)
        port.setRTS(false)
    }

    // --- helpers ----------------------------------------------------------

    private fun deadline(timeoutMs: Long): Long = SystemClock.elapsedRealtime() + timeoutMs

    private fun checksum(data: ByteArray): Int {
        var state = ESP_CHECKSUM_MAGIC
        for (byte in data) state = state xor (byte.toInt() and 0xFF)
        return state
    }

    private fun le32(value: Int): ByteArray = byteArrayOf(
        (value and 0xFF).toByte(),
        ((value shr 8) and 0xFF).toByte(),
        ((value shr 16) and 0xFF).toByte(),
        ((value shr 24) and 0xFF).toByte(),
    )

    private fun ceilDiv(value: Int, divisor: Int): Int = (value + divisor - 1) / divisor

    private fun zlibCompress(data: ByteArray): ByteArray {
        val deflater = Deflater(Deflater.BEST_COMPRESSION)
        deflater.setInput(data)
        deflater.finish()
        val out = ByteArrayOutputStream(data.size / 2)
        val chunk = ByteArray(8192)
        while (!deflater.finished()) {
            val n = deflater.deflate(chunk)
            out.write(chunk, 0, n)
        }
        deflater.end()
        return out.toByteArray()
    }

    companion object {
        /** Parses a manifest flashSize (e.g. "4MB") to bytes; defaults to 4 MB. */
        fun flashSizeToBytes(flashSize: String): Long {
            val match = Regex("(\\d+)MB").find(flashSize) ?: return 4L * 1024 * 1024
            return match.groupValues[1].toLong() * 1024 * 1024
        }

        private const val FLASH_BAUD_RATE = 115_200
        private const val FLASH_WRITE_SIZE = 0x400 // ROM loader block size
        private const val ESP_CHECKSUM_MAGIC = 0xEF

        private const val CMD_SYNC = 0x08
        private const val CMD_SPI_SET_PARAMS = 0x0B
        private const val CMD_SPI_ATTACH = 0x0D
        private const val CMD_FLASH_DEFL_BEGIN = 0x10
        private const val CMD_FLASH_DEFL_DATA = 0x11
        private const val CMD_FLASH_DEFL_END = 0x12

        private const val SLIP_END = 0xC0
        private const val SLIP_ESC = 0xDB
        private const val SLIP_ESC_END = 0xDC
        private const val SLIP_ESC_ESC = 0xDD

        private const val WRITE_TIMEOUT_MS = 3000
    }
}
