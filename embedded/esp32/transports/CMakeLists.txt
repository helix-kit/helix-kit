# ESP-only Helix transports (serial/UART, MQTT, WebSocket, BLE). The protocol
# core they carry lives in the shared `protocol` component (REQUIRES below).
idf_component_register(
    SRCS
        "src/helix_ble_profile.c"
        "src/helix_transport_ble.c"
        "src/helix_transport_mqtt.c"
        "src/helix_transport_serial.c"
        "src/helix_transport_websocket.c"
        "src/helix_stream.c"
    INCLUDE_DIRS "include"
    REQUIRES
        protocol
        bt
        esp_http_server
        esp_websocket_client
        esp_driver_uart
        json
        mqtt
)
