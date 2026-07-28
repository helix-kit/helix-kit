// SPDX-License-Identifier: AGPL-3.0-only

plugins {
    alias(libs.plugins.android.library)
    // Kotlin compilation is provided by AGP 9's built-in Kotlin support; the
    // standalone org.jetbrains.kotlin.android plugin is no longer applied.
    alias(libs.plugins.kotlin.serialization)
    `maven-publish`
}

group = "dev.helix"
version = "0.0.1"

android {
    namespace = "dev.helix"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // The Helix Android SDK: protocol (core + service) and transports (BLE, MQTT
    // gateway) in one installable module. BLE needs the Android platform, so the
    // whole SDK ships as an Android library; the pure-Kotlin protocol/service/
    // mqtt code runs on the JVM in local unit tests.
    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    api(libs.kotlinx.serialization.json)
    api(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.okhttp)
    implementation(libs.usb.serial)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}

// Point the MQTT integration test at a running Helix gateway (the appliance, via
// `helix e2e run`). A Gradle property survives daemon reuse where a stale env
// would not; an env var is accepted too for a quick local run. Unset -> the test
// skips, so `check` stays green without a gateway.
tasks.withType<Test>().configureEach {
    val gatewayUrl = providers.gradleProperty("mqttGatewayUrl").orNull
        ?: System.getenv("HELIX_MQTT_GATEWAY_URL")
    val deviceId = providers.gradleProperty("mqttDeviceId").orNull
        ?: System.getenv("HELIX_MQTT_DEVICE_ID")
    gatewayUrl?.let { systemProperty("helix.mqtt.gatewayUrl", it) }
    deviceId?.let { systemProperty("helix.mqtt.deviceId", it) }
}

publishing {
    publications {
        register<MavenPublication>("release") {
            afterEvaluate {
                from(components["release"])
            }
            artifactId = "helix"
        }
    }
}
