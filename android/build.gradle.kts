// SPDX-License-Identifier: AGPL-3.0-only

buildscript {
    dependencies {
        // AGP 9 provides built-in Kotlin (KGP 2.2.10). Pin it up to the catalog's
        // `kotlin` version so the compiler matches the Compose/serialization
        // plugins, which are versioned off the same catalog entry.
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
