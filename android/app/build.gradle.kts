plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.danieltr048.xeque"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.danieltr048.xeque"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }
    val releaseStore = providers.environmentVariable("XEQUE_KEYSTORE").orNull
    if (releaseStore != null) {
        signingConfigs.create("release") {
            storeFile = file(releaseStore)
            storePassword = providers.environmentVariable("XEQUE_STORE_PASSWORD").orNull
            keyAlias = providers.environmentVariable("XEQUE_KEY_ALIAS").orNull
            keyPassword = providers.environmentVariable("XEQUE_KEY_PASSWORD").orNull
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (releaseStore != null) signingConfig = signingConfigs.getByName("release")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    // Every install keeps both languages available without network access.
    bundle { language { enableSplit = false } }
}

dependencies { testImplementation("junit:junit:4.13.2") }

tasks.named("preBuild") {
    doFirst {
        listOf("pt.json", "en.json", "common.json").forEach { name ->
            check(file("src/main/assets/dictionaries/$name").isFile) {
                "Missing offline dictionary $name. Run node scripts/prepare-android-assets.mjs from the repository root before building."
            }
        }
    }
}
