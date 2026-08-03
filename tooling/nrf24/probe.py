"""Bring-up probe for an nRF24L01(+) on a Linux board.

Mirrors the four checks the ESP32 `nrf24_smoke` app runs, so both ends of a link
are validated the same way: register defaults, a multi-byte round-trip a floating
bus cannot fake, the chip variant, and a MAX_RT transmit that is the only step
exercising CE and IRQ.
"""

from __future__ import annotations

import argparse
import time

from .driver import (
    ADDR_WIDTH,
    CMD_FLUSH_RX,
    CMD_FLUSH_TX,
    CMD_W_TX_PAYLOAD,
    CONFIG_EN_CRC,
    CONFIG_PWR_UP,
    NRF24,
    POWER_ON_DEFAULTS,
    REG_CONFIG,
    REG_EN_AA,
    REG_EN_RXADDR,
    REG_FIFO_STATUS,
    REG_OBSERVE_TX,
    REG_RF_SETUP,
    REG_RX_ADDR_P0,
    REG_SETUP_RETR,
    REG_TX_ADDR,
    RF_SETUP_RF_DR_LOW,
    STATUS_MAX_RT,
    STATUS_TX_DS,
)


def check_defaults(radio: NRF24) -> bool:
    ok = True
    for reg, name, expected in POWER_ON_DEFAULTS:
        value = radio.read_reg8(reg)
        match = value == expected
        verdict = "ok" if match else "MISMATCH"
        print(f"  {name:<11} = 0x{value:02X} (expected 0x{expected:02X}) {verdict}")
        ok = ok and match
    # Reported, not asserted. RF_SETUP in particular is left as-is by the restore
    # above, so after a link run it still carries that run's rate/power rather
    # than the datasheet default -- only a cold boot shows the true power-on value.
    print(f"  {'STATUS':<11} = 0x{radio.status():02X} (observed)")
    print(f"  {'RF_SETUP':<11} = 0x{radio.read_reg8(REG_RF_SETUP):02X} (observed)")
    print(f"  {'FIFO_STATUS':<11} = 0x{radio.read_reg8(REG_FIFO_STATUS):02X} (observed)")
    return ok


def check_address_roundtrip(radio: NRF24) -> bool:
    pattern = bytes([0xA5, 0x5A, 0x0F, 0xF0, 0x3C])
    radio.write_reg(REG_TX_ADDR, pattern)
    readback = radio.read_reg(REG_TX_ADDR, ADDR_WIDTH)
    ok = readback == pattern
    print(
        f"  TX_ADDR wrote {pattern.hex(':').upper()} read {readback.hex(':').upper()} "
        f"{'ok' if ok else 'MISMATCH'}"
    )
    radio.write_reg(REG_TX_ADDR, b"\xe7" * ADDR_WIDTH)
    return ok


def report_variant(radio: NRF24) -> str:
    original = radio.read_reg8(REG_RF_SETUP)
    radio.write_reg(REG_RF_SETUP, original | RF_SETUP_RF_DR_LOW)
    probed = radio.read_reg8(REG_RF_SETUP)
    radio.write_reg(REG_RF_SETUP, original)
    variant = "nRF24L01+" if probed & RF_SETUP_RF_DR_LOW else "nRF24L01 (non-plus or clone)"
    print(f"  variant: {variant} (RF_SETUP probe 0x{probed:02X})")
    return variant


