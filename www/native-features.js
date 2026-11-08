// ضع هذا الملف في مشروعك واستدعه بـ: <script src="native-features.js" defer></script>
// يعمل داخل تطبيق الأندرويد (Capacitor) فقط.

const Cap = window.Capacitor;
const NativeBiometric = Cap.registerPlugin('NativeBiometric');
const SpeechRecognition = Cap.registerPlugin('SpeechRecognition');

// ---------- 1) البصمة ----------
// المتغير يبقى في الذاكرة طالما التطبيق حيّ، فلا تُطلب البصمة عند كل رجوع،
// بل فقط عند فتح التطبيق من جديد (بعد إغلاقه فعلياً).
let unlocked = false;

async function unlockWithFingerprint() {
  if (unlocked) return true;
  try {
    const { isAvailable } = await NativeBiometric.isAvailable();
    if (!isAvailable) return false; // لا توجد بصمة مفعّلة على الجهاز
    await NativeBiometric.verifyIdentity({
      reason: 'تأكيد هويتك لفتح التطبيق',
      title: 'فتح التطبيق',
      subtitle: '',
      description: ''
    });
    unlocked = true;
    return true;
  } catch (e) {
    return false; // رفض أو فشل التحقق
  }
}

// ---------- 2) الكلام (تحويل الصوت إلى نص) ----------
// Web Speech API لا تعمل داخل WebView الأندرويد، لذلك نستخدم الإضافة الأصلية.
async function startListening(onText) {
  const { available } = await SpeechRecognition.available();
  if (!available) { alert('خدمة التعرف على الصوت غير متوفرة على هذا الجهاز'); return; }

  let perm = await SpeechRecognition.checkPermissions();
  if (perm.speechRecognition !== 'granted') {
    perm = await SpeechRecognition.requestPermissions(); // يظهر طلب إذن الميكروفون
  }
  if (perm.speechRecognition !== 'granted') { alert('الرجاء السماح بالميكروفون'); return; }

  await SpeechRecognition.removeAllListeners();
  SpeechRecognition.addListener('partialResults', data => {
    if (data.matches && data.matches[0]) onText(data.matches[0]);
  });
  await SpeechRecognition.start({ language: 'ar-SA', partialResults: true, popup: false });
}

function stopListening() {
  return SpeechRecognition.stop();
}

// ---------- 3) حفظ الحالة حتى لو أغلق النظام التطبيق في الخلفية ----------
function saveState() {
  localStorage.setItem('appState', JSON.stringify({
    // ضع هنا ما تريد استرجاعه: الصفحة الحالية، النصوص المكتوبة...
    page: location.hash,
    time: Date.now()
  }));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });

function restoreState() {
  try { return JSON.parse(localStorage.getItem('appState') || 'null'); }
  catch (e) { return null; }
}

// ---------- مثال تشغيل ----------
window.addEventListener('DOMContentLoaded', async () => {
  const ok = await unlockWithFingerprint();
  if (!ok) { document.body.innerHTML = '<h3>لم يتم التحقق بالبصمة</h3>'; return; }
  const state = restoreState();
  if (state && state.page) location.hash = state.page;
  // startListening(text => console.log(text));  // استدعِها من زر الميكروفون
});
