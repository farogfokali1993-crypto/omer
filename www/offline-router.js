/* محرك مسارات يعمل بلا إنترنت — يقرأ ملف maps/iraq-roads.bin.gz ويعيد نتائج بنفس شكل OSRM */
(function (root) {
'use strict';
const D2R = Math.PI / 180, MLAT = 110574;
const mlon = lat => 111320 * Math.cos(lat * D2R);
function hav(lo1, la1, lo2, la2) {
  const dLa = (la2 - la1) * D2R, dLo = (lo2 - lo1) * D2R;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * D2R) * Math.cos(la2 * D2R) * Math.sin(dLo / 2) ** 2;
  return 12742016 * Math.asin(Math.sqrt(a));
}
function brg(lo1, la1, lo2, la2) {
  const y = Math.sin((lo2 - lo1) * D2R) * Math.cos(la2 * D2R);
  const x = Math.cos(la1 * D2R) * Math.sin(la2 * D2R) - Math.sin(la1 * D2R) * Math.cos(la2 * D2R) * Math.cos((lo2 - lo1) * D2R);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}
const sdiff = (a, b) => ((a - b + 540) % 360) - 180;     // a-b في المجال (-180,180]
const LINK = new Set([2, 4, 6, 8, 10]);

let G = null, loadPromise = null, loadUrl = null;

function parse(buf) {
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'ZRT1') throw new Error('ملف الطرق غير صالح');
  const N = dv.getUint32(4, true), E = dv.getUint32(8, true), P = dv.getUint32(12, true), S = dv.getUint32(16, true), NB = dv.getUint32(20, true);
  let off = 24;
  const take = (T, n, bytes) => { const a = new T(buf, off, n); off += (n * bytes + 3) & ~3; return a; };
  const g = { N, E, P };
  g.nLon = take(Int32Array, N, 4); g.nLat = take(Int32Array, N, 4);
  g.eA = take(Uint32Array, E, 4); g.eB = take(Uint32Array, E, 4);
  g.eLen = take(Float32Array, E, 4); g.eSp = take(Uint8Array, E, 1); g.eFl = take(Uint8Array, E, 1);
  g.eNm = take(Uint32Array, E, 4); g.eOff = take(Uint32Array, E + 1, 4);
  g.pLon = take(Int32Array, P, 4); g.pLat = take(Int32Array, P, 4);
  g.names = new TextDecoder('utf-8').decode(new Uint8Array(buf, off, NB)).split('\n');
  // الوصلات: كل ضلع يظهر عند طرفيه. الرمز = ضلع*2 + (0 عند A | 1 عند B)
  const st = new Uint32Array(N + 1);
  for (let e = 0; e < E; e++) { st[g.eA[e] + 1]++; st[g.eB[e] + 1]++; }
  for (let i = 0; i < N; i++) st[i + 1] += st[i];
  const fill = st.slice(0, N), inc = new Uint32Array(2 * E);
  for (let e = 0; e < E; e++) { inc[fill[g.eA[e]]++] = e * 2; inc[fill[g.eB[e]]++] = e * 2 + 1; }
  g.incStart = st; g.inc = inc;
  // تكلفة الضلع بالثواني
  const cost = new Float32Array(E); let maxSp = 60;
  for (let e = 0; e < E; e++) {
    const cls = g.eFl[e] >> 3, sp = g.eSp[e] || 30;
    if (sp > maxSp) maxSp = sp;
    const f = cls <= 4 ? 0.9 : cls <= 6 ? 0.75 : 0.65;
    cost[e] = g.eLen[e] / (sp * f / 3.6) + (cls <= 4 ? 0 : cls <= 8 ? 1.5 : 3);
  }
  g.cost = cost; g.maxMs = maxSp / 3.6;
  g.closed = new Uint32Array(N); g.stamp = new Uint32Array(N); g.gs = new Float64Array(N); g.prev = new Int32Array(N); g.runId = 0;
  return g;
}

