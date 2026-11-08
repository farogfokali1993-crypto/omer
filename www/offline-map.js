/* تنزيل الخريطة وشبكة الطرق إلى تخزين الجهاز لتعمل بلا إنترنت (داخل تطبيق الأندرويد / Capacitor)
 *
 * الملفان اللذان يُنزَّلان معاً بضغطة واحدة من الإعدادات:
 *   1) maps/iraq.pmtiles        ← خريطة العراق
 *   2) maps/iraq-roads.bin      ← شبكة الطرق لمحرك المسارات بدون إنترنت (offline-router.js)
 *
 * يجب أن يكون الرابط رابطاً مباشراً لنفس الملف (وليس صفحة تنزيل ولا ملف RAR/ZIP).
 * ضع الروابط هنا، أو من الإعدادات ← الخريطة بدون إنترنت ← روابط التنزيل (متقدم).
 * مثال GitHub Releases:
 *   https://github.com/USER/REPO/releases/download/maps-v1/iraq.pmtiles
 */
(function (root) {
  'use strict';

  const PACK = [
    { key: 'tiles', path: 'maps/iraq.pmtiles',      label: 'خريطة العراق',                      defaultUrl: 'https://github.com/farogfokali1993-crypto/boot/releases/download/maps-v1/iraq.pmtiles', minBytes: 5e6, kind: 'pmtiles' },
    { key: 'roads', path: 'maps/iraq-roads.bin',    label: 'شبكة الطرق (المسارات بدون إنترنت)', defaultUrl: 'https://github.com/farogfokali1993-crypto/boot/releases/download/maps-v1/iraq-roads.bin', minBytes: 5e6, kind: 'any' }
  ];
  const LS_STATE = 'sqoor_offline_pack';
  const LS_URLS  = 'sqoor_offline_pack_urls';
  const DIR = 'DATA';

  const cap = () => root.Capacitor;
  const isNative = () => !!(cap() && cap().isNativePlatform && cap().isNativePlatform());
  const FS = () => cap() && cap().Plugins && cap().Plugins.Filesystem;
  const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const mb = b => (b / 1048576).toFixed(1);

  // ── حالة الملفات المنزّلة (قراءة متزامنة عند بدء التطبيق) ──
  const getState = () => readJSON(LS_STATE, {});
  const tilesUrl = () => (getState().tiles || {}).url || null;
  const roadsUrl = () => (getState().roads || {}).url || null;
  const getUrls = () => {
    const saved = readJSON(LS_URLS, {});
    const out = {};
    PACK.forEach(f => { out[f.key] = (saved[f.key] || f.defaultUrl || '').trim(); });
    return out;
  };
  // محرك المسارات المحلي يقرأ هذا المتغير عند كل طلب مسار
  if (roadsUrl()) root.OFFLINE_ROADS_URL = roadsUrl();

  // ── فحص الملف بعد التنزيل (يمنع حفظ صفحة HTML أو RAR على أنها خريطة) ──
  async function headBytes(fs, path) {
    const { uri } = await fs.getUri({ path, directory: DIR });
    const r = await fetch(cap().convertFileSrc(uri));
    const rd = r.body.getReader();
    const { value } = await rd.read();
    try { rd.cancel(); } catch (e) {}
    return value || new Uint8Array(0);
  }
  const ascii = (u8, n) => String.fromCharCode.apply(null, Array.from(u8.slice(0, n)));
  async function verify(fs, f, path) {
    const st = await fs.stat({ path, directory: DIR });
    const size = Number(st.size) || 0;
    const head = await headBytes(fs, path);
    const a = ascii(head, 8);
    if (a.startsWith('Rar!')) throw new Error('الرابط يعطي ملف RAR. ارفع الملف نفسه (' + f.path.split('/').pop() + ') بدون ضغط واستخدم رابطه المباشر.');
    if (a.startsWith('PK')) throw new Error('الرابط يعطي ملف ZIP. ارفع الملف نفسه (' + f.path.split('/').pop() + ') بدون ضغط واستخدم رابطه المباشر.');
    if (a.trim().startsWith('<')) throw new Error('الرابط يفتح صفحة ويب وليس الملف المباشر. استخدم رابط التنزيل المباشر للملف.');
    if (f.kind === 'pmtiles' && !a.startsWith('PMTiles')) throw new Error('الملف المنزّل ليس بصيغة PMTiles صحيحة.');
    if (size < f.minBytes) throw new Error('الملف المنزّل صغير جداً (' + mb(size) + ' MB). تأكد من الرابط.');
    return size;
  }

  let busy = false;

  async function downloadAll(onProg) {
    if (busy) return;
    const fs = FS();
    if (!isNative() || !fs) throw new Error('التنزيل متاح داخل تطبيق الأندرويد فقط.');
    const urls = getUrls();
    const missing = PACK.filter(f => !/^https?:\/\//i.test(urls[f.key]));
    if (missing.length) throw new Error('لم يُضبط رابط التنزيل المباشر لـ: ' + missing.map(f => f.label).join(' و') + '. أضفه من «روابط التنزيل (متقدم)».');
    busy = true;
    try {
      for (let i = 0; i < PACK.length; i++) {
        const f = PACK[i];
        const part = f.path + '.part';
        try { await fs.deleteFile({ path: part, directory: DIR }); } catch (e) {}
        const h = await fs.addListener('progress', e => {
          onProg && onProg({ index: i, count: PACK.length, label: f.label, bytes: e.bytes || 0, total: e.contentLength > 0 ? e.contentLength : 0 });
        });
        try {
          onProg && onProg({ index: i, count: PACK.length, label: f.label, bytes: 0, total: 0 });
          await fs.downloadFile({ url: urls[f.key], path: part, directory: DIR, recursive: true, progress: true });
          const size = await verify(fs, f, part);
          try { await fs.deleteFile({ path: f.path, directory: DIR }); } catch (e) {}
          await fs.rename({ from: part, to: f.path, directory: DIR, toDirectory: DIR });
          const { uri } = await fs.getUri({ path: f.path, directory: DIR });
          const st = getState();
          st[f.key] = { url: cap().convertFileSrc(uri), size, ts: Date.now() };
          writeJSON(LS_STATE, st);
          if (f.key === 'roads') root.OFFLINE_ROADS_URL = st.roads.url;   // يعمل فوراً بدون إعادة تشغيل
        } catch (err) {
          try { await fs.deleteFile({ path: part, directory: DIR }); } catch (e) {}
          throw err;
        } finally {
          try { h.remove(); } catch (e) {}
        }
      }
    } finally { busy = false; }
  }

  async function removeAll() {
    const fs = FS();
    if (fs) for (const f of PACK) {
      try { await fs.deleteFile({ path: f.path, directory: DIR }); } catch (e) {}
      try { await fs.deleteFile({ path: f.path + '.part', directory: DIR }); } catch (e) {}
    }
    try { localStorage.removeItem(LS_STATE); } catch (e) {}
    try { delete root.OFFLINE_ROADS_URL; } catch (e) { root.OFFLINE_ROADS_URL = undefined; }
  }

  // ── واجهة صفحة الإعدادات ──
  const $ = id => document.getElementById(id);
  const tilesActive = () => typeof LOCAL_TILES_ON !== 'undefined' && LOCAL_TILES_ON && !!tilesUrl();

  function refreshUI() {
    if (!$('omStatus')) return;
    const st = getState();
    const bar = $('omBar'), prog = $('omProg');
    const dl = $('omBtnDownload'), del = $('omBtnDelete'), rl = $('omBtnReload');
    const have = !!(st.tiles || st.roads);
    let msg;
    if (!isNative()) msg = 'تنزيل الخريطة متاح داخل تطبيق الأندرويد فقط.';
    else if (st.tiles && tilesActive()) msg = '✓ الخريطة المحلية مفعّلة وتعمل بدون إنترنت (' + mb(st.tiles.size) + ' MB).';
    else if (st.tiles) msg = '✓ تم تنزيل الخريطة. اضغط «تفعيل الخريطة الآن» لتشغيلها.';
    else msg = 'الخريطة غير منزّلة. نزّلها لتعمل الخريطة والمسارات بدون إنترنت.';
    $('omStatus').textContent = msg;
    $('omRoads').textContent = st.roads
      ? '✓ شبكة الطرق منزّلة (' + mb(st.roads.size) + ' MB) — المسارات تعمل بدون إنترنت.'
      : 'شبكة الطرق غير منزّلة.';
    dl.disabled = busy || !isNative();
    dl.textContent = busy ? 'جارِ التنزيل…' : (have ? 'إعادة تنزيل الخريطة' : 'تنزيل الخريطة');
    del.hidden = !have || busy;
    rl.hidden = !(st.tiles && !tilesActive()) || busy;
    if (!busy) { bar.hidden = true; prog.textContent = ''; }
    const u = getUrls();
    $('omUrlTiles').value = u.tiles;
    $('omUrlRoads').value = u.roads;
  }

  function showProgress(p) {
    const bar = $('omBar'), fill = $('omBarFill'), prog = $('omProg');
    bar.hidden = false;
    const pct = p.total ? Math.min(100, p.bytes / p.total * 100) : 0;
    // الشريط يمثل التقدم الكلي للملفين
    fill.style.width = (((p.index + pct / 100) / p.count) * 100).toFixed(1) + '%';
    prog.textContent = '(' + (p.index + 1) + '/' + p.count + ') ' + p.label + ' — ' + mb(p.bytes) + (p.total ? ' / ' + mb(p.total) : '') + ' MB';
  }

  function bind() {
    if (!$('omBtnDownload') || $('omBtnDownload').__bound) return;
    $('omBtnDownload').__bound = true;
    $('omBtnDownload').addEventListener('click', async () => {
      const keepAwake = cap() && cap().Plugins && cap().Plugins.KeepAwake;
      try { keepAwake && keepAwake.keepAwake && keepAwake.keepAwake(); } catch (e) {}
      const dl = $('omBtnDownload');
      dl.disabled = true; dl.textContent = 'جارِ التنزيل…';
      $('omBtnDelete').hidden = true;
      try {
        await downloadAll(showProgress);
        refreshUI();
        $('omProg').textContent = 'اكتمل التنزيل بنجاح.';
      } catch (e) {
        refreshUI();
        $('omProg').textContent = '⚠ ' + (e && e.message ? e.message : 'فشل التنزيل');
      }
    });
    $('omBtnDelete').addEventListener('click', async () => {
      if (!confirm('حذف الخريطة المحمّلة من الجهاز؟ سيعود التطبيق للخريطة الأونلاين بعد إعادة التشغيل.')) return;
      await removeAll();
      refreshUI();
      $('omProg').textContent = 'تم الحذف. أعد تشغيل التطبيق لتطبيق التغيير.';
    });
    $('omBtnReload').addEventListener('click', () => location.reload());
    $('omBtnSaveUrls').addEventListener('click', () => {
      writeJSON(LS_URLS, { tiles: $('omUrlTiles').value.trim(), roads: $('omUrlRoads').value.trim() });
      $('omProg').textContent = 'تم حفظ الروابط.';
    });
  }

  root.SqoorOfflineMap = { tilesUrl, roadsUrl, downloadAll, removeAll, refreshUI, isNative };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})(window);
