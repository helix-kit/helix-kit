"""nRF24L01(+) driver for Linux boards, talking to spidev and gpiochip via ioctl.

Deliberately dependency-free: it runs on a stock python3 with no python3-spidev
or python3-libgpiod, so a board needs no extra packages to be brought up. The
GPIO character device is held open for the lifetime of the object because a
released line reverts to input, which would drop CE mid-transmit.
"""

from __future__ import annotations

import array
import contextlib
import ctypes
import fcntl
import os
import struct
import time

_IOC_WRITE = 1
_IOC_READ = 2


def _ioc(direction: int, type_: int, nr: int, size: int) -> int:
    return (direction << 30) | (size << 16) | (type_ << 8) | nr


SPI_IOC_WR_MODE = _ioc(_IOC_WRITE, ord("k"), 1, 1)
SPI_IOC_WR_BITS_PER_WORD = _ioc(_IOC_WRITE, ord("k"), 3, 1)
SPI_IOC_WR_MAX_SPEED_HZ = _ioc(_IOC_WRITE, ord("k"), 4, 4)

_SPI_TRANSFER_SIZE = 32
SPI_IOC_MESSAGE_1 = _ioc(_IOC_WRITE, ord("k"), 0, _SPI_TRANSFER_SIZE)

_GPIO_HANDLE_SIZE = 64 * 4 + 4 + 64 + 32 + 4 + 4
GPIO_GET_LINEHANDLE_IOCTL = _ioc(_IOC_READ | _IOC_WRITE, 0xB4, 0x03, _GPIO_HANDLE_SIZE)
GPIOHANDLE_GET_LINE_VALUES_IOCTL = _ioc(_IOC_READ | _IOC_WRITE, 0xB4, 0x08, 64)
GPIOHANDLE_SET_LINE_VALUES_IOCTL = _ioc(_IOC_READ | _IOC_WRITE, 0xB4, 0x09, 64)

GPIOHANDLE_REQUEST_INPUT = 1 << 0
GPIOHANDLE_REQUEST_OUTPUT = 1 << 1

CMD_R_REGISTER = 0x00
CMD_W_REGISTER = 0x20
CMD_R_RX_PAYLOAD = 0x61
CMD_W_TX_PAYLOAD = 0xA0
CMD_FLUSH_TX = 0xE1
CMD_FLUSH_RX = 0xE2
CMD_NOP = 0xFF

REG_CONFIG = 0x00
REG_EN_AA = 0x01
REG_EN_RXADDR = 0x02
REG_SETUP_AW = 0x03
REG_SETUP_RETR = 0x04
REG_RF_CH = 0x05
REG_RF_SETUP = 0x06
REG_STATUS = 0x07
REG_OBSERVE_TX = 0x08
REG_RX_ADDR_P0 = 0x0A
REG_TX_ADDR = 0x10
REG_RX_PW_P0 = 0x11
REG_FIFO_STATUS = 0x17
REG_DYNPD = 0x1C
REG_FEATURE = 0x1D

STATUS_MAX_RT = 0x10
STATUS_TX_DS = 0x20
STATUS_RX_DR = 0x40

CONFIG_PWR_UP = 0x02
CONFIG_PRIM_RX = 0x01
CONFIG_EN_CRC = 0x08

RF_SETUP_RF_DR_LOW = 0x20

ADDR_WIDTH = 5

POWER_ON_DEFAULTS = (
    (REG_CONFIG, "CONFIG", 0x08),
    (REG_EN_AA, "EN_AA", 0x3F),
    (REG_EN_RXADDR, "EN_RXADDR", 0x03),
    (REG_SETUP_AW, "SETUP_AW", 0x03),
    (REG_SETUP_RETR, "SETUP_RETR", 0x03),
    (REG_RF_CH, "RF_CH", 0x02),
)