async function load(url) {
  if (G) return G;
  if (loadPromise && loadUrl === url) return loadPromise;
  loadUrl = url;
  loadPromise = (async () => {
    const r = await fetch(url);
    if (!r.ok) throw new Error('ملف الطرق غير موجود (' + r.status + ')');
    let buf = await r.arrayBuffer();
    const h = new Uint8Array(buf, 0, 2);
    if (h[0] === 0x1f && h[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') throw new Error('المتصفح لا يدعم فك الضغط');
      buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    G = parse(buf); return G;
  })();
  loadPromise.catch(() => { loadPromise = null; });
  return loadPromise;
}
function loadBuffer(arrayBuffer) { G = parse(arrayBuffer); return G; }

// ───────── فهرس مكاني ─────────
function buildGrid(g) {
  if (g.grid) return g.grid;
  let minLo = 1e9, maxLo = -1e9, minLa = 1e9, maxLa = -1e9;
  for (let i = 0; i < g.P; i++) {
    const lo = g.pLon[i], la = g.pLat[i];
    if (lo < minLo) minLo = lo; if (lo > maxLo) maxLo = lo; if (la < minLa) minLa = la; if (la > maxLa) maxLa = la;
  }
  const cs = 4000;                       // 0.004° ≈ 440م
  const W = Math.floor((maxLo - minLo) / cs) + 1, H = Math.floor((maxLa - minLa) / cs) + 1;
  const cells = W * H, start = new Uint32Array(cells + 1);
  const cellOf = i => Math.floor((g.pLat[i] - minLa) / cs) * W + Math.floor((g.pLon[i] - minLo) / cs);
  let total = 0;
  for (let e = 0; e < g.E; e++) {
    let prev = -1;
    for (let i = g.eOff[e]; i < g.eOff[e + 1]; i++) { const c = cellOf(i); if (c !== prev) { start[c + 1]++; total++; prev = c; } }
  }
  for (let c = 0; c < cells; c++) start[c + 1] += start[c];
  const fillp = start.slice(0, cells), list = new Uint32Array(total);
  for (let e = 0; e < g.E; e++) {
    let prev = -1;
    for (let i = g.eOff[e]; i < g.eOff[e + 1]; i++) { const c = cellOf(i); if (c !== prev) { list[fillp[c]++] = e; prev = c; } }
  }
  return (g.grid = { minLo, minLa, cs, W, H, start, list });
}

function polyLen(g, e) {
  let L = 0;
  for (let i = g.eOff[e]; i < g.eOff[e + 1] - 1; i++) L += hav(g.pLon[i] / 1e6, g.pLat[i] / 1e6, g.pLon[i + 1] / 1e6, g.pLat[i + 1] / 1e6);
  return L;
}

function snap(g, lon, lat, o) {
  const gr = buildGrid(g);
  const cx = Math.floor((lon * 1e6 - gr.minLo) / gr.cs), cy = Math.floor((lat * 1e6 - gr.minLa) / gr.cs);
  const cellM = gr.cs / 1e6 * 110000 * Math.cos(lat * D2R);
  const kx = mlon(lat);
  for (const useB of (o && typeof o.bearing === 'number') ? [true, false] : [false]) {
    let best = null; const seen = new Set();
    for (let r = 0; r <= 14; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= gr.W || y >= gr.H) continue;
        const c = y * gr.W + x;
        for (let q = gr.start[c]; q < gr.start[c + 1]; q++) {
          const e = gr.list[q];
          if (seen.has(e)) continue; seen.add(e);
          const fl = g.eFl[e] & 3;
          for (let i = g.eOff[e]; i < g.eOff[e + 1] - 1; i++) {
            const ax = (g.pLon[i] / 1e6 - lon) * kx, ay = (g.pLat[i] / 1e6 - lat) * MLAT;
            const bx = (g.pLon[i + 1] / 1e6 - lon) * kx, by = (g.pLat[i + 1] / 1e6 - lat) * MLAT;
            const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
            let t = l2 > 0 ? -(ax * vx + ay * vy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = ax + vx * t, py = ay + vy * t, d = Math.hypot(px, py);
            if (best && d >= best.d) continue;
            if (useB) {
              const sb = brg(g.pLon[i] / 1e6, g.pLat[i] / 1e6, g.pLon[i + 1] / 1e6, g.pLat[i + 1] / 1e6), rng = o.bearingRange || 60;
              const okF = fl !== 2 && Math.abs(sdiff(o.bearing, sb)) <= rng;
              const okB = fl !== 1 && Math.abs(sdiff(o.bearing, sb + 180)) <= rng;
              if (!okF && !okB) continue;
            }
            best = { e, seg: i - g.eOff[e], t, d, lon: lon + px / kx, lat: lat + py / MLAT };
          }
        }
      }
      if (best && best.d <= r * cellM) break;
    }
    if (best) {
      const e = best.e, i0 = g.eOff[e];
      let dA = 0;
      for (let i = 0; i < best.seg; i++) dA += hav(g.pLon[i0 + i] / 1e6, g.pLat[i0 + i] / 1e6, g.pLon[i0 + i + 1] / 1e6, g.pLat[i0 + i + 1] / 1e6);
      dA += hav(g.pLon[i0 + best.seg] / 1e6, g.pLat[i0 + best.seg] / 1e6, best.lon, best.lat);
      const tot = polyLen(g, e), k = tot > 0 ? g.eLen[e] / tot : 1;
      best.dA = dA * k; best.dB = Math.max(0, g.eLen[e] - best.dA);
      best.fl = g.eFl[e] & 3; best.k = k;
      return best;
    }
  }
  return null;
}

// ───────── كومة ثنائية ─────────
class Heap {
  constructor() { this.n = 0; this.k = new Float64Array(1024); this.v = new Int32Array(1024); }
  push(key, val) {
    if (this.n === this.k.length) { const k2 = new Float64Array(this.n * 2), v2 = new Int32Array(this.n * 2); k2.set(this.k); v2.set(this.v); this.k = k2; this.v = v2; }
    let i = this.n++; const k = this.k, v = this.v;
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, topK = k[0], topV = v[0], n = --this.n;
    if (n > 0) {
      const key = k[n], val = v[n]; let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= key) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = key; v[i] = val;
    }
    this.lastKey = topK; return topV;
  }
}

