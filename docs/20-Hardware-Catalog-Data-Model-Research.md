<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# 20 — Hardware Catalog: Landscape Research and Data-Model Dimensions

Date: 2026-08-03

This document is the research input to the Helix hardware catalog — a separate web
application that models embedded silicon and boards as a graph so it can answer
engineering questions ("which boards expose all four MIPI lanes the SoC provides?")
rather than merely render spec tables.

Before designing the schema, the actual variety of the market was surveyed: Raspberry Pi,
Radxa, Allwinner-based boards, Luckfox, Milk-V, Arduino, Seeed Studio, Espressif,
LattePanda and x86 SBCs, NVIDIA Jetson, and the STM32/NXP/Sophgo/Rockchip silicon behind
them. The point of the survey was not to collect specifications — it was to find the places
where these families are *structurally* different, i.e. where one family needs a field or a
relationship that another family has no use for, and where a single flat column would
destroy information.

Thirteen such structural findings emerged. Each is stated below with the concrete evidence
that forced it, followed by the modelling consequence. §14 collects the resulting dimension
list.

---

## 1. Silicon is not one processor — it is a bag of heterogeneous compute engines

The naive model ("SoC has a CPU with N cores at F GHz") fails on almost every part in the
survey.

| Silicon | Compute engines on one die |
| --- | --- |
| Rockchip RV1106 | Cortex-A7 @1.2 GHz (Linux) + RISC-V co-processor + 4th-gen NPU + ISP 3.2 + audio codec + Ethernet MAC/PHY |
| Sophgo SG2002 | RISC-V C906 @1 GHz **or** Arm Cortex-A53 (selectable) + second C906 @700 MHz + 8051 @25–300 MHz + 1 TOPS NPU + H.264/H.265 + ISP |
| Allwinner A733 | 2× Cortex-A76 @2.0 GHz + 6× Cortex-A55 @1.8 GHz + PowerVR BXM-4-64 MC1 + 3 TOPS NPU + XuanTie E902 RISC-V @200 MHz always-on |
| Rockchip RK3576 | 4× Cortex-A72 + 4× Cortex-A53 + Cortex-M0 real-time coprocessor |
| NXP i.MX 8M Mini | 4× Cortex-A53 @1.8 GHz + 1× Cortex-M4 @400 MHz |
| Espressif ESP32-C6 | HP RISC-V @160 MHz + LP RISC-V @20 MHz |
| RP2350 | 2× Cortex-M33 **or** 2× Hazard3 RISC-V @150 MHz |

Two distinct patterns appear:

- **Additive heterogeneity** — engines coexist and are used simultaneously (A76 cluster +
  A55 cluster + always-on RISC-V + NPU + ISP). Each has its own ISA, clock, and role.
- **Exclusive alternatives** — RP2350's Arm and RISC-V core pairs are *selectable in
  software or by programming on-chip OTP*; SG2002's main core is chosen at boot. These are
  not two features, they are one slot with two mutually exclusive fillings.

**Consequence.** Compute is a child table of silicon, one row per engine, carrying role
(application / real-time / low-power / always-on / security / accelerator), ISA, core
design, count, clock range, and cache. Mutually exclusive engine sets need an
*alternative-group* key so the UI can render "Arm **or** RISC-V" instead of listing eight
cores that never run at once. A flat `cpu_cores` integer is wrong for every row in that
table.

## 2. Memory lives at four different tiers, and which tier matters

- RV1103 has **64 MB on-chip** RAM; RV1106 carries **128 MB or 256 MB DDR3L in package**.
- SG2002 carries **256 MB DDR3 SiP**.
- ESP32 modules put flash and PSRAM **in the module**, not in the chip and not on the
  board: `ESP32-WROOM-32E-N4/-N8/-N16` differ only in flash, `-N4R2` adds 2 MB PSRAM.
- Radxa CM5 integrates **LPDDR4X and eMMC into the module**.
- Raspberry Pi 5 and Cubie A7Z solder LPDDR **to the board**.
- LattePanda Sigma has **16 GB soldered LPDDR5**; a Pico-ITX x86 board next to it has SODIMM
  sockets.

