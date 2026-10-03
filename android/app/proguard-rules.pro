# The game page calls these from JavaScript; keep their names.
-keepclassmembers class com.mitosisgame.app.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
