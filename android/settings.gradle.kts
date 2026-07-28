// SPDX-License-Identifier: AGPL-3.0-only

pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // usb-serial-for-android (CP210x/CH340/FTDI UART bridge drivers) is
        // published only via JitPack.
        maven {
            url = uri("https://jitpack.io")
            content { includeGroup("com.github.mik3y") }
        }
    }
}

rootProject.name = "helix-android"

// The Helix Android SDK: protocol (core + service) and transports (BLE, MQTT
// gateway) in one installable module.
include(":helix")

// Main app (mirror of web/apps/helix)
include(":app")