"256 MB RAM" is therefore an incomplete fact. Whether it is in the die, in the package, on
the module, on the board, or in a socket determines upgradability, whether it is a property
of the silicon or of the board, and whether two boards using the same SoC can differ on it.

**Consequence.** Memory rows carry a `mounting` tier (on_die / in_package_sip / on_module /
on_board_soldered / socketed) and an owner reference to whichever tier actually holds them.
The same applies to non-volatile storage: on-die flash (STM32, RP2040), in-module QSPI
(ESP32 modules, RP2350 boards), on-module eMMC (CM5), on-board eMMC/SPI-NAND (Luckfox Pico
Pro/Max carry 256 MB SPI NAND), and removable microSD.

## 3. The product hierarchy is at least four tiers deep, and vendors stop at different ones

| Vendor | Chain |
| --- | --- |
| Espressif | ESP32-S3 chip → ESP32-S3-WROOM-1 module → DevKitC board |
| Raspberry Pi | BCM2712 SoC → CM5 module → CM5 IO board; *or* BCM2712 → Pi 5 board directly |
| Radxa | RK3588S SoC → CM5 module (56×41 mm) → CM5 IO board / third-party carrier |
| NVIDIA | Orin Nano module → carrier → Developer Kit |
| Arduino | i.MX 8M Mini + STM32H747 → Portenta X8 SoM (66.04×25.40 mm) → carrier |
| Luckfox | RV1106 SoC → Pico board (no module tier) |

Certification and radio approval attach at the **module** tier and are inherited downstream:
`ESP32-WROOM-32E` holds Single Modular Approval under FCC Part 15C §15.247 with its own FCC
ID, which is precisely why board vendors buy modules instead of bare chips.

**Consequence.** One `product` entity with a `tier` enum (chip / module / som / board /
carrier / kit) plus a composition relation, rather than separate `soc`/`board` tables. A
carrier + module sold together as a kit is then expressible, and "what carriers accept this
module" becomes a query. Certifications hang off the tier that holds them and are *inherited*
by composition — modelling them only on boards duplicates one FCC ID across fifty boards.

## 4. Boards carry several silicon devices, each with a role

This is the finding that most decisively kills a single `board.soc_id` foreign key.

- **Raspberry Pi 5** pairs BCM2712 with **RP1**, an in-house I/O controller on TSMC 40LP
  connected over **PCIe 2.0 ×4 (16 Gb/s)**. The USB 3.0 ports, Gigabit Ethernet, both 4-lane
  MIPI transceivers, analogue video, and the 40-pin GPIO all belong to RP1 — *not* to the
  SoC. Answering "does this board have USB 3.0?" from the SoC's capability table gives the
  wrong answer.
- **Arduino UNO R4 WiFi** runs a Renesas RA4M1 (Cortex-M4 @48 MHz, 5 V) as the main MCU and
  an **ESP32-S3 as a Wi-Fi/BLE co-processor** at 3.3 V, bridged by a TXB0108 level
  translator. Two toolchains, two firmware images, one board.
- **Arduino Portenta X8** runs i.MX 8M Mini (4×A53 + M4) under Yocto Linux with Docker
  *and* an STM32H747 (M7 @480 MHz + M4 @240 MHz) for real-time work — nine cores, two
  operating-system classes concurrently, plus an **NXP SE050C2 secure element**.
- **LattePanda 3 Delta** = Celeron N5105 + ATmega32U4; **LattePanda Sigma** = Core i5-1340P
  + ATmega32U4. The Arduino MCU is why anyone buys the board.
- **ESP32-P4 has no radio whatsoever**; boards using it pair it with an ESP32-C6 for
  connectivity.

**Consequence.** A `product_silicon` join table with a role enum (application /
io_controller / radio / realtime_mcu / secure_element / pmic / ethernet_phy / audio_codec /
sensor_hub / power_mcu) and an interconnect description (PCIe ×4, SDIO, UART, SPI, USB).
Capability aggregation walks *all* attached silicon, and every capability records which chip
provides it.

