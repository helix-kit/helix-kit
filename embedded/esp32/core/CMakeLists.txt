cmake_minimum_required(VERSION 3.16)

# The feature fragments this build was configured with (`--feature ui`, plus any a
# selected app declares in apps/manifest.json), passed by the `helix` CLI. ESP-IDF
# compiles every component it can see, so an optional stack has to be kept out of
# the component list entirely rather than switched off inside it -- otherwise every
# build in the repository pays for LVGL.
#
# It has to travel in the environment, not a cache variable: ESP-IDF resolves
# component requirements in a separate CMake process that inherits the environment
# but neither the project's variables nor its cache, and an app that guards its
# `REQUIRES` on this flag must be read the same way in both passes.
set(HELIX_FEATURES "$ENV{HELIX_FEATURES}")
set(HELIX_UI_ENABLED FALSE)
if("ui" IN_LIST HELIX_FEATURES)
    set(HELIX_UI_ENABLED TRUE)
endif()

file(GLOB APP_COMPONENT_DIRS CONFIGURE_DEPENDS
    "${CMAKE_SOURCE_DIR}/apps/*"
)

# The Helix protocol core is shared with the Arduino build and lives above the
# esp32 tree at embedded/protocol; the ESP-only transports stay under esp32.
set(HELIX_ESP32_PROTOCOL_COMPONENT_DIR "")
if(DEFINED ENV{HELIX_ESP32_PROTOCOL_COMPONENT_DIR})
    set(HELIX_ESP32_PROTOCOL_COMPONENT_DIR "$ENV{HELIX_ESP32_PROTOCOL_COMPONENT_DIR}")
elseif(EXISTS "${CMAKE_SOURCE_DIR}/../../protocol/CMakeLists.txt")
    set(HELIX_ESP32_PROTOCOL_COMPONENT_DIR "${CMAKE_SOURCE_DIR}/../../protocol")
elseif(EXISTS "/repo/embedded/protocol/CMakeLists.txt")
    set(HELIX_ESP32_PROTOCOL_COMPONENT_DIR "/repo/embedded/protocol")
else()
    message(FATAL_ERROR "Helix protocol component not found. Set HELIX_ESP32_PROTOCOL_COMPONENT_DIR=/path/to/protocol.")
endif()

set(HELIX_ESP32_TRANSPORTS_COMPONENT_DIR "")
if(DEFINED ENV{HELIX_ESP32_TRANSPORTS_COMPONENT_DIR})
    set(HELIX_ESP32_TRANSPORTS_COMPONENT_DIR "$ENV{HELIX_ESP32_TRANSPORTS_COMPONENT_DIR}")
elseif(EXISTS "${CMAKE_SOURCE_DIR}/../transports/CMakeLists.txt")
    set(HELIX_ESP32_TRANSPORTS_COMPONENT_DIR "${CMAKE_SOURCE_DIR}/../transports")
elseif(EXISTS "/repo/embedded/esp32/transports/CMakeLists.txt")
    set(HELIX_ESP32_TRANSPORTS_COMPONENT_DIR "/repo/embedded/esp32/transports")
else()
    message(FATAL_ERROR "Helix ESP32 transports component not found. Set HELIX_ESP32_TRANSPORTS_COMPONENT_DIR=/path/to/transports.")
endif()

set(HELIX_ESP32_PLATFORM_COMPONENT_DIR "")
if(DEFINED ENV{HELIX_ESP32_PLATFORM_COMPONENT_DIR})
    set(HELIX_ESP32_PLATFORM_COMPONENT_DIR "$ENV{HELIX_ESP32_PLATFORM_COMPONENT_DIR}")
elseif(EXISTS "${CMAKE_SOURCE_DIR}/../platform/CMakeLists.txt")
    set(HELIX_ESP32_PLATFORM_COMPONENT_DIR "${CMAKE_SOURCE_DIR}/../platform")
