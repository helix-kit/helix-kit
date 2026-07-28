idf_component_register(
    SRCS
        "status_display.c"
        "generated/contracts/status_display_contract.c"
    INCLUDE_DIRS "." "generated/contracts"
    REQUIRES
        esp_driver_i2c
        json
        protocol
)
