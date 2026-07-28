# Vendored FlashDB (armink/FlashDB, Apache-2.0) + FAL layer, ported to ESP-IDF
# via esp_partition. KVDB only; TSDB source compiles empty (FDB_USING_TSDB unset).
idf_component_register(
    SRCS
        "src/fdb.c"
        "src/fdb_kvdb.c"
        "src/fdb_tsdb.c"
        "src/fdb_utils.c"
        "fal/src/fal.c"
        "fal/src/fal_flash.c"
        "fal/src/fal_partition.c"
        "porting/fal_flash_esp_partition.c"
    INCLUDE_DIRS "inc" "fal/inc" "config"
    REQUIRES
        spi_flash
        esp_partition
)

# Third-party code: don't let the project's -Werror fail the build on upstream
# style warnings.
target_compile_options(${COMPONENT_LIB} PRIVATE -Wno-error -Wno-unused-parameter -Wno-unused-variable)
