# The game page calls these from JavaScript; keep their names.
-keepclassmembers class com.eclipseforeverbeyond.mitosis.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