elseif(EXISTS "/repo/embedded/esp32/platform/CMakeLists.txt")
    set(HELIX_ESP32_PLATFORM_COMPONENT_DIR "/repo/embedded/esp32/platform")
else()
    message(FATAL_ERROR "Helix ESP32 platform component not found. Set HELIX_ESP32_PLATFORM_COMPONENT_DIR=/path/to/platform.")
endif()

set(APP_COMPONENTS "")
foreach(APP_COMPONENT_DIR ${APP_COMPONENT_DIRS})
    if(IS_DIRECTORY "${APP_COMPONENT_DIR}" AND EXISTS "${APP_COMPONENT_DIR}/CMakeLists.txt")
        list(APPEND APP_COMPONENTS "${APP_COMPONENT_DIR}")
    endif()
endforeach()

# The Helix UI core (LVGL screens + display seam) is shared with Linux devices
# and lives at the repository root, above the embedded tree. Only builds that ask
# for the `ui` feature get it -- see HELIX_UI_ENABLED above.
set(HELIX_UI_COMPONENT_DIR "")
if(HELIX_UI_ENABLED)
    if(DEFINED ENV{HELIX_UI_COMPONENT_DIR})
        set(HELIX_UI_COMPONENT_DIR "$ENV{HELIX_UI_COMPONENT_DIR}")
    elseif(EXISTS "${CMAKE_SOURCE_DIR}/../../../ui/CMakeLists.txt")
        set(HELIX_UI_COMPONENT_DIR "${CMAKE_SOURCE_DIR}/../../../ui")
    elseif(EXISTS "/repo/ui/CMakeLists.txt")
        set(HELIX_UI_COMPONENT_DIR "/repo/ui")
    else()
        message(FATAL_ERROR "Helix UI component not found. Set HELIX_UI_COMPONENT_DIR=/path/to/ui.")
    endif()
endif()

set(HELIX_ESP32_FLASHDB_COMPONENT_DIR "")
if(DEFINED ENV{HELIX_ESP32_FLASHDB_COMPONENT_DIR})
    set(HELIX_ESP32_FLASHDB_COMPONENT_DIR "$ENV{HELIX_ESP32_FLASHDB_COMPONENT_DIR}")
elseif(EXISTS "${CMAKE_SOURCE_DIR}/../flashdb/CMakeLists.txt")
    set(HELIX_ESP32_FLASHDB_COMPONENT_DIR "${CMAKE_SOURCE_DIR}/../flashdb")
elseif(EXISTS "/repo/embedded/esp32/flashdb/CMakeLists.txt")
    set(HELIX_ESP32_FLASHDB_COMPONENT_DIR "/repo/embedded/esp32/flashdb")
else()
    message(FATAL_ERROR "Helix ESP32 flashdb component not found. Set HELIX_ESP32_FLASHDB_COMPONENT_DIR=/path/to/flashdb.")
endif()

set(LOCAL_COMPONENT_DIRS
    "${HELIX_ESP32_PROTOCOL_COMPONENT_DIR}"
    "${HELIX_ESP32_TRANSPORTS_COMPONENT_DIR}"
    "${HELIX_ESP32_PLATFORM_COMPONENT_DIR}"
    "${HELIX_ESP32_FLASHDB_COMPONENT_DIR}"
    "${CMAKE_SOURCE_DIR}/generated/app_selection"
    ${APP_COMPONENTS}
)

if(HELIX_UI_ENABLED)
    list(APPEND LOCAL_COMPONENT_DIRS "${HELIX_UI_COMPONENT_DIR}")
endif()

if(DEFINED ENV{IDF_PATH})
    list(APPEND LOCAL_COMPONENT_DIRS "$ENV{IDF_PATH}/examples/common_components/protocol_examples_common")
endif()

set(EXTRA_COMPONENT_DIRS ${LOCAL_COMPONENT_DIRS})

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(esp32_firmware)
