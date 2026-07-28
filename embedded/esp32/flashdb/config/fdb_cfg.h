/*
 * FlashDB configuration for the Helix ESP32 firmware.
 *
 * KVDB only (single-table CRUD store lives on top of KVDB), FAL storage mode on
 * a dedicated `flashdb` flash partition. NOR write granularity is 1 byte.
 * SPDX-License-Identifier: Apache-2.0
 */
#ifndef _FDB_CFG_H_
#define _FDB_CFG_H_

/* Key-Value database (the only feature Helix uses). */
#define FDB_USING_KVDB

/* Time-series DB is not used; fdb_tsdb.c compiles to an empty object. */
/* #define FDB_USING_TSDB */

/* Flash Abstraction Layer backend (dedicated raw partition, native wear-levelling). */
#define FDB_USING_FAL_MODE

#ifdef FDB_USING_FAL_MODE
/* Flash write granularity in bits: 1 => NOR flash (ESP32 SPI flash). */
#define FDB_WRITE_GRAN 1
#endif

/* Little-endian MCU (ESP32). */

/* Route FlashDB logs through printf (default) so they show on the console UART. */

#endif /* _FDB_CFG_H_ */
