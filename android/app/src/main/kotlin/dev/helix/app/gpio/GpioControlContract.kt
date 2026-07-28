// SPDX-License-Identifier: AGPL-3.0-only
package dev.helix.app.gpio

import dev.helix.protocol.service.ServiceContract
import dev.helix.protocol.service.method
import dev.helix.protocol.service.message
import dev.helix.protocol.service.schema
import kotlinx.serialization.Serializable

const val MIN_GPIO_PIN = 0
const val MAX_GPIO_PIN = 39

@Serializable
data class SetGpioRequest(val pin: Int, val high: Boolean)

@Serializable
data class ReadGpioRequest(val pin: Int? = null)

@Serializable
data class GpioPinState(val pin: Int, val level: Int)

@Serializable
data class GpioStatePayload(val pins: List<GpioPinState>)

@Serializable
data class GpioErrorPayload(val error: String)

/**
 * The gpio-control service contract, mirroring
 * `web/apps/helix/src/generated/contracts/gpio_control.ts`.
 */
object GpioControlContract : ServiceContract("gpio-control") {
    val setGpio = method(
        name = "set-gpio",
        input = schema<SetGpioRequest>(),
        output = schema<GpioStatePayload>(),
        error = schema<GpioErrorPayload>(),
    )
    val readGpio = method(
        name = "read-gpio",
        input = schema<ReadGpioRequest>(),
        output = schema<GpioStatePayload>(),
        error = schema<GpioErrorPayload>(),
    )
    val state = message(name = "gpio-control-state", payload = schema<GpioStatePayload>())
    val error = message(name = "gpio-control-error", payload = schema<GpioErrorPayload>())
}