## 5. Silicon capability and board exposure are different facts, and compatibility is graded

- **RK3588 vs RK3588S** share cores, GPU, and NPU but differ in I/O and memory ceiling:
  LPDDR4/4X/5 up to 32 GB versus LPDDR4/4X up to 16 GB.
- **CM5 in a CM4 carrier** keeps the 55×40 mm form factor and the two 100-pin connectors, so
  it is described as a drop-in upgrade — *with exceptions*: pin 16 changes from the Ethernet
  PHY SYNC_IN to FAN_TACHO, pin 19 from Ethernet rLED1 to FAN_PWM, and pins 159, 163, 165,
  169, 171 move from DSI to USB 3.0 signals. Older CM4 carriers may support CM5 only with
  reduced functionality.

A boolean `cm4_compatible` column cannot express that, and neither can prose. The honest
representation is a compatibility claim with a *level* plus an enumerated delta.

**Consequence.** Capability rows exist at the silicon tier (what the die can do) and
exposure rows at the board tier (what is routed to a connector, and how much of it).
Compatibility between two products is its own entity with a graded level — mechanical /
electrical / pin-compatible / driver-compatible / fully-tested / vendor-claimed /
community-reported / incompatible / unknown — and a list of specific pin or signal
differences.

## 6. One design spawns many orderable SKUs, and the differences are load-bearing

- **STM32** encodes the variation in the part number itself:
  `STM32<family><line><pin count><flash><package><temperature grade><options>`. Pin count,
  flash size, package, and temperature range are *positions in the ordering code*. One
  "STM32F103" is dozens of distinct orderable parts.
- **Rockchip** ships RK3588 / RK3588S / RK3588J and RK3576 / RK3576J, where the `J` suffix is
  the industrial temperature grade (the RK3588J notably drops overdrive-mode operating
  points). RK3588S is commercial-grade only — there is no industrial variant at all, which
  makes "RK3588S with industrial temp" an unsatisfiable requirement rather than a missing
  data point.
- **Espressif** ships `-N4/-N8/-N16` flash tiers, `R2/R8` PSRAM tiers, and `UE` (u.FL
  connector) versus `E` (PCB antenna, 3.40 dBi peak gain) as separate part numbers.
- **Luckfox Pico Ultra** exists as {wireless, no wireless} × {PoE HAT, no PoE} = four SKUs;
  Pico Pro and Pico Max differ only in 128 MB versus 256 MB of RAM.
- **Radxa Cubie A7Z** offers 1/2/4/8/16 GB LPDDR4/4x × 64/128/256/512 GB UFS 3.0.
- **NVIDIA Orin Nano** ships 4 GB and 8 GB, and separately "Orin Nano" versus "Orin Nano
  Super" — which is a *firmware/power* distinction, not a silicon one (see §7).

**Consequence.** `product` (the design) and `product_variant` (the orderable SKU) are
separate tables. Variants override RAM, storage, flash, package, temperature grade, antenna
type, radio region, and bundled accessories. **Vendor offers and prices attach to variants,
never to products** — the whole price-tracking subsystem is wrong if it hangs off the design.

## 7. Performance is a function of operating mode, not a scalar

- **Jetson Orin Nano Super** exposes 7 W / 15 W / 25 W Super / MAXN Super via `nvpmodel`,
  each simultaneously capping active CPU core count, CPU frequency, and GPU frequency. The
  non-Super Orin Nano 8 GB has only 7 W and 15 W. Carrier boards budget up to 45 W for module
  plus peripherals. Super Mode delivers up to 2× the AI throughput of the standard
  configuration on the same silicon.
- **Intel N5105**: 2.0 GHz base / 2.9 GHz turbo, 10 W TDP. **Core i5-1340P**: 4 P-cores +
  8 E-cores / 16 threads, 4.6 GHz P / 3.4 GHz E, 80 EU Iris Xe, 28 W PBP.
- **RK3588J** removes overdrive-mode operating points relative to RK3588.