function canLeave(g, code) { const o = g.eFl[code >> 1] & 3; return (code & 1) === 0 ? o !== 2 : o !== 1; }
const arcTo = (g, code) => (code & 1) === 0 ? g.eB[code >> 1] : g.eA[code >> 1];

// بحث A* بين نقطتين ملتصقتين بالشبكة. penalty: Float32Array اختياري لمضاعفة تكلفة أضلاع
function search(g, s, d, penalty) {
  const vel = g.eSp;
  const e1 = s.e, e2 = d.e;
  const cEdge = e => (penalty ? g.cost[e] * penalty[e] : g.cost[e]);
  let best = null;
  // نفس الضلع
  if (e1 === e2) {
    if (s.fl !== 2 && d.dA >= s.dA) best = { total: g.cost[e1] * (d.dA - s.dA) / Math.max(1, g.eLen[e1]), direct: true, dir: 0 };
    if (s.fl !== 1 && d.dA < s.dA) { const t = g.cost[e1] * (s.dA - d.dA) / Math.max(1, g.eLen[e1]); if (!best || t < best.total) best = { total: t, direct: true, dir: 1 }; }
  }
  const run = ++g.runId;
  const heap = new Heap();
  const tLon = d.lon, tLat = d.lat, kx = mlon(tLat);
  const h = n => Math.hypot((g.nLon[n] / 1e6 - tLon) * kx, (g.nLat[n] / 1e6 - tLat) * MLAT) / g.maxMs;
  const srcs = [];
  if (s.fl !== 2) srcs.push({ n: g.eB[e1], c: g.cost[e1] * s.dB / Math.max(1, g.eLen[e1]), side: 0 });
  if (s.fl !== 1) srcs.push({ n: g.eA[e1], c: g.cost[e1] * s.dA / Math.max(1, g.eLen[e1]), side: 1 });
  srcs.forEach((x, i) => {
    if (g.stamp[x.n] !== run || x.c < g.gs[x.n]) { g.stamp[x.n] = run; g.gs[x.n] = x.c; g.prev[x.n] = -1 - x.side; heap.push(x.c + h(x.n), x.n); }
  });
  const sinks = new Map();
  if (d.fl !== 2) sinks.set(g.eA[e2], { c: g.cost[e2] * d.dA / Math.max(1, g.eLen[e2]), side: 0 });
  if (d.fl !== 1) { const nb = g.eB[e2]; const c = g.cost[e2] * d.dB / Math.max(1, g.eLen[e2]); if (!sinks.has(nb) || c < sinks.get(nb).c) sinks.set(nb, { c, side: 1 }); }
  let bestGraph = null, bestSrcSide = 0;
  while (heap.n) {
    const u = heap.pop(), fu = heap.lastKey;
    if (bestGraph && fu >= bestGraph.total) break;
    if (g.closed[u] === run) continue;
    g.closed[u] = run;
    const gu = g.gs[u];
    const sk = sinks.get(u);
    if (sk) { const tot = gu + sk.c; if (!bestGraph || tot < bestGraph.total) bestGraph = { total: tot, node: u, sink: sk.side }; }
    for (let q = g.incStart[u]; q < g.incStart[u + 1]; q++) {
      const code = g.inc[q];
      if (!canLeave(g, code)) continue;
      const v = arcTo(g, code), ng = gu + cEdge(code >> 1);
      if (g.stamp[v] !== run || ng < g.gs[v]) { g.stamp[v] = run; g.gs[v] = ng; g.prev[v] = code; heap.push(ng + h(v), v); }
    }
  }
  if (best && (!bestGraph || best.total <= bestGraph.total)) return best;
  if (!bestGraph) return null;
  // إعادة بناء المسار
  const arcs = []; let n = bestGraph.node;
  while (g.prev[n] >= 0) { const code = g.prev[n]; arcs.push(code); n = (code & 1) === 0 ? g.eA[code >> 1] : g.eB[code >> 1]; }
  arcs.reverse();
  return { total: bestGraph.total, arcs, srcSide: -1 - g.prev[n], sinkSide: bestGraph.sink };
}

