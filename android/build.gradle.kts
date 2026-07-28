// SPDX-License-Identifier: AGPL-3.0-only

buildscript {
    dependencies {
        // Pin AGP 9's built-in Kotlin up to the catalog version so it matches the plugins.
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.0")
    }
}

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.compose.compiler) apply false
}
