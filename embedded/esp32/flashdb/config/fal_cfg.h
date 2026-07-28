/*
 * FAL (Flash Abstraction Layer) configuration for Helix.
 *
 * One flash device (`norflash0`) backed by the ESP-IDF `flashdb` partition
 * (see partitions_8mb.csv, type 0x40) via esp_partition. One FAL sub-partition
 * `fdb_kvdb1` spanning the whole device holds the KVDB.
 * SPDX-License-Identifier: Apache-2.0
 */
#ifndef _FAL_CFG_H_
#define _FAL_CFG_H_

#define FAL_PART_HAS_TABLE_CFG
#define NOR_FLASH_DEV_NAME "norflash0"

/* Size of the `flashdb` esp_partition. MUST equal the CSV partition size and
 * the .len of nor_flash0 in fal_flash_esp_partition.c. */
#define HELIX_FLASHDB_PART_LEN (128 * 1024)

extern const struct fal_flash_dev nor_flash0;

#define FAL_FLASH_DEV_TABLE \
{                           \
    &nor_flash0,            \
}

#ifdef FAL_PART_HAS_TABLE_CFG
#define FAL_PART_TABLE                                                                       \
{                                                                                           \
    {FAL_PART_MAGIC_WORD, "fdb_kvdb1", NOR_FLASH_DEV_NAME, 0, HELIX_FLASHDB_PART_LEN, 0},   \
}
#endif /* FAL_PART_HAS_TABLE_CFG */

#endif /* _FAL_CFG_H_ */