// ───────── بناء القطع والتعليمات ─────────
const pt = (g, i) => [g.pLon[i] / 1e6, g.pLat[i] / 1e6];
function edgePts(g, e, rev) {
  const a = [], i0 = g.eOff[e], i1 = g.eOff[e + 1];
  if (!rev) for (let i = i0; i < i1; i++) a.push(pt(g, i));
  else for (let i = i1 - 1; i >= i0; i--) a.push(pt(g, i));
  return a;
}
function plen(a) { let L = 0; for (let i = 1; i < a.length; i++) L += hav(a[i - 1][0], a[i - 1][1], a[i][0], a[i][1]); return L; }
function nodeBearing(g, e, atEnd /*0 عند A,1 عند B*/) {   // اتجاه الخروج من العقدة على هذا الضلع
  const a = edgePts(g, e, atEnd === 1);
  let k = 1, L = 0;
  while (k < a.length - 1 && L < 8) { L += hav(a[k - 1][0], a[k - 1][1], a[k][0], a[k][1]); k++; }
  return brg(a[0][0], a[0][1], a[k][0], a[k][1]);
}
function endBearing(pts) {  // اتجاه آخر ~10م
  let k = pts.length - 2, L = 0;
  const last = pts[pts.length - 1];
  while (k > 0 && L < 8) { L += hav(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]); k--; }
  return brg(pts[k][0], pts[k][1], last[0], last[1]);
}
function startBearing(pts) {
  let k = 1, L = 0;
  while (k < pts.length - 1 && L < 8) { L += hav(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]); k++; }
  return brg(pts[0][0], pts[0][1], pts[k][0], pts[k][1]);
}
function dedupe(pts) {
  const o = [];
  for (const p of pts) { const l = o[o.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) o.push(p); }
  return o;
}
function modifierOf(a) {
  const x = Math.abs(a);
  const side = a >= 0 ? 'right' : 'left';
  if (x < 10) return 'straight';
  if (x < 45) return 'slight ' + side;
  if (x < 115) return side;
  if (x < 165) return 'sharp ' + side;
  return 'uturn';
}

