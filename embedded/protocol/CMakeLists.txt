# Shared, platform-agnostic Helix protocol core (ESP-IDF component view).
# The same src/ is consumed by the Arduino build via library.properties.
idf_component_register(
    SRCS
        "src/helix_protocol.c"
        "src/helix_json.c"
        "src/helix_binary_channel.c"
        "src/helix_service_dispatcher.c"
        "src/helix_service_endpoint.c"
    INCLUDE_DIRS "src"
    REQUIRES
        json
        freertos
)
