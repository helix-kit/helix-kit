// SPDX-License-Identifier: AGPL-3.0-only

plugins {
    alias(libs.plugins.android.library)
    // Kotlin compilation comes from AGP 9's built-in Kotlin support.
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

    // Ships as an Android library because BLE needs the platform; pure-Kotlin code runs on the JVM in tests.
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

// Point the MQTT integration test at a running gateway; unset -> the test skips.
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
