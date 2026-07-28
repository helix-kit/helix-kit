# ESP-IDF compiles every app it finds, selected or not, so this one has to stand
# down when the LVGL UI stack is not part of the build. HELIX_FEATURES is read from
# the environment because this file is also evaluated during ESP-IDF's separate
# requirements-resolution pass, which sees no project variables (see the project
# CMakeLists). Selecting the app pulls the `ui` feature in automatically.
set(HELIX_FEATURES "$ENV{HELIX_FEATURES}")
if(NOT "ui" IN_LIST HELIX_FEATURES)
    idf_component_register()
    return()
endif()

idf_component_register(
    SRCS
        "ui_demo.c"
    INCLUDE_DIRS "."
    REQUIRES
        ui
)
