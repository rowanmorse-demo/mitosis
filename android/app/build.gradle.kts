import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.mitosisgame.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.mitosisgame.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "2.1.0"
        // Where the app finds the Mitosis server (WebSocket relay + ATP API).
        buildConfigField("String", "SERVER_URL", "\"http://51.81.81.166:3000\"")
        // Sign in with Google: the *web* OAuth client id from Google Cloud Console (plus an Android client
        // registered with this package name and the signing key's SHA-1). Empty hides the Google button.
        // The server must list the same id in GOOGLE_CLIENT_IDS.
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"\"")
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

// The whole game is ../../index.html at the repo root. Copy it into the APK's
// assets on every build so the app and the website always ship the same game.
val webDir = layout.buildDirectory.dir("generated/web")
val copyWeb by tasks.registering(Copy::class) {
    from(rootProject.file("../index.html"))
    into(webDir)
}
android.sourceSets.getByName("main").assets.srcDir(webDir)
tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.android.billingclient:billing-ktx:7.1.1")
    // Sign in with Google (Credential Manager)
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