**Consequence.** An `operating_mode` table per product-variant (name, power budget, active
core count, CPU clock cap, GPU clock cap, thermal requirement) and a hard rule that **every
benchmark result references the mode it ran in**. Without it, "Orin Nano scores X" is
unfalsifiable. This also means x86 needs its own fields (base/turbo, P/E core split, TDP vs
PBP vs PL1/PL2, EU count) that Arm SBCs do not have — an argument for typed per-family
extension rows rather than one wide table.

## 8. Accelerator throughput is meaningless without precision, and the SDK is the real gate

- RV1106: **0.5 TOPS int8**, doubling at int4, with hybrid int4/int8/int16 quantization.
- A733: **3 TOPS int8**, supporting int8/int16/fp16/fp32.
- SG2002: **1 TOPS**.
- Jetson: TOPS varies with the power mode of §7.

Helix's own edge-AI work is the cautionary tale: the A733 NPU only became usable through
third-party VIPLite/awnn tooling, its GPU needed manual OpenCL ICD registration, and the
Cedar VPU needed vendor libraries. The number on the box was never the blocker; the
toolchain was.

**Consequence.** Accelerator performance is a child table — (precision, value, unit,
conditions) — alongside a supported-precision list and, critically, a toolchain/SDK
relationship (RKNN, ACUITY/VIPLite, TensorRT, OpenVINO, Vulkan/OpenCL) with its own support
status and blob-dependency flag. A single `npu_tops` numeric column is actively misleading.

## 9. Video and imaging are asymmetric between encode and decode

- SG2002: H.264 **encode and decode**, H.265 **encode only**, plus ISP with HDR, 3D noise
  reduction, defogging, and lens-distortion correction.
- RV1106: ISP 3.2 for 5 MP sensors with HDR/WDR and multi-level noise reduction.
- ESP32-P4: hardware H.264 encode/decode, MIPI CSI and DSI.

"H.265: yes" collapses encode-only into full support and would tell a user their board can
play back a stream it can only produce.

**Consequence.** Separate decode and encode capability rows per codec, each with profile,
maximum resolution, maximum frame rate, and maximum concurrent streams. ISP gets its own row
set (max sensor resolution, lane count, HDR/WDR, NR, LDC).

## 10. Radios are a stack, and they belong to a specific tier

- ESP32-C6 integrates 2.4 GHz **Wi-Fi 6 (802.11ax)** + **Bluetooth LE 5.3** + **802.15.4**
  (Thread/Zigbee) on one die.
- ESP32-P4 integrates none.
- Cubie A7Z: Wi-Fi 6 + BT 5.4 with an external antenna.
- RV1106 SoMs exist with Wi-Fi 6 + BT 5.2 in a 112-castellated-pin package.
- WROOM-32E ships a PCB antenna (3.40 dBi peak); WROOM-32UE ships a u.FL connector instead.

**Consequence.** Radio rows (standard, generation, bands, spatial streams, protocols) are
attached to the tier that physically owns the radio, and inherited through composition.
Antennas are separate rows (type, gain, connector). Regional SKUs and certifications
(FCC ID, CE/RED, UKCA, IC, RoHS) are their own rows with identifiers, because "available in
region X" is a supply-chain question the catalog must answer.

## 11. Lifecycle commitments are dated, worded, and sourced — not a single EOL column

- Raspberry Pi 5 and CM5: in production **until at least January 2036**; Pi 4 Model B until
  at least January 2034. The wording is a *minimum* guarantee that extends if demand and
  manufacturability persist, and key silicon components are quoted as far out as 2042.
- RK3588S: commercial grade only, no industrial variant.

"Until at least" is not the same as "EOL date", and a supply-stability score built on the
wrong reading of it is worse than no score.

**Consequence.** `lifecycle_event` rows (announced / sampling / active / mature / NRND /
last-time-buy / EOL / discontinued) with dates and sources, plus a separate
`longevity_commitment` capturing the guaranteed-until date, the exact wording, and the
document it came from.

## 12. Form factors and expansion ecosystems are shared named standards