function legFromPath(g, s, d, res) {
  const pieces = [];
  const P = (e, pts, fromNode, toNode) => {
    pts = dedupe(pts); if (pts.length < 2) return;
    const len = plen(pts), cls = g.eFl[e] >> 3, sp = g.eSp[e] || 30, f = cls <= 4 ? 0.9 : cls <= 6 ? 0.75 : 0.65;
    pieces.push({ e, pts, len, dur: len / (sp * f / 3.6), name: g.names[g.eNm[e]] || '', rb: !!(g.eFl[e] & 4), cls, from: fromNode, to: toNode });
  };
  const sPt = [s.lon, s.lat], dPt = [d.lon, d.lat];
  if (res.direct) {
    const all = edgePts(g, s.e, res.dir === 1);
    const n = all.length;
    // نقاط الضلع بين الموضعين
    const a = res.dir === 0 ? [sPt, ...all.slice(s.seg + 1, d.seg + 1), dPt] : [sPt, ...all.slice(n - 1 - s.seg, n - 1 - d.seg), dPt];
    P(s.e, a, -1, -1);
  } else {
    const first = res.arcs.length ? res.arcs[0] : null;
    const e1 = s.e, all1 = edgePts(g, e1, false);
    if (res.srcSide === 0) P(e1, [sPt, ...all1.slice(s.seg + 1)], -1, g.eB[e1]);
    else P(e1, [sPt, ...all1.slice(0, s.seg + 1).reverse()], -1, g.eA[e1]);
    for (const code of res.arcs) {
      const e = code >> 1, rev = (code & 1) === 1;
      P(e, edgePts(g, e, rev), rev ? g.eB[e] : g.eA[e], rev ? g.eA[e] : g.eB[e]);
    }
    const e2 = d.e, all2 = edgePts(g, e2, false);
    if (res.sinkSide === 0) P(e2, [...all2.slice(0, d.seg + 1), dPt], g.eA[e2], -1);
    else P(e2, [...all2.slice(d.seg + 1).reverse(), dPt], g.eB[e2], -1);
  }
  return pieces;
}

function incidentInfo(g, node, inE, inEnd) {
  // كل الطرق عند العقدة: اتجاهات الخروج + هل يمكن الخروج
  const roads = [];
  for (let q = g.incStart[node]; q < g.incStart[node + 1]; q++) {
    const code = g.inc[q], e = code >> 1, s = code & 1;
    roads.push({ code, e, b: nodeBearing(g, e, s), ok: canLeave(g, code), rb: !!(g.eFl[e] & 4), name: g.names[g.eNm[e]] || '' });
  }
  return roads;
}

