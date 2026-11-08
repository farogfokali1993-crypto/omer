خطوات بناء APK لصقور العراق GPS
1) ثبّت Git ثم ادفع المشروع بأمر git (لا ترفعه من متصفح GitHub: حد الملف 25 ميجا وعندك ملفات 43 و47 ميجا).
     git init
     git add .
     git commit -m "first build"
     git branch -M main
     git remote add origin https://github.com/USERNAME/REPO.git
     git push -u origin main
2) من تبويب Actions شغّل "Build Android APK" ثم نزّل الملف من Artifacts.
3) للتوقيع (Release) أضف الأسرار: KEYSTORE_BASE64 و KEYSTORE_PASSWORD و KEY_ALIAS و KEY_PASSWORD.
4) إن كان عندك مجلد android/ من المشروع القديم (com.sqoor.gps) فضعه بجانب www/ قبل الرفع.