- **Seeed XIAO**: one 21 × 17.5 mm footprint shared by SAMD21, RP2040, RP2350, nRF52840,
  ESP32-C3, ESP32-C6, RA4M1, and MG24 variants. The footprint is the reusable asset — users
  choose an MCU *within* a fixed mechanical and pin contract.
- **CM4/CM5**: 55 × 40 mm, two 100-pin high-density connectors (Radxa CM5 is 56 × 41 mm and
  claims compatibility with both the CM5 IO board and the Raspberry Pi CM4 IO board).
- Industry module standards: **SMARC 2.1** (positioned between Qseven and COM Express, with
  more embedded-vision-oriented interfaces), **Qseven**, **COM Express**, **96Boards** (the
  first pseudo-official Arm SBC form-factor standard), **Pico-ITX** (100 × 72 mm).
- Expansion connectors: 40-pin Pi HAT, mikroBUS, Qwiic (the UNO R4 has one), Grove, M.2
  keys, mini-PCIe, FPC camera/display connectors.

**Consequence.** `form_factor` and `connector_standard` are first-class entities in
many-to-many relations with products, so "what else fits this carrier" and "which boards
accept this shield" are queries. Note that x86 embedded is COM-dominated while Arm is
SBC-dominated, so the catalog must not assume every product has a carrier.

## 13. Software support is per-component, per-source, and frequently the deciding factor

The UNO R4 needs two toolchains on one board. The Portenta X8 runs Yocto plus Docker
containers on the A53s while the M4 and the STM32H747 run bare-metal. The A733's GPU, VPU,
and NPU each had a different support story in Helix's own bring-up.

**Consequence.** Support is a row per (product, component, software platform): mainline
status, vendor-kernel status, kernel/BSP version, blob dependency, and the evidence URL.
A board-level "Linux: supported" boolean is the single most misleading field a catalog of
this kind can offer.

---

## 14. Derived dimension list

The findings above reduce to the following entity set for the catalog schema. Numbers in
brackets cite the finding that forces the entity to exist.

**Taxonomy / reference**
`manufacturer`, `architecture` (ISA + extensions), `core_design` (CPU/GPU/NPU/DSP/ISP/FPGA
micro-architecture) [1], `form_factor` [12], `connector_standard` [12], `software_platform`
(Linux distro, RTOS, Android, bootloader, SDK) [13], `certification_authority` [10].

**Silicon**
`silicon` (chip design), `silicon_variant` (ordering code: temp grade, package, speed bin)
[6], `silicon_compute_unit` (one row per engine, with role and alternative-group) [1],
`silicon_memory_support` [2], `silicon_interface` (peripheral capability with count and
version) [5], `silicon_media_codec` (encode and decode separately) [9],
`silicon_accelerator_performance` (per precision) [8], `silicon_radio` [10],
`silicon_security_feature`.

**Products**
`product` with a tier enum (chip/module/som/board/carrier/kit) [3], `product_variant` (the
orderable SKU, which offers attach to) [6], `product_silicon` (role + interconnect) [4],
`product_memory` / `product_storage` (with mounting tier) [2], `product_exposed_interface`
(what is actually routed out, and how much) [5], `product_connector` (headers, sockets,
FPC), `product_power_input`, `operating_mode` [7], `product_antenna` [10],
`product_certification` [10], `product_form_factor` [12].

**Relations and history**
`compatibility_claim` (graded, with signal-level deltas) [5][12], `lifecycle_event` and
`longevity_commitment` [11], `software_support_claim` (per component) [13],
`revision` (board revisions and their deltas).

**Provenance (cross-cutting)**
`source`, `claim`, and `evidence` linking every non-trivial value to where it came from,
with a trust hierarchy (datasheet > reference manual > schematic > official product page >
distributor page > review > community report) and explicit conflict retention. Agents are
first-class writers, so provenance is a structural requirement, not a nicety.

**Commerce (later phase, but the shape is fixed now)**
`vendor`, `offer` (against a **variant**), `price_observation`, `inventory_observation`.

### Cross-cutting rules the schema must enforce

1. Capability is recorded once at the tier that owns it and **inherited by composition** —
   never duplicated down onto boards [3][4][10].