function buildSteps(g, pieces) {
  const steps = [];
  let cur = null;
  const mk = (type, modifier, loc, bBefore, bAfter, extra) => {
    const m = { type, location: loc, bearing_before: Math.round(bBefore), bearing_after: Math.round(bAfter) };
    if (modifier) m.modifier = modifier; if (extra) Object.assign(m, extra);
    return { distance: 0, duration: 0, name: '', mode: 'driving', driving_side: 'right', maneuver: m, intersections: [] };
  };
  const first = pieces[0];
  cur = mk('depart', 'straight', first.pts[0], 0, startBearing(first.pts));
  steps.push(cur);
  let ringExit = 0, inRing = false;
  const addInter = (node, loc, inB, outB, pcs) => {
    const roads = incidentInfo(g, node);
    if (roads.length < 3) return;
    const bearings = roads.map(r => Math.round(r.b));
    const inRev = (inB + 180) % 360;
    let inIdx = 0, outIdx = 0, bi = 1e9, bo = 1e9;
    roads.forEach((r, i) => {
      const di = Math.abs(sdiff(r.b, inRev)), dO = Math.abs(sdiff(r.b, outB));
      if (di < bi) { bi = di; inIdx = i; } if (dO < bo) { bo = dO; outIdx = i; }
    });
    if (inIdx === outIdx) return;
    cur.intersections.push({ location: loc, bearings, entry: roads.map(r => r.ok), in: inIdx, out: outIdx });
  };
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (!cur.name && p.name) cur.name = p.name;
    cur.distance += p.len; cur.duration += p.dur;
    const nxt = pieces[i + 1];
    if (!nxt || p.to < 0) continue;
    const node = p.to, loc = p.pts[p.pts.length - 1];
    const bIn = endBearing(p.pts), bOut = startBearing(nxt.pts);
    const ang = sdiff(bOut, bIn);
    const roads = incidentInfo(g, node);
    addInter(node, loc, bIn, bOut);
    // دوار
    if (nxt.rb && !p.rb) {
      ringExit = 0; inRing = true;
      cur = mk('roundabout', modifierOf(ang), loc, bIn, bOut, { exit: 1 });
      steps.push(cur); continue;
    }
    if (p.rb && nxt.rb) {
      if (roads.some(r => r.ok && !r.rb)) ringExit++;
      continue;
    }
    if (p.rb && !nxt.rb) {
      ringExit++;
      const rs = steps.slice().reverse().find(s => s.maneuver.type === 'roundabout');
      if (rs) rs.maneuver.exit = Math.max(1, ringExit);
      inRing = false;
      cur = mk('exit roundabout', modifierOf(ang), loc, bIn, bOut);
      steps.push(cur); continue;
    }
    const inRev = (bIn + 180) % 360;
    const exits = roads.filter(r => r.ok && Math.abs(sdiff(r.b, inRev)) > 20);
    let type = null, modifier = modifierOf(ang);
    const nameChanged = nxt.name && p.name && nxt.name !== p.name;
    if (LINK.has(nxt.cls) && !LINK.has(p.cls) && Math.abs(ang) > 5) type = p.cls <= 4 || p.cls === 5 ? 'off ramp' : 'on ramp';
    else if (!LINK.has(nxt.cls) && LINK.has(p.cls) && exits.length > 1) type = 'merge';
    else if (exits.length >= 2 || roads.length >= 3 && Math.abs(ang) >= 25) {
      const straightAlt = exits.some(r => Math.abs(sdiff(r.b, bIn)) < 45);
      if (Math.abs(ang) < 10 && !nameChanged) type = null;
      else if (Math.abs(ang) < 45 && exits.filter(r => Math.abs(sdiff(r.b, bIn)) < 45).length >= 2) type = 'fork';
      else if (!straightAlt && roads.length === 3 && exits.length >= 2) type = 'end of road';
      else type = Math.abs(ang) < 10 ? 'new name' : 'turn';
    } else if (nameChanged) { type = 'new name'; if (Math.abs(ang) < 10) modifier = 'straight'; }
    else if (Math.abs(ang) >= 60) type = 'turn';
    if (!type) continue;
    cur = mk(type, modifier, loc, bIn, bOut);
    steps.push(cur);
  }
  const lastP = pieces[pieces.length - 1];
  const endLoc = lastP.pts[lastP.pts.length - 1];
  steps.push({ distance: 0, duration: 0, name: '', mode: 'driving', driving_side: 'right', maneuver: { type: 'arrive', modifier: 'straight', location: endLoc, bearing_before: Math.round(endBearing(lastP.pts)), bearing_after: 0 }, intersections: [{ location: endLoc, bearings: [Math.round((endBearing(lastP.pts) + 180) % 360)], entry: [true], in: 0 }] });
  // الاسم لخطوات بلا اسم: خذ اسم آخر خطوة سابقة إن كان نفس الطريق
  steps.forEach(s => { s.distance = Math.round(s.distance * 10) / 10; s.duration = Math.round(s.duration * 10) / 10; });
  return steps;
}

