idf_component_register(
    SRCS
        "console_bridge.c"
        "generated/contracts/console_contract.c"
    INCLUDE_DIRS "." "generated/contracts"
    REQUIRES
        esp_driver_uart
        json
        protocol
        transports
        platform
)