class GpioLine:
    """A single gpiochip line held open, so its direction and value persist."""

    def __init__(self, chip: str, offset: int, output: bool, consumer: str = "nrf24") -> None:
        self._chip_fd = os.open(chip, os.O_RDWR)
        flags = GPIOHANDLE_REQUEST_OUTPUT if output else GPIOHANDLE_REQUEST_INPUT
        payload = bytearray(_GPIO_HANDLE_SIZE)
        struct.pack_into("<I", payload, 0, offset)
        struct.pack_into("<I", payload, 64 * 4, flags)
        payload[64 * 4 + 4] = 0
        label = consumer.encode()[:31]
        payload[64 * 4 + 4 + 64 : 64 * 4 + 4 + 64 + len(label)] = label
        struct.pack_into("<i", payload, 64 * 4 + 4 + 64 + 32, 1)
        buf = array.array("B", payload)
        fcntl.ioctl(self._chip_fd, GPIO_GET_LINEHANDLE_IOCTL, buf, True)
        self._fd = struct.unpack_from("<i", buf, 64 * 4 + 4 + 64 + 32 + 4)[0]
        if self._fd < 0:
            raise OSError(f"gpiochip {chip} line {offset}: no handle returned")

    def set(self, value: int) -> None:
        data = array.array("B", bytes([1 if value else 0]) + bytes(63))
        fcntl.ioctl(self._fd, GPIOHANDLE_SET_LINE_VALUES_IOCTL, data, True)

    def get(self) -> int:
        data = array.array("B", bytes(64))
        fcntl.ioctl(self._fd, GPIOHANDLE_GET_LINE_VALUES_IOCTL, data, True)
        return data[0]

    def close(self) -> None:
        for fd in (self._fd, self._chip_fd):
            with contextlib.suppress(OSError):
                os.close(fd)


class NRF24:
    def __init__(
        self,
        spidev: str = "/dev/spidev1.0",
        gpiochip: str = "/dev/gpiochip0",
        ce_line: int = 312,
        irq_line: int = 313,
        speed_hz: int = 4_000_000,
    ) -> None:
        self._spi = os.open(spidev, os.O_RDWR)
        fcntl.ioctl(self._spi, SPI_IOC_WR_MODE, struct.pack("B", 0))
        fcntl.ioctl(self._spi, SPI_IOC_WR_BITS_PER_WORD, struct.pack("B", 8))
        fcntl.ioctl(self._spi, SPI_IOC_WR_MAX_SPEED_HZ, struct.pack("<I", speed_hz))
        self._speed_hz = speed_hz
        self.ce = GpioLine(gpiochip, ce_line, output=True)
        self.irq = GpioLine(gpiochip, irq_line, output=False)
        self.ce.set(0)

    def close(self) -> None:
        self.ce.close()
        self.irq.close()
        os.close(self._spi)

    def __enter__(self) -> NRF24:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def xfer(self, data: bytes) -> bytes:
        tx = ctypes.create_string_buffer(bytes(data), len(data))
        rx = ctypes.create_string_buffer(len(data))
        transfer = struct.pack(
            "<QQIIHBBBBH",
            ctypes.addressof(tx),
            ctypes.addressof(rx),
            len(data),
            self._speed_hz,
            0,  # delay_usecs
            8,  # bits_per_word
            0,  # cs_change
            0,  # tx_nbits
            0,  # rx_nbits
            0,  # pad
        )
        fcntl.ioctl(self._spi, SPI_IOC_MESSAGE_1, transfer)
        return rx.raw

    def read_reg(self, reg: int, length: int = 1) -> bytes:
        return self.xfer(bytes([CMD_R_REGISTER | (reg & 0x1F)]) + bytes(length))[1:]

    def read_reg8(self, reg: int) -> int:
        return self.read_reg(reg, 1)[0]

    def write_reg(self, reg: int, value: bytes | int) -> int:
        payload = bytes([value]) if isinstance(value, int) else bytes(value)
        return self.xfer(bytes([CMD_W_REGISTER | (reg & 0x1F)]) + payload)[0]

    def command(self, cmd: int, payload: bytes = b"") -> bytes:
        return self.xfer(bytes([cmd]) + payload)

    def status(self) -> int:
        return self.xfer(bytes([CMD_NOP]))[0]

    def clear_interrupts(self) -> None:
        self.write_reg(REG_STATUS, STATUS_RX_DR | STATUS_TX_DS | STATUS_MAX_RT)

    def restore_power_on_defaults(self) -> None:
        """Resetting the host does not power-cycle the radio, so undo prior runs' writes."""
        for reg, _name, value in POWER_ON_DEFAULTS:
            self.write_reg(reg, value)
        self.write_reg(REG_TX_ADDR, b"\xe7" * ADDR_WIDTH)
        self.write_reg(REG_RX_ADDR_P0, b"\xe7" * ADDR_WIDTH)
        self.write_reg(REG_DYNPD, 0x00)
        self.write_reg(REG_FEATURE, 0x00)
        self.clear_interrupts()
        self.command(CMD_FLUSH_TX)
        self.command(CMD_FLUSH_RX)

    def pulse_ce(self, seconds: float = 20e-6) -> None:
        self.ce.set(1)
        time.sleep(seconds)
        self.ce.set(0)