function buildRoute(g, legsRes, pts) {
  const legs = [], coords = [];
  let dist = 0, dur = 0;
  legsRes.forEach(({ s, d, res }) => {
    const pieces = legFromPath(g, s, d, res);
    if (!pieces.length) throw new Error('NoRoute');
    const steps = buildSteps(g, pieces);
    const ld = pieces.reduce((a, p) => a + p.len, 0), lt = pieces.reduce((a, p) => a + p.dur, 0);
    legs.push({ steps, distance: ld, duration: lt, weight: lt, summary: (steps.find(x => x.name) || {}).name || '' });
    pieces.forEach(p => p.pts.forEach(q => { const l = coords[coords.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) coords.push(q); }));
    dist += ld; dur += lt;
  });
  return { distance: dist, duration: dur, weight: dur, weight_name: 'routability', geometry: { type: 'LineString', coordinates: coords }, legs, offline: true };
}

function usedEdges(res, set) { (res.arcs || []).forEach(c => set.add(c >> 1)); }

async function route(points, opts) {
  const o = opts || {};
  const g = await load(o.url || root.OFFLINE_ROADS_URL || 'maps/iraq-roads.bin.gz');
  if (points.length < 2) throw new Error('NoRoute');
  const snaps = points.map((p, i) => snap(g, p[0], p[1], i === 0 ? o : null));
  if (snaps.some(x => !x)) throw new Error('NoSegment');
  const routes = [];
  const run = penalty => {
    const legsRes = [];
    for (let i = 0; i < snaps.length - 1; i++) {
      const res = search(g, snaps[i], snaps[i + 1], penalty);
      if (!res) return null;
      legsRes.push({ s: snaps[i], d: snaps[i + 1], res });
    }
    return legsRes;
  };
  const r1 = run(null);
  if (!r1) throw new Error('NoRoute');
  routes.push(buildRoute(g, r1, points));
  if (o.alternatives !== false) {
    const used = new Set(); r1.forEach(l => usedEdges(l.res, used));
    if (used.size > 3) {
      const pen = new Float32Array(g.E).fill(1);
      used.forEach(e => { pen[e] = 3; });
      try {
        const r2 = run(pen);
        if (r2) {
          const alt = buildRoute(g, r2, points);
          const set2 = new Set(); r2.forEach(l => usedEdges(l.res, set2));
          let shared = 0; set2.forEach(e => { if (used.has(e)) shared++; });
          if (shared / Math.max(1, set2.size) < 0.8 && alt.duration < routes[0].duration * 1.6 && Math.abs(alt.distance - routes[0].distance) > 100) routes.push(alt);
        }
      } catch (e) {}
    }
  }
  return routes;
}

root.OfflineRouter = { load, loadBuffer, route, snap: (lon, lat, o) => snap(G, lon, lat, o), get ready() { return !!G; } };
if (typeof module !== 'undefined') module.exports = root.OfflineRouter;
})(typeof window !== 'undefined' ? window : globalThis);
