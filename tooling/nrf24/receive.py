"""PRX side of the nRF24 link test: listen for the ESP32's numbered payloads.

Auto-ack makes this a two-way proof — the transmitter only reports TX_DS when
this end's acknowledgement made it back, so a delivered payload here plus an ACK
there means the link works in both directions.
"""

from __future__ import annotations

import argparse
import time

from .driver import (
    ADDR_WIDTH,
    CMD_FLUSH_RX,
    CMD_FLUSH_TX,
    CMD_R_RX_PAYLOAD,
    CONFIG_EN_CRC,
    CONFIG_PRIM_RX,
    CONFIG_PWR_UP,
    NRF24,
    REG_CONFIG,
    REG_EN_AA,
    REG_EN_RXADDR,
    REG_FIFO_STATUS,
    REG_RF_CH,
    REG_RF_SETUP,
    REG_RX_ADDR_P0,
    REG_RX_PW_P0,
    REG_STATUS,
    STATUS_RX_DR,
)

# Must match the ESP32 peer (apps/nrf24_link/nrf24_link.c).
DEFAULT_CHANNEL = 76
DEFAULT_RF_SETUP = 0x06  # 1 Mbps, 0 dBm
DEFAULT_ADDR = b"HLX01"
DEFAULT_PAYLOAD_WIDTH = 8


def configure_as_prx(
    radio: NRF24, channel: int, rf_setup: int, addr: bytes, payload_width: int
) -> None:
    radio.restore_power_on_defaults()
    radio.write_reg(REG_RF_CH, channel)
    radio.write_reg(REG_RF_SETUP, rf_setup)
    radio.write_reg(REG_EN_AA, 0x01)
    radio.write_reg(REG_EN_RXADDR, 0x01)
    radio.write_reg(REG_RX_ADDR_P0, addr)
    radio.write_reg(REG_RX_PW_P0, payload_width)
    radio.write_reg(REG_CONFIG, CONFIG_EN_CRC | CONFIG_PWR_UP | CONFIG_PRIM_RX)
    time.sleep(0.005)
    radio.clear_interrupts()
    radio.command(CMD_FLUSH_RX)
    radio.command(CMD_FLUSH_TX)
    # CE stays high for the whole session: in PRX that is what keeps the receiver
    # actually listening, unlike the brief pulse a transmit needs.
    radio.ce.set(1)
    time.sleep(0.00013)


def decode(payload: bytes) -> tuple[bool, int | None]:
    if len(payload) < 8 or payload[:3] != b"HLX":
        return False, None
    seq = int.from_bytes(payload[3:7], "big")
    checksum = payload[3] ^ payload[4] ^ payload[5] ^ payload[6]
    return checksum == payload[7], seq


def main() -> int:
    parser = argparse.ArgumentParser(description="nRF24L01 link receiver (PRX)")
    parser.add_argument("--spidev", default="/dev/spidev1.0")
    parser.add_argument("--gpiochip", default="/dev/gpiochip0")
    parser.add_argument("--ce-line", type=int, default=312)
    parser.add_argument("--irq-line", type=int, default=313)
    parser.add_argument("--channel", type=int, default=DEFAULT_CHANNEL)
    parser.add_argument("--rf-setup", type=lambda v: int(v, 0), default=DEFAULT_RF_SETUP)
    parser.add_argument("--address", default=DEFAULT_ADDR.decode())
    parser.add_argument("--payload-width", type=int, default=DEFAULT_PAYLOAD_WIDTH)
    parser.add_argument("--seconds", type=float, default=30.0, help="0 runs until interrupted")
    args = parser.parse_args()

    addr = args.address.encode()
    if len(addr) != ADDR_WIDTH:
        parser.error(f"--address must be exactly {ADDR_WIDTH} bytes")

    with NRF24(
        spidev=args.spidev,
        gpiochip=args.gpiochip,
        ce_line=args.ce_line,
        irq_line=args.irq_line,
    ) as radio:
        configure_as_prx(radio, args.channel, args.rf_setup, addr, args.payload_width)
        print(
            f"PRX on channel {args.channel} ({2400 + args.channel} MHz) "
            f"RF_SETUP=0x{radio.read_reg8(REG_RF_SETUP):02X} addr={args.address} "
            f"payload={args.payload_width} bytes"
        )
        print("waiting for packets...")

        deadline = time.time() + args.seconds if args.seconds else None
        received = 0
        bad = 0
        seqs: list[int] = []
        try:
            while deadline is None or time.time() < deadline:
                if radio.irq.get() == 1:
                    time.sleep(0.001)
                    continue
                status = radio.status()
                if not status & STATUS_RX_DR:
                    radio.clear_interrupts()
                    continue
                while True:
                    payload = radio.command(CMD_R_RX_PAYLOAD, bytes(args.payload_width))[1:]
                    radio.write_reg(REG_STATUS, STATUS_RX_DR)
                    ok, seq = decode(payload)
                    received += 1
                    if ok and seq is not None:
                        seqs.append(seq)
                        print(f"  rx seq={seq} payload={payload.hex(' ')} ok")
                    else:
                        bad += 1
                        print(f"  rx MALFORMED payload={payload.hex(' ')}")
                    if radio.read_reg8(REG_FIFO_STATUS) & 0x01:  # RX_EMPTY
                        break
        except KeyboardInterrupt:
            pass
        finally:
            radio.ce.set(0)

    print(f"\nreceived {received} packet(s), {bad} malformed")
    # The transmitter restarts its counter whenever it reboots, so gaps are only
    # meaningful within a run of increasing sequence numbers.
    runs: list[list[int]] = []
    for seq in seqs:
        if runs and seq > runs[-1][-1]:
            runs[-1].append(seq)
        else:
            runs.append([seq])
    for run in runs:
        span = run[-1] - run[0] + 1
        print(f"sequence {run[0]}..{run[-1]}: {len(run)} of {span}, {span - len(run)} missing")
    if len(runs) > 1:
        print(f"({len(runs)} runs — the transmitter restarted its counter)")
    return 0 if received and not bad else 1


if __name__ == "__main__":
    raise SystemExit(main())