2. Every capability row records **which silicon provides it** [4].
3. Silicon capability and board exposure are separate rows; the delta between them is the
   interesting query [5].
4. Compatibility and support are **graded enums with evidence**, never booleans [5][13].
5. Offers, prices, and stock attach to `product_variant`, never `product` [6].
6. Every performance number carries its operating mode and, for accelerators, its precision
   [7][8].
7. Anything a flat column would flatten — codecs, radios, memory tiers, power modes, part
   variants — is a child table.

---

## Sources

- [Luckfox Pico (RV1106/RV1103)](https://www.luckfox.com/Luckfox-Pico) ·
  [Luckfox Pico Pro](https://www.luckfox.com/EN-Luckfox-Pico-Pro) ·
  [Luckfox Pico Ultra](https://www.luckfox.com/EN-Luckfox-Pico-Ultra) ·
  [CNX: Luckfox Pico Pro/Max](https://www.cnx-software.com/2024/02/29/luckfox-pico-pro-pico-max-rockchip-rv1106-boards-100m-ethernet-5mp-camera/) ·
  [CNX: Luckfox Pico Mini](https://www.cnx-software.com/2024/08/16/luckfox-pico-mini-tiny-arm-linux-camera-board-rockchip-rv1103-64mb-ram/) ·
  [CNX: RV1106 SoM with 112 castellated pins](https://www.cnx-software.com/2025/01/21/solderable-rockchip-rv1106-system-on-module-features-112-castellated-pins-offers-wifi-6-and-bluetooth-5-2-connectivity/)
- [Raspberry Pi RP2350](https://www.raspberrypi.com/products/rp2350/) ·
  [element14: Pico 2 / RP2350 dual Arm + RISC-V](https://community.element14.com/products/raspberry-pi/b/blog/posts/introducing-the-raspberry-pi-pico-2---with-rp2350-dual-arm-cortex-m33-and-dual-risc-v-hazard3)
- [Espressif: UNO R4 WiFi with ESP32-S3 coprocessor](https://www.espressif.com/en/news/UNO_R4_WiFi_ESP32-S3) ·
  [Arduino UNO R4 WiFi datasheet](https://docs.arduino.cc/resources/datasheets/ABX00087-datasheet.pdf) ·
  [RA4M1 + ESP32-S3 hybrid architecture](https://leebinder.com/ra4m1-esp32s3-hybrid-architecture/)
- [Arduino Portenta X8](https://docs.arduino.cc/hardware/portenta-x8) ·
  [Portenta X8 datasheet](https://docs.arduino.cc/resources/datasheets/ABX00049-datasheet.pdf) ·
  [LinuxGizmos: Arduino returns to Linux with Portenta X8](https://linuxgizmos.com/arduino-returns-to-linux-with-portenta-x8-module-and-dev-kit/)
- [NVIDIA: JetPack 6.2 Super Mode for Orin Nano / Orin NX](https://developer.nvidia.com/blog/nvidia-jetpack-6-2-brings-super-mode-to-nvidia-jetson-orin-nano-and-jetson-orin-nx-modules) ·
  [Premio: What is Super Mode](https://premioinc.com/blogs/blog/what-is-super-mode-on-nvidia-jetson-orin-nano-and-jetson-orin-nx-modules-in-jetpack-6-2-sdk-release)
- [Espressif ESP32-C6](https://www.espressif.com/en/products/socs/esp32-c6) ·
  [WizzDev: ESP32-S3 vs C6 vs P4](https://wizzdev.com/blog/espressif-soc-esp32/) ·
  [ESP32-WROOM-32E / 32UE datasheet](https://documentation.espressif.com/esp32-wroom-32e_esp32-wroom-32ue_datasheet_en.html) ·
  [FCC ID filing, ESP32-WROOM-32E](https://fcc.report/FCC-ID/2AC7Z-ESP32WROOM32E/4684794.pdf)
- [CNX: LattePanda 3 Delta](https://www.cnx-software.com/2022/08/12/lattepanda-3-delta-sbc-intel-jasper-lake-processor-arduino-microcontroller/) ·
  [CNX: LattePanda Sigma](https://www.cnx-software.com/2023/04/26/lattepanda-sigma-intel-core-i5-1340p-raptor-lake-sbc-atmega32u4-arduino-mcu/) ·
  [LattePanda 3 Delta specification](https://docs.lattepanda.com/content/3rd_delta_edition/specification/)
- [Seeed XIAO series introduction](https://wiki.seeedstudio.com/SeeedStudio_XIAO_Series_Introduction/) ·
  [XIAO series SOM datasheet](https://files.seeedstudio.com/wiki/XIAO/Seeed-Studio-XIAO-Series-SOM-Datasheet.pdf)
- [Raspberry Pi Compute Module hardware documentation](https://www.raspberrypi.com/documentation/computers/compute-module.html) ·
  [Migrating from CM4 to CM5](https://www.epdtonthenet.net/article/214508/Key-Considerations-When-Migrating-from-Raspberry-Pi-CM4-to-CM5.aspx) ·
  [Radxa CM5](https://radxa.com/products/cm/cm5/)
- [Raspberry Pi: RP1, the silicon controlling Pi 5 I/O](https://www.raspberrypi.com/news/rp1-the-silicon-controlling-raspberry-pi-5-i-o-designed-here-at-raspberry-pi/) ·
  [Raspberry Pi I/O controllers documentation](https://www.raspberrypi.com/documentation/computers/io-controllers.html) ·
  [RP1 peripherals datasheet](https://datasheets.raspberrypi.com/rp1/rp1-peripherals.pdf)
- [Raspberry Pi: commitment to longevity](https://www.raspberrypi.com/news/raspberry-pis-commitment-to-longevity-a-sustainable-advantage/) ·
  [Raspberry Pi longevity document](https://pip-assets.raspberrypi.com/categories/1258-marketing-material/documents/RP-008008-MM-1-250304%20Raspberry%20Pi%20Longevity%20Marketing%20Doc.pdf)
- [Rockchips.net: RK3588 vs RK3588S](https://rockchips.net/rk3588-vs-rk3588s-in-depth-technical-comparison/) ·
  [BLIIoT: RK3576J vs RK3588S](https://bliiot.com/info-detail/deep-comparison-between-rk3576j-and-rk3588s-processors) ·
  [LKML: remove overdrive-mode OPPs from RK3588J](https://lkml.iu.edu/hypermail/linux/kernel/2503.3/00399.html)
- [CNX: Radxa Cubie A7Z](https://www.cnx-software.com/2025/08/25/pi-zero-sized-radxa-cubie-a7z-sbc-features-allwinner-a733-cortex-a76-a55-soc-up-to-16gb-ram-wifi-6/) ·
  [Radxa Cubie A7Z docs](https://docs.radxa.com/en/cubie/a7z) ·
  [Radxa Cubie A7Z product brief](https://dl.radxa.com/cubie/a7z/docs/radxa_cubie_a7z_product_brief.pdf)
- [Milk-V Duo overview](https://milkv.io/docs/duo/overview) ·
  [Milk-V SG2002](https://milkv.io/chips/sg2002) ·
  [Electronics-Lab: Milk-V Duo 256M](https://www.electronics-lab.com/milk-v-duo-256m-is-an-sg2002-powered-multi-architecture-sbc-priced-at-7-99/)
- [STM32 naming convention (ST community)](https://community.st.com/t5/stm32-mcus-products/where-i-can-find-the-stm32-naming-convention-in-order-to/td-p/339607) ·
  [Deciphering STM32 MCU naming](https://ziutek.github.io/2018/05/07/stm32_naming_scheme.html)
- [congatec: SMARC 2.1](https://www.congatec.com/us/technologies/smarc/) ·
  [BVM: COM Express vs Qseven vs SMARC](https://www.bvm.co.uk/faq/a-comparison-of-modular-embedded-computing-standards/) ·
  [Linaro 96Boards SBC standard](https://www.linux.com/news/linaro-launches-96boards-sbc-standard-and-first-armv8-board/)
