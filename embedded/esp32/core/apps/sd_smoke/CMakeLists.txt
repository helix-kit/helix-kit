idf_component_register(
    SRCS "sd_smoke.c"
    INCLUDE_DIRS "."
    REQUIRES
        fatfs
        sdmmc
        esp_driver_sdspi
        esp_driver_spi
        esp_driver_gpio
        esp_hw_support
)
