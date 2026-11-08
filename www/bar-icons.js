/* bar-icons.js — أيقونات القائمة السفلية (qsCards) تُقرأ من مجلد icons/ خارج الكود.
   لتغيير أيقونة: استبدل ملف الـPNG بنفس الاسم، أو عدّل الجدول أدناه.
   إن لم يوجد الملف تبقى الأيقونة القديمة (SVG) كما هي. */
(function () {
  const ICON_DIR = 'icons/';
  const BAR_ICONS = {
    btnLiveShare:    'live-share.png',     // 1 مشاركة الموقع
    btnSatellite:    'satellite.png',      // 2 قمر صناعي
    btnGlobe:        'globe.png',          // 3 الكوكب
    btnNotifications:'notifications.png',  // 4 الإشعارات
    btnAI:           'ai.png',             // 5 ذكاء اصطناعي
    btnSendLoc:      'send-location.png',  // 6 إرسال الموقع
    btnFollow:       'recenter.png',       // 7 إعادة التموضع
    btnReport:       'report.png'          // 8 بلاغات
  };

  const st = document.createElement('style');
  st.textContent =
    '.qs-card[data-bar-icon] > svg, .qs-card[data-bar-icon] > i { display:none !important; }' +
    '.qs-card .rico-img { width:46px; height:46px; object-fit:contain; display:block; pointer-events:none;' +
    ' -webkit-user-drag:none; user-select:none; filter:drop-shadow(0 3px 3px rgba(0,0,0,.4)); transition:transform .15s; }' +
    '.qs-card.on .rico-img { transform:scale(1.08); filter:drop-shadow(0 0 6px rgba(125,211,252,.65)); }';
  document.head.appendChild(st);

  function apply() {
    Object.keys(BAR_ICONS).forEach(function (id) {
      const btn = document.getElementById(id);
      if (!btn || btn.querySelector('.rico-img')) return;
      const img = new Image();
      img.className = 'rico-img'; img.alt = ''; img.draggable = false;
      img.onload = function () {
        btn.setAttribute('data-bar-icon', '1');
        btn.insertBefore(img, btn.firstChild);
      };
      img.src = ICON_DIR + BAR_ICONS[id];
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();
