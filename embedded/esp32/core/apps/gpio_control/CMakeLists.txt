idf_component_register(
    SRCS
        "gpio_control.c"
        "generated/contracts/gpio_control_contract.c"
    INCLUDE_DIRS "." "generated/contracts"
    REQUIRES
        esp_driver_gpio
        json
        protocol
        status_display
)
