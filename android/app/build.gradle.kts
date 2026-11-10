import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing with the Play upload key, which never goes in the repository. Either android/keystore.properties
// (storeFile, storePassword, keyAlias, keyPassword; ignored by git) or the MITOSIS_UPLOAD_STORE_FILE,
// MITOSIS_UPLOAD_STORE_PASSWORD, MITOSIS_UPLOAD_KEY_ALIAS and MITOSIS_UPLOAD_KEY_PASSWORD environment variables.
// With neither, bundleRelease makes an unsigned AAB. See android/RELEASE.md.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.isFile) f.inputStream().use { load(it) }
}
fun signing(key: String, env: String): String? = keystoreProps.getProperty(key) ?: System.getenv(env)
val uploadStoreFile = signing("storeFile", "MITOSIS_UPLOAD_STORE_FILE")

android {
    namespace = "com.mitosisgame.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.mitosisgame.app"
        minSdk = 26
        targetSdk = 36          // Android 16: what Google Play requires of new apps and updates from 31 August 2026
        versionCode = 10        // every upload to Play needs a higher versionCode than the last
        versionName = "2.3.0"   // matches package.json and the iOS app's MARKETING_VERSION
        // Where the app finds the Mitosis server (WebSocket relay + ATP API). Override: -Pmitosis.serverUrl=...
        val server = providers.gradleProperty("mitosis.serverUrl").getOrElse("http://51.81.81.166:3000")
        buildConfigField("String", "SERVER_URL", "\"$server\"")
        // Sign in with Google: the *web* OAuth client id from Google Cloud Console (plus an Android client
        // registered with this package name and the signing key's SHA-1). Empty hides the Google button.
        // The server must list the same id in GOOGLE_CLIENT_IDS. Set it here or with -Pmitosis.googleWebClientId=...
        val googleWebClientId = providers.gradleProperty("mitosis.googleWebClientId").getOrElse("")
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"$googleWebClientId\"")
    }
    signingConfigs {
        if (uploadStoreFile != null) create("upload") {
            storeFile = rootProject.file(uploadStoreFile)   // relative to android/, or absolute
            storePassword = signing("storePassword", "MITOSIS_UPLOAD_STORE_PASSWORD")
            keyAlias = signing("keyAlias", "MITOSIS_UPLOAD_KEY_ALIAS")
            keyPassword = signing("keyPassword", "MITOSIS_UPLOAD_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("upload")?.let { signingConfig = it }
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
    implementation("com.android.billingclient:billing-ktx:8.0.0")   // Play requires Billing Library 8+ from 31 August 2026
    implementation("com.google.android.play:review:2.0.2")             // the in-app review card
    // Sign in with Google (Credential Manager)
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