def check_max_rt(radio: NRF24) -> bool:
    """Transmit to an address nobody answers; the retry budget must end in MAX_RT."""
    addr = b"\xe7" * ADDR_WIDTH
    radio.write_reg(REG_CONFIG, CONFIG_EN_CRC | CONFIG_PWR_UP)
    time.sleep(0.005)
    config = radio.read_reg8(REG_CONFIG)
    print(
        f"  CONFIG after PWR_UP = 0x{config:02X} "
        f"({'powered up' if config & CONFIG_PWR_UP else 'STILL POWERED DOWN'})"
    )

    radio.write_reg(REG_EN_AA, 0x01)
    radio.write_reg(REG_EN_RXADDR, 0x01)
    radio.write_reg(REG_SETUP_RETR, 0x1F)  # 500 us delay, 15 retries
    radio.write_reg(REG_TX_ADDR, addr)
    radio.write_reg(REG_RX_ADDR_P0, addr)
    radio.command(CMD_FLUSH_TX)
    radio.command(CMD_FLUSH_RX)
    radio.clear_interrupts()

    radio.command(CMD_W_TX_PAYLOAD, bytes([0xDE, 0xAD, 0xBE, 0xEF]))
    fifo = radio.read_reg8(REG_FIFO_STATUS)
    print(
        f"  FIFO_STATUS after load = 0x{fifo:02X} "
        f"({'TX FIFO EMPTY - payload did not load' if fifo & 0x10 else 'payload queued'})"
    )

    irq_before = radio.irq.get()
    radio.pulse_ce()

    # The whole 15-retry budget at ARD=500us is only ~10 ms, so sample finely
    # enough to see the retransmit counter climb rather than just its end state.
    trace: list[str] = []
    status = 0
    for _ in range(60):
        time.sleep(0.0005)
        status = radio.status()
        observe = radio.read_reg8(REG_OBSERVE_TX)
        if len(trace) < 16:
            trace.append(f"{observe & 0x0F}/{status:02X}")
        if status & (STATUS_MAX_RT | STATUS_TX_DS):
            break

    observe = radio.read_reg8(REG_OBSERVE_TX)
    irq_after = radio.irq.get()
    print(f"  trace arc/status: {' '.join(trace)}")
    print(
        f"  STATUS=0x{status:02X} OBSERVE_TX=0x{observe:02X} (retransmits={observe & 0x0F}) "
        f"IRQ {irq_before}->{irq_after}"
    )

    max_rt = bool(status & STATUS_MAX_RT)
    if status & STATUS_TX_DS:
        print("  TX_DS set: a peer acknowledged, so the link is live in both directions")
    print(f"  MAX_RT after retries: {'yes (CE pulse took effect)' if max_rt else 'NO'}")
    print(f"  IRQ pulled low: {'yes' if irq_after == 0 else 'NO'}")

    radio.clear_interrupts()
    radio.command(CMD_FLUSH_TX)
    radio.write_reg(REG_CONFIG, CONFIG_EN_CRC)
    return max_rt and irq_after == 0


def main() -> int:
    parser = argparse.ArgumentParser(description="nRF24L01 bring-up probe")
    parser.add_argument("--spidev", default="/dev/spidev1.0")
    parser.add_argument("--gpiochip", default="/dev/gpiochip0")
    parser.add_argument("--ce-line", type=int, default=312, help="gpiochip line for CE")
    parser.add_argument("--irq-line", type=int, default=313, help="gpiochip line for IRQ")
    parser.add_argument("--speed-hz", type=int, default=4_000_000)
    args = parser.parse_args()

    print(
        f"nRF24L01 bring-up: spidev={args.spidev} gpiochip={args.gpiochip} "
        f"CE=line{args.ce_line} IRQ=line{args.irq_line} clk={args.speed_hz}"
    )
    with NRF24(
        spidev=args.spidev,
        gpiochip=args.gpiochip,
        ce_line=args.ce_line,
        irq_line=args.irq_line,
        speed_hz=args.speed_hz,
    ) as radio:
        print("[1/4] power-on register defaults")
        radio.restore_power_on_defaults()
        defaults_ok = check_defaults(radio)

        print("[2/4] TX_ADDR write/read round-trip")
        roundtrip_ok = check_address_roundtrip(radio)

        print("[3/4] variant probe")
        report_variant(radio)

        print("[4/4] CE pulse and IRQ line (MAX_RT)")
        irq_ok = check_max_rt(radio)

    if defaults_ok and roundtrip_ok and irq_ok:
        print("RESULT: PASS - radio present and every wire in the harness works")
        return 0
    if roundtrip_ok:
        missing = []
        if not defaults_ok:
            missing.append("registers are not at power-on defaults")
        if not irq_ok:
            missing.append("CE/IRQ did not behave as expected")
        print(f"RESULT: PARTIAL - SPI talks to the radio, but {'; '.join(missing)}")
        return 1
    print("RESULT: FAIL - no register response; check VCC/GND, CSN, SCK, MOSI, MISO")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
