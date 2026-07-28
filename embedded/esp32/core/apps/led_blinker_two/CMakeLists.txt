idf_component_register(
    SRCS "led_blinker_two.c"
    INCLUDE_DIRS "."
    REQUIRES
        esp_driver_gpio
)
