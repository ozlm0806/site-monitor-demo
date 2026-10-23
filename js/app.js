/* 主畫面：工地切換、資料呈現、作業安全研判、警示列、彈出視窗、PWA */
'use strict';

const App = {
  cfg: null,
  site: null,       // 目前工地 {id,name,lat,lon,county,...}
  snap: null,
  safety: [],
  stationId: null,
  trendKey: 'rain',
  muted: localStorage.getItem('klwsdemo_muted') === '1',
  lastReds: '',
  timer: null,
  windyLayer: 'wind'
};
const LS_SITE = 'klwsdemo_last_site';
const $ = KL.$;

/* ================= 作業安全研判 ================= */
function evaluateSafety(s, th) {
  const out = [];
  const R = s.rain, T = s.temp, W = s.wind;
  const bf = v => { const b = KL.beaufort(v); return b == null ? '' : `（${b} 級）`; };

  // 當日累積
  {
    const d = R.day, r24 = R.rolling24;
    const peak = Math.max(d || 0, r24 || 0);
    let st = '正常', c = 'g', tip = '未達大雨標準';
    if (peak >= th.dayTorrential) { st = '豪雨等級'; c = 'r'; tip = '已達豪雨標準，應停止戶外作業並巡查邊坡、排水'; }
    else if (peak >= th.dayHeavy) { st = '大雨等級'; c = 'y'; tip = '已達大雨標準，加強排水與開挖面防護'; }
    out.push({ key: 'day', title: '當日累積', status: st, cls: c, desc: `當日累積 ${KL.num(d)} mm；滾動 24 小時 ${KL.num(r24)} mm，${tip}。` });
  }
  // 熱危害
  {
    const L = KL.heatLevel(T.hi);
    const c = L.lv >= 3 ? 'r' : L.lv === 2 ? 'y' : L.lv < 0 ? 'm' : 'g';
    out.push({ key: 'heat', title: '熱危害', status: L.name, cls: c, desc: `熱指數 ${KL.num(T.hi)} °C，${L.desc || ''}。` });
  }
  // 紫外線
  {
    const U = KL.uvLevel(s.uv);
    out.push({ key: 'uv', title: '紫外線', status: U.name, cls: U.cls, desc: `UV ${KL.num(s.uv, 0)}，${U.desc || ''}。` });
  }
  // 吊車 / 塔吊
  {
    const g = W.gustNow, a = W.avg;
    let st = '可作業', c = 'g', tip = '注意風速變化';
    if ((g ?? 0) >= th.gustStop || (a ?? 0) >= th.windAvgStop) { st = '停止吊掛'; c = 'r'; tip = '應收桿並確認吊具固定，塔吊解除迴轉制動'; }
    else if ((g ?? 0) >= th.gustWarn || (a ?? 0) >= th.windAvgWarn) { st = '注意風速'; c = 'y'; tip = '吊掛前確認風速，必要時暫停'; }
    out.push({ key: 'crane', title: '吊車 / 塔吊', status: st, cls: c, desc: `陣風 ${KL.num(g)} m/s${bf(g)}，平均 ${KL.num(a)} m/s，${tip}。` });
  }
  // 高處作業
  {
    const a = W.avg, g = W.gustNow;
    let st = '可作業', c = 'g', tip = '安全帶、護欄確實使用';
    if ((a ?? 0) >= th.windAvgStop) { st = '停止高處作業'; c = 'r'; tip = '平均風速達 10 m/s 以上（強風），應停止高處作業'; }
    else if ((g ?? 0) >= th.gustWarn) { st = '警戒'; c = 'y'; tip = '陣風偏強，加強墜落防護'; }
    out.push({ key: 'height', title: '高處作業', status: st, cls: c, desc: `平均風速 ${KL.num(a)} m/s${bf(a)}，${tip}。` });
  }
  // 混凝土澆置 / 開挖
  {
    const n = R.now, f = R.fut12;
    let st = '可施作', c = 'g', tip = '持續留意雨勢';
    if ((n ?? 0) >= th.rainNowStop || (f ?? 0) >= th.rain12hStop) { st = '停止澆置'; c = 'r'; tip = '雨勢過大，應停止澆置並保護開挖面'; }
    else if ((n ?? 0) >= th.rainNowWarn || (f ?? 0) >= th.rain12hWarn) { st = '警戒'; c = 'y'; tip = '備妥帆布與抽水設備'; }
    out.push({ key: 'concrete', title: '混凝土澆置 / 開挖', status: st, cls: c, desc: `目前 ${KL.num(n)} mm/hr、未來 12 小時估 ${KL.num(f)} mm，${tip}。` });
  }
  // 鋼構塗裝 / 防水
  {
    const n = R.now, rh = T.rh;
    let st = '可施作', c = 'g', tip = '表面乾燥可施作';
    if ((n ?? 0) >= th.rainNowWarn || (rh ?? 0) >= th.paintRhStop) { st = '停止施工'; c = 'r'; tip = (n ?? 0) >= th.rainNowWarn ? '降雨中，塗膜附著力不足' : '濕度過高，易結露影響附著'; }
    else if ((rh ?? 0) >= th.paintRhWarn || (R.fut2 ?? 0) > 0.5) { st = '警戒'; c = 'y'; tip = '濕度偏高或即將降雨，注意表面狀況'; }
    out.push({ key: 'paint', title: '鋼構塗裝 / 防水', status: st, cls: c, desc: `濕度 ${KL.num(rh, 0)} %、${KL.num(n)} mm/hr，${tip}。` });
  }
  // 氣象署特報
  if (!s.hasKey) out.push({ key: 'warn', title: '氣象署特報', status: '未連線', cls: 'm', desc: '需由管理者設定氣象署 API 金鑰。' });
  else if (!s.warnings) out.push({ key: 'warn', title: '氣象署特報', status: '讀取失敗', cls: 'm', desc: '稍後自動重試。' });
  else {
    const hz = s.warnings.mine;
    if (!hz.length) out.push({ key: 'warn', title: '氣象署特報', status: '無特報', cls: 'g', desc: `${s.county || '本地'}目前無天氣警特報。`, click: true });
    else {
      const severe = hz.some(h => /警報|豪雨|颱風/.test(h));
      out.push({ key: 'warn', title: '氣象署特報', status: hz.join('·'), cls: severe ? 'r' : 'y', desc: `${s.county}發布${hz.join('、')}，留意最新訊息並依應變計畫處置。`, click: true });
    }
  }
  // 颱風
  if (!s.hasKey) out.push({ key: 'ty', title: '颱風', status: '未連線', cls: 'm', desc: '需由管理者設定氣象署 API 金鑰。' });
  else if (!s.typhoons) out.push({ key: 'ty', title: '颱風', status: '讀取失敗', cls: 'm', desc: '稍後自動重試。' });
  else if (!s.typhoons.length) out.push({ key: 'ty', title: '颱風', status: '無颱風', cls: 'g', desc: '目前無熱帶氣旋資料。', click: true });
  else {
    const t = [...s.typhoons].sort((a, b) => (b.inside - a.inside) || (b.enterFut - a.enterFut) || (a.dist - b.dist))[0];
    let st = '注意動態', c = 'y';
    if (t.inside) { st = '已在暴風圈內'; c = 'r'; }
    else if (t.enterFut) { st = '預計進入暴風圈'; c = 'r'; }
    else if (t.dist > (t.r7 || 0) + 500) { st = '無直接威脅'; c = 'g'; }
    out.push({ key: 'ty', title: '颱風', status: st, cls: c, click: true,
      desc: `${t.name}（${t.cls}）距工地 ${KL.num(t.dist, 0)} km，七級風半徑 ${KL.num(t.r7, 0)} km。` });
  }
  // 地震
  {
    const q = s.quake?.last;
    if (!q) out.push({ key: 'eq', title: '地震', status: s.quake ? '正常' : '讀取失敗', cls: s.quake ? 'g' : 'm', desc: '近 30 日無顯著地震。' });
    else {
      const days = (Date.now() - q.time) / 864e5, iv = KL.intensityNum(q.int.text);
      let st = '正常', c = 'g', tip = '';
      if (iv >= th.quakeStopIntensity && days <= 1) { st = '停工檢查'; c = 'r'; tip = '，應停工檢查支撐、鷹架與吊具'; }
      else if (iv >= 3 && days <= 3) { st = '巡查'; c = 'y'; tip = '，建議巡查臨時構造物'; }
      out.push({ key: 'eq', title: '地震', status: st, cls: c, desc: `最近 M${KL.num(q.mag)} 本地震度 ${q.int.text}，${agoText(q.time)}${tip}。` });
    }
  }
  return out;
}
function agoText(t) {
  const m = (Date.now() - t) / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))} 分鐘前`;
  if (m < 1440) return `${Math.round(m / 60)} 小時前`;
  return `${Math.round(m / 1440)} 天前`;
}

/* ================= 畫面呈現 ================= */
function metric(id, label, value, unit, cls, sub) {
  $(id).innerHTML = `<div class="lbl">${label}</div><div class="val ${cls}">${value}<small>${unit}</small></div><div class="sub" title="${KL.esc(sub)}">${KL.esc(sub || '')}</div>`;
}

function render() {
  const s = App.snap, th = App.cfg.settings.thresholds;
  if (!s) return;
  const R = s.rain, T = s.temp, W = s.wind, Q = s.quake;

  $('#rainSrc').textContent = s.src.rain;
  metric('#mRainNow', '即時降雨強度', KL.num(R.now), 'mm/hr', KL.lvCls(R.now, th.rainNowStop * 0.5 + 0.01, th.rainNowStop * 2), R.model ? '模式推估本小時雨量' : '雨量站近 10 分鐘換算');
  metric('#mRain3h', '過去 3 小時', KL.num(R.past3h), 'mm', KL.lvCls(R.past3h, 15, 40), '累積');
  metric('#mRainDay', '當日累積雨量', KL.num(R.day), 'mm', KL.lvCls(R.day, th.dayHeavy, th.dayTorrential), `00:00 起算，大雨 ${th.dayHeavy} / 豪雨 ${th.dayTorrential}`);
  metric('#mRain12f', '未來 12 小時', KL.num(R.fut12), 'mm', KL.lvCls(R.fut12, th.rain12hWarn, th.rain12hStop), '預報累積');

  $('#tempSrc').textContent = s.src.temp;
  metric('#mTemp', '氣溫', KL.num(T.t), '°C', T.t == null ? 'c-m' : (T.t >= 35 || T.t < 5) ? 'c-r' : T.t > 32 ? 'c-y' : 'c-g', '澆置建議 5–32 °C');
  metric('#mRh', '相對濕度', KL.num(T.rh, 0), '%', KL.lvCls(T.rh, th.paintRhWarn, th.paintRhStop + 10), `露點 ${KL.num(T.dew)} °C · 風向 ${KL.dirName(T.dir)}`);
  metric('#mFeel', '體感溫度', KL.num(T.feel), '°C', T.feel >= 38 ? 'c-r' : T.feel >= 32 ? 'c-y' : 'c-g', `濕度 ${KL.num(T.rh, 0)} %　露點 ${KL.num(T.dew)} °C`);
  const HL = KL.heatLevel(T.hi);
  metric('#mHI', '熱危害指數', KL.num(T.hi), '°C', HL.lv >= 3 ? 'c-r' : HL.lv >= 1 ? 'c-y' : 'c-g', `${HL.name} · WBGT 約 ${KL.num(T.wbgt)} °C`);

  $('#windSrc').textContent = s.src.wind;
  const bf = v => { const b = KL.beaufort(v); return b == null ? '' : `${b} 級`; };
  metric('#mWind', '平均風速', KL.num(W.avg), 'm/s', KL.lvCls(W.avg, th.windAvgWarn, th.windAvgStop), `${bf(W.avg)} · 風向 ${KL.dirName(W.dir)}`);
  metric('#mGust24', '24 小時最大陣風', KL.num(W.gust24), 'm/s', KL.lvCls(W.gust24, th.gustWarn, th.gustStop), '過去 24 小時 · 模式推估');
  metric('#mGustNow', '最大陣風', KL.num(W.gustNow), 'm/s', KL.lvCls(W.gustNow, th.gustWarn, th.gustStop), bf(W.gustNow) + (s.station ? ` · ${s.station.name}` : ''));
  metric('#mGust12f', '未來 12 小時陣風', KL.num(W.fut12), 'm/s', KL.lvCls(W.fut12, th.gustWarn, th.gustStop), W.fut12At ? `估 ${KL.fmtTime(W.fut12At)}` : '');

  $('#quakeSrc').textContent = s.src.quake || '';
  if (Q && Q.last) {
    const q = Q.last, iv = KL.intensityNum(q.int.text);
    metric('#mQMag', '最近地震規模', 'M ' + KL.num(q.mag), '', q.mag >= 6 ? 'c-r' : q.mag >= 5 ? 'c-y' : 'c-g', `${KL.fmtMD(q.time)} ${KL.fmtTime(q.time)}　${agoText(q.time)}`);
    metric('#mQInt', '本地預測震度', KL.esc(q.int.text), '', iv >= 4 ? 'c-r' : iv >= 3 ? 'c-y' : 'c-g', q.int.src);
    metric('#mQDist', '震央距離', KL.num(q.dist, 0), 'km', q.dist < 50 ? 'c-y' : 'c-g', q.location);
  } else {
    metric('#mQMag', '最近地震規模', '--', '', 'c-m', Q ? '近 30 日無資料' : '讀取失敗');
    metric('#mQInt', '本地預測震度', '--', '', 'c-m', '');
    metric('#mQDist', '震央距離', '--', 'km', 'c-m', '');
  }
  metric('#mQCount', '近 7 日 M≥4', Q ? Q.count7 : '--', '次', Q && Q.count7 >= 3 ? 'c-y' : 'c-g', '工地周邊');

  renderHeat(T.t, T.rh, T.hi);
  renderTrend();
  renderStations();

  App.safety = evaluateSafety(s, th);
  $('#safetyGrid').innerHTML = App.safety.map((x, i) =>
    `<div class="sf ${x.cls}${x.click ? ' click' : ''}" data-i="${i}" title="${KL.esc(x.desc)}"><div class="t">${x.title}</div><div class="s">${KL.esc(x.status)}</div><div class="d">${KL.esc(x.desc)}</div></div>`).join('');
  renderTicker();

  $('#lastUpdate').textContent = KL.fmtDateTime(s.fetchedAt).slice(5) + (s.errors.length ? ' ⚠' : '');
  $('#lastUpdate').title = s.errors.join('\n');
  $('#dataSourceNote').textContent = s.hasKey ? '氣象署＋Open-Meteo' : 'Open-Meteo 模式（未設定氣象署金鑰）';
}

/* 熱指數表：列＝氣溫(°C)，欄＝相對濕度(%) */
const HEAT_T = [110, 108, 106, 104, 102, 100, 98, 96, 94, 92, 90, 88, 86, 84, 82, 80].map(f => (f - 32) * 5 / 9);
const HEAT_RH = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
function renderHeat(t, rh, hi) {
  const L = KL.heatLevel(hi);
  $('#heatNote').textContent = `溫度 ${KL.num(t)} °C · 濕度 ${KL.num(rh, 0)} % · ${L.name}`;
  let ri = -1, ci = -1;
  if (t != null && rh != null && t >= HEAT_T[HEAT_T.length - 1] - 0.6) {
    ri = HEAT_T.reduce((b, v, i) => Math.abs(v - t) < Math.abs(HEAT_T[b] - t) ? i : b, 0);
    ci = HEAT_RH.reduce((b, v, i) => Math.abs(v - rh) < Math.abs(HEAT_RH[b] - rh) ? i : b, 0);
    if (rh < 37.5) ci = -1;
  }
  let h = `<tr><th>°C\\%</th>${HEAT_RH.map((r, j) => `<th class="${j === ci ? 'cur' : ''}">${r}</th>`).join('')}</tr>`;
  HEAT_T.forEach((tc, i) => {
    h += `<tr><th class="${i === ri ? 'cur' : ''}">${tc.toFixed(1)}</th>`;
    HEAT_RH.forEach((r, j) => {
      const v = KL.heatIndex(tc, r), lv = KL.heatLevel(v).lv;
      h += `<td class="h${Math.max(lv, 0)}${i === ri && j === ci ? ' cur' : ''}">${v.toFixed(1)}</td>`;
    });
    h += '</tr>';
  });
  $('#heatTable').innerHTML = h;
}

function renderTrend() {
  const hs = App.snap.hourly, k = App.trendKey;
  const conf = { rain: ['rain', 'mm', '逐時雨量 mm（模式推估；金色為預報）'], gust: ['gust', 'm/s', '逐時陣風 m/s（模式推估；金色為預報）'], temp: ['temp', '°C', '逐時氣溫 °C（模式推估；金色為預報）'] }[k];
  const vals = hs.map(h => h[conf[0]] ?? 0);
  const lo = k === 'temp' ? Math.min(...vals) - 1 : 0;
  const hi = Math.max(...vals, k === 'rain' ? 2 : k === 'gust' ? 10 : lo + 5);
  $('#trendSub').textContent = conf[2];
  $('#trendChart').innerHTML = hs.map((h, i) => {
    const v = vals[i], pct = Math.max(1, (v - lo) / (hi - lo) * 100);
    return `<div class="bar ${h.isFut ? 'fut' : 'past'}${h.isNow ? ' now' : ''}" style="height:${pct}%" data-tip="${KL.fmtTime(h.time)} ${v.toFixed(1)} ${conf[1]}"></div>`;
  }).join('');
  const ticks = hs.filter((h, i) => i % 3 === 0).map(h => `<span>${KL.pad(h.time.getHours())}</span>`);
  $('#trendAxis').innerHTML = ticks.join('');
}

function renderStations() {
  const s = App.snap, box = $('#stationChips');
  if (!s.hasKey) { box.innerHTML = '<span class="small muted">（設定氣象署金鑰後自動偵測鄰近測站；目前使用模式資料）</span>'; return; }
  if (!s.stations || !s.stations.length) { box.innerHTML = '<span class="small muted">附近無可用測站</span>'; return; }
  box.innerHTML = s.stations.map(st =>
    `<span class="chip${s.station && s.station.id === st.id ? ' active' : ''}" data-st="${st.id}" title="${KL.esc(st.county + st.town)}">${KL.esc(st.name)} ${st.dist.toFixed(1)}km</span>`).join('') +
    (s.rainStation ? `<span class="chip" title="雨量站">☔ ${KL.esc(s.rainStation.name)} ${s.rainStation.dist.toFixed(1)}km</span>` : '');
}

/* 底部跑馬燈與警報音 */
function renderTicker() {
  const reds = App.safety.filter(x => x.cls === 'r'), ys = App.safety.filter(x => x.cls === 'y');
  const tk = $('#ticker');
  tk.classList.toggle('ok', !reds.length && !ys.length);
  tk.classList.toggle('warn', !reds.length && ys.length > 0);
  const items = [...reds, ...ys];
  const txt = items.length
    ? items.map(x => `<span>${x.cls === 'r' ? '⛔' : '⚠'} ${KL.esc(x.title)}　${KL.esc(x.status)}　${KL.esc(x.desc)}</span>`).join('')
    : `<span>✅ ${KL.esc(App.site.name)}　各項監測正常，持續注意天候變化</span>`;
  $('#tickerTrack').innerHTML = txt + txt;
  $('#tickerTrack').style.animationDuration = Math.max(25, items.length * 12) + 's';
  const sig = reds.map(x => x.key + x.status).join('|');
  if (sig && sig !== App.lastReds && !App.muted) beep();
  App.lastReds = sig;
}
function beep() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach(t => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.05;
      o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.2);
    });
  } catch (e) { /* 瀏覽器未允許播放音效 */ }
}

/* ================= 工地與資料載入 ================= */
function siteList() { return App.cfg.sites.filter(s => s.enabled !== false); }

function renderSiteButtons() {
  const list = siteList();
  $('#siteButtons').innerHTML = list.map(s =>
    `<button class="site-btn${App.site && App.site.id === s.id ? ' active' : ''}" data-id="${s.id}"><span class="dot" id="dot-${s.id}"></span>${KL.esc(s.name)}</button>`).join('') +
    (App.site && App.site.custom ? `<button class="site-btn active">📍 ${KL.esc(App.site.name)}</button>` : '');
  updateSiteDots();
}
async function updateSiteDots() {
  const list = siteList(); if (!list.length) return;
  try {
    const th = App.cfg.settings.thresholds;
    const rs = await DataSrc.openMeteoMulti(list);
    rs.forEach((r, i) => {
      const c = r.current || {}, el = document.getElementById('dot-' + list[i].id); if (!el) return;
      const hi = KL.heatIndex(c.temperature_2m, c.relative_humidity_2m);
      const red = c.wind_gusts_10m >= th.gustStop || c.wind_speed_10m >= th.windAvgStop || c.precipitation >= th.rainNowStop || KL.heatLevel(hi).lv >= 3;
      const yel = c.wind_gusts_10m >= th.gustWarn || c.precipitation >= th.rainNowWarn || KL.heatLevel(hi).lv >= 2;
      el.className = 'dot ' + (red ? 'r' : yel ? 'y' : 'g');
      el.parentElement.title = `陣風 ${KL.num(c.wind_gusts_10m)} m/s · 雨 ${KL.num(c.precipitation)} mm · ${KL.num(c.temperature_2m)} °C`;
    });
  } catch (e) { /* 燈號為輔助資訊，失敗略過 */ }
}

function selectSite(site, save = true) {
  App.site = site; App.stationId = null;
  if (save && !site.custom) localStorage.setItem(LS_SITE, site.id);
  $('#siteName').textContent = site.name;
  const info = [site.county, site.address, site.code && `工程編號 ${site.code}`, site.manager && `工地主任 ${site.manager}`, `${(+site.lat).toFixed(4)}, ${(+site.lon).toFixed(4)}`].filter(Boolean);
  $('#siteInfo').textContent = info.join('　');
  $('#inpLat').value = (+site.lat).toFixed(4); $('#inpLon').value = (+site.lon).toFixed(4);
  renderSiteButtons();
  setMapView(App.mapView || 'radar');
  refresh();
}

async function refresh() {
  if (!App.site) return;
  const btn = $('#btnRefresh'); btn.disabled = true; btn.textContent = '⟳ 更新中…';
  try {
    App.snap = await DataSrc.snapshot(App.site, App.cfg, { stationId: App.stationId });
    render();
  } catch (e) {
    console.error(e);
    KL.toast('資料更新失敗：' + e.message + '（將於下次自動重試）', 5000);
  } finally {
    btn.disabled = false; btn.textContent = '⟳ 重新整理';
  }
  loadRadar();
  clearTimeout(App.timer);
  App.timer = setTimeout(refresh, App.cfg.settings.refreshMinutes * 60e3);
}

/* ================= 雷達與 Windy ================= */
const RADAR_BASE = 'https://www.cwa.gov.tw/Data/radar/';
function loadRadar() {
  const img = $('#radarImg');
  img.onerror = () => { img.onerror = null; img.src = `${RADAR_BASE}CV1_3600.png?t=${Date.now()}`; };
  img.src = `${RADAR_BASE}CV1_TW_3600.png?t=${Math.floor(Date.now() / 120000)}`;
}
const WINDY_LAYERS = [['wind', '風速'], ['gust', '陣風'], ['rain', '雨量'], ['radar', '雷達'], ['satellite', '衛星'], ['temp', '氣溫'], ['clouds', '雲量'], ['thunder', '雷擊'], ['waves', '海浪']];
function windyUrl(layer, zoom, detail) {
  const { lat, lon } = App.site;
  const p = new URLSearchParams({
    type: 'map', location: 'coordinates', metricRain: 'mm', metricTemp: '°C', metricWind: 'm/s', zoom: String(zoom),
    overlay: layer, product: 'ecmwf', level: 'surface', lat: (+lat).toFixed(3), lon: (+lon).toFixed(3),
    detailLat: (+lat).toFixed(3), detailLon: (+lon).toFixed(3), marker: 'true', message: 'true'
  });
  if (detail) p.set('detail', 'true');
  return `https://embed.windy.com/embed.html?${p}`;
}
function layerChips(active, attr) {
  return WINDY_LAYERS.map(([k, n]) => `<span class="chip${k === active ? ' active' : ''}" ${attr}="${k}">${n}</span>`).join('');
}
function setMapView(v) {
  App.mapView = v;
  document.querySelectorAll('.radar-panel .tab').forEach(b => b.classList.toggle('active', b.dataset.map === v));
  const isW = v === 'windy';
  $('#windyBox').hidden = !isW; $('#radarImg').hidden = isW;
  $('#radarNote').textContent = isW ? 'Windy 圖資 · 可拖曳縮放' : '氣象署合成回波 · 點圖可放大';
  if (isW && App.site) {
    $('#windyLayersMini').innerHTML = layerChips(App.windyLayer, 'data-wl');
    $('#windyMini').src = windyUrl(App.windyLayer, 7, false);
  }
}

/* ================= 彈出視窗 ================= */
function openModal(title, html, tools = '') {
  $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html; $('#modalTools').innerHTML = tools;
  $('#modal').hidden = false; document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('#modal').hidden = true; $('#modalBody').innerHTML = ''; document.body.style.overflow = '';
  clearInterval(App.radarAnim);
}

function showHourly() {
  const hs = App.snap.hourly;
  const rows = hs.map(h => `<tr class="${h.isNow ? 'now' : h.isFut ? 'fut' : ''}">
    <td>${KL.fmtMD(h.time)} ${KL.fmtTime(h.time)}${h.isNow ? ' ◀ 現在' : h.isFut ? '（預報）' : ''}</td>
    <td>${KL.num(h.rain)}</td><td>${KL.num(h.rain3)}</td><td>${KL.num(h.temp)}</td><td>${KL.num(h.rh, 0)}</td>
    <td>${KL.num(h.wind)}</td><td>${KL.num(h.gust)}</td><td>${KL.dirName(h.dir)}</td><td>${KL.num(h.pop, 0)}</td><td>${KL.num(h.pressure)}</td></tr>`).join('');
  openModal(`逐時明細 · ${App.site.name}`, `<table class="data"><thead><tr><th>時間</th><th>雨量 mm</th><th>3hr 累積</th><th>氣溫 °C</th><th>濕度 %</th><th>風速 m/s</th><th>陣風 m/s</th><th>風向</th><th>降雨機率 %</th><th>氣壓 hPa</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small muted">逐時數值為 Open-Meteo 數值模式資料（過去時段為模式分析、未來時段為預報），供趨勢參考。</p>`);
}

function radarFrames() {
  const out = []; const t = new Date(Date.now() - 10 * 60e3);
  t.setMinutes(Math.floor(t.getMinutes() / 10) * 10, 0, 0);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(t - i * 10 * 60e3);
    const s = `${d.getFullYear()}${KL.pad(d.getMonth() + 1)}${KL.pad(d.getDate())}${KL.pad(d.getHours())}${KL.pad(d.getMinutes())}`;
    out.push({ url: `${RADAR_BASE}CV1_TW_3600_${s}.png`, label: KL.fmtTime(d) });
  }
  return out;
}
function showRadar() {
  openModal('氣象署雷達回波（近 2 小時動畫）', `
    <div class="radar-ctrl"><button class="btn btn-accent" id="rPlay">⏸ 暫停</button><input type="range" id="rRange" min="0" max="11" value="11" style="flex:1"><span id="rLabel" class="small"></span></div>
    <img class="radar-big" id="rImg" alt="雷達回波" referrerpolicy="no-referrer">
    <p class="small muted">資料來源：中央氣象署。最新一張約延遲 10–20 分鐘。</p>`);
  const fr = radarFrames(); const ok = fr.map(() => true);
  const imgs = fr.map((f, i) => { const im = new Image(); im.referrerPolicy = 'no-referrer'; im.onerror = () => { ok[i] = false; }; im.src = f.url; return im; });
  let i = fr.length - 1, playing = true;
  const show = () => {
    let n = 0; while (!ok[i] && n++ < fr.length) i = (i + fr.length - 1) % fr.length;
    $('#rImg').src = imgs[i].src; $('#rLabel').textContent = fr[i].label; $('#rRange').value = i;
  };
  show();
  App.radarAnim = setInterval(() => { if (playing) { i = (i + 1) % fr.length; show(); } }, 700);
  $('#rPlay').onclick = () => { playing = !playing; $('#rPlay').textContent = playing ? '⏸ 暫停' : '▶ 播放'; };
  $('#rRange').oninput = e => { playing = false; $('#rPlay').textContent = '▶ 播放'; i = +e.target.value; show(); };
}

function showWindy(layer = App.windyLayer) {
  openModal(`Windy 圖資 · ${App.site.name}`, `
    <div class="windy-layers" id="windyLayersBig" style="margin-bottom:8px">${layerChips(layer, 'data-wlb')}</div>
    <iframe class="windy-full" id="windyBig" src="${windyUrl(layer, 8, true)}" title="Windy" allowfullscreen></iframe>
    <p class="small muted">圖資來源：Windy.com（ECMWF 模式）。可切換圖層、拖曳地圖與點選時間軸查看預報。</p>`,
    `<a class="btn btn-mini" target="_blank" rel="noopener" href="https://www.windy.com/${(+App.site.lat).toFixed(3)}/${(+App.site.lon).toFixed(3)}?${layer},${(+App.site.lat).toFixed(3)},${(+App.site.lon).toFixed(3)},9">↗ 開啟 Windy 網站</a>`);
}

function showTyphoon() {
  const s = App.snap;
  let h = '';
  if (s.warnings && s.warnings.all.length) {
    const mine = s.warnings.mine;
    h += `<div class="typhoon"><h3>⚠ 天氣警特報</h3>
      ${mine.length ? `<div class="c-r"><b>本工地所在（${KL.esc(s.county)}）生效中：${KL.esc(mine.join('、'))}</b></div>` : `<div>本工地所在（${KL.esc(s.county)}）目前無警特報。</div>`}
      <div class="small muted">全臺生效中：${s.warnings.all.map(w => `${KL.esc(w.county)}（${KL.esc(w.hazards.join('、'))}）`).join('、')}</div></div>`;
  } else if (s.warnings) h += `<div class="typhoon" style="border-color:var(--green)"><h3>天氣警特報</h3>目前全臺無生效中的天氣警特報。</div>`;
  if (s.typhoons && s.typhoons.length) {
    for (const t of s.typhoons) {
      const c = t.closest;
      const judge = t.inside ? `已在暴風圈內，七級風暴風半徑 ${KL.num(t.r7, 0)} km，工地距中心 ${KL.num(t.dist, 0)} km，應即停止所有高處與吊掛作業，塔吊收桿解除迴轉制動。`
        : t.enterFut ? `預計約 +${c.tau} 小時進入暴風圈，應提前完成防颱整備（鷹架、圍籬、材料固定與排水）。`
          : `目前未在暴風圈內，持續注意動態。`;
      h += `<div class="typhoon"><h3>🌀 ${KL.esc(t.name)} ${KL.esc(t.en)} ${t.no ? '編號 ' + KL.esc(t.no) : ''}</h3>
        強度：${t.cls}　近中心最大風速 ${KL.num(t.wind, 0)} m/s　瞬間最大陣風 ${KL.num(t.gust, 0)} m/s　中心氣壓 ${KL.num(t.pressure, 0)} hPa<br>
        暴風半徑：七級風 ${KL.num(t.r7, 0)} km　十級風 ${KL.num(t.r10, 0)} km<br>
        距本工地：<b>${KL.num(t.dist, 0)} km</b>　${t.movePred ? KL.esc(t.movePred) : `以每小時 ${KL.num(t.speed, 0)} 公里速度，向 ${KL.esc(t.moveDir || '--')} 前進`}　觀測 ${KL.esc(t.time || '')}<br>
        <b class="${t.inside || t.enterFut ? 'c-r' : 'c-y'}">研判：${judge}</b><br>
        ${c ? `<span class="small muted">預報路徑最近接近：約 ${KL.num(c.dist, 0)} km（+${c.tau} 小時，屆時近中心風速 ${KL.num(c.wind, 0)} m/s${c.p70 ? `，70% 機率半徑 ${KL.num(c.p70, 0)} km` : ''}）</span>` : ''}</div>`;
    }
  } else if (s.typhoons) h += `<div class="typhoon" style="border-color:var(--green)"><h3>颱風動態</h3>目前無熱帶氣旋資料。</div>`;
  if (!s.hasKey) h = '<p>需由管理者於「管理後台 → 系統設定」填入中央氣象署開放資料 API 金鑰，才能取得特報與颱風資料。</p>';
  openModal('颱風動態與警特報', h + '<p class="small muted">資料：中央氣象署</p>');
}

/* ================= 時鐘 ================= */
function tick() {
  const d = new Date();
  $('#clockHM').textContent = `${KL.pad(d.getHours())}:${KL.pad(d.getMinutes())}`;
  $('#clockS').textContent = KL.pad(d.getSeconds());
  $('#footDate').textContent = `${d.getFullYear()}/${KL.pad(d.getMonth() + 1)}/${KL.pad(d.getDate())}（星期${KL.WEEK[d.getDay()]}）`;
}

/* ================= 事件 ================= */
function bindEvents() {
  $('#siteButtons').addEventListener('click', e => {
    const b = e.target.closest('.site-btn[data-id]'); if (!b) return;
    const s = App.cfg.sites.find(x => x.id === b.dataset.id); if (s) selectSite(s);
  });
  $('#stationChips').addEventListener('click', e => {
    const c = e.target.closest('[data-st]'); if (!c) return;
    App.stationId = c.dataset.st; refresh();
  });
  const custom = (lat, lon, name) => {
    if (!KL.validLatLon(lat, lon)) return KL.toast('座標需位於臺灣地區（緯度 20–27、經度 116–123）');
    selectSite({ id: 'custom', custom: true, name: name || `自訂位置 ${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon, county: '' }, false);
  };
  $('#btnQuery').onclick = async () => {
    const q = $('#inpPlace').value.trim();
    if (q) {
      try { const g = await DataSrc.geocode(q); custom(g.lat, g.lon, g.name); }
      catch (e) { KL.toast(e.message); }
    } else custom(parseFloat($('#inpLat').value), parseFloat($('#inpLon').value));
  };
  $('#inpPlace').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnQuery').click(); });
  $('#btnGeo').onclick = () => {
    if (!navigator.geolocation) return KL.toast('此裝置不支援定位');
    KL.toast('定位中…');
    navigator.geolocation.getCurrentPosition(p => custom(p.coords.latitude, p.coords.longitude, '目前位置'),
      err => KL.toast('無法取得位置：' + err.message), { enableHighAccuracy: true, timeout: 15000 });
  };
  $('#btnRefresh').onclick = refresh;
  $('#trendTabs').addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('.tab'); if (!b) return;
    App.trendKey = b.dataset.k;
    document.querySelectorAll('#trendTabs .tab').forEach(x => x.classList.toggle('active', x === b));
    renderTrend();
  });
  $('#trendPanel').addEventListener('click', () => App.snap && showHourly());
  $('#radarImg').onclick = showRadar;
  document.querySelector('.radar-panel .tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) setMapView(b.dataset.map); });
  $('#windyLayersMini').addEventListener('click', e => { const c = e.target.closest('[data-wl]'); if (!c) return; App.windyLayer = c.dataset.wl; setMapView('windy'); });
  $('#btnWindy').onclick = () => App.site && showWindy();
  $('#safetyGrid').addEventListener('click', e => {
    const c = e.target.closest('.sf.click'); if (!c) return;
    const it = App.safety[+c.dataset.i]; if (it && (it.key === 'ty' || it.key === 'warn')) showTyphoon();
  });
  $('#btnReport').onclick = () => {
    if (!App.snap) return KL.toast('資料尚未載入');
    Report.open(App, openModal);
  };
  $('#modal').addEventListener('click', e => {
    if (e.target.closest('[data-close]')) return closeModal();
    const c = e.target.closest('[data-wlb]');
    if (c) { App.windyLayer = c.dataset.wlb; showWindy(c.dataset.wlb); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
  const muteLabel = () => ($('#btnMute').textContent = App.muted ? '🔕 已靜音' : '🔔 靜音');
  muteLabel();
  $('#btnMute').onclick = () => { App.muted = !App.muted; localStorage.setItem('klwsdemo_muted', App.muted ? '1' : '0'); muteLabel(); };
  $('#btnTickerClose').onclick = () => { $('.footer').hidden = true; };
  $('#btnExitPreview').onclick = () => { localStorage.removeItem(KL.LS_PREVIEW); location.reload(); };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && App.snap && Date.now() - App.snap.fetchedAt > App.cfg.settings.refreshMinutes * 60e3) refresh();
  });
}

/* ================= PWA 安裝 ================= */
function setupPWA() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  let deferred = null;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#btnInstall').hidden = false; });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (ios && !standalone) $('#btnInstall').hidden = false;
  $('#btnInstall').onclick = async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; $('#btnInstall').hidden = true; }
    else if (ios) openModal('安裝到主畫面（iPhone / iPad）', '<ol style="line-height:2"><li>請使用 <b>Safari</b> 開啟本網頁</li><li>點下方「分享」按鈕 <b>⬆︎</b></li><li>選擇「<b>加入主畫面</b>」</li><li>按「新增」，主畫面就會出現示範工地監控 APP 圖示</li></ol>');
  };
  window.addEventListener('appinstalled', () => { $('#btnInstall').hidden = true; KL.toast('已安裝 APP'); });
}

/* ================= 展示版瀏覽人次 =================
   計數服務 Abacus（abacus.jasoncameron.dev，免費免註冊）。同一個分頁工作階段只算一次，
   重新整理或切換工地不重複計算；本機測試只讀取不累加。失敗時不顯示，不影響主畫面。 */
async function countView(key) {
  const SS_COUNTED = 'klwsdemo_view_counted';
  let counted = false;
  try { counted = sessionStorage.getItem(SS_COUNTED) === '1'; } catch (e) { /* 無法使用 sessionStorage 時視為新瀏覽 */ }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const verb = counted || local ? 'get' : 'hit';
  try {
    const r = await fetch(`https://abacus.jasoncameron.dev/${verb}/${key}`, { cache: 'no-store' });
    if (!r.ok) return;
    const n = (await r.json()).value;
    if (typeof n !== 'number' || n < 0) return;
    if (verb === 'hit') { try { sessionStorage.setItem(SS_COUNTED, '1'); } catch (e) { /* 略過 */ } }
    $('#demoViews').textContent = `👀 已瀏覽 ${n.toLocaleString('zh-TW')} 人次`;
    $('#demoViews').hidden = false;
  } catch (e) { /* 計數服務無法連線時不顯示 */ }
}

/* ================= 啟動 ================= */
(async function init() {
  tick(); setInterval(tick, 1000);
  bindEvents(); setupPWA();
  try {
    App.cfg = await KL.loadConfig();
  } catch (e) {
    KL.toast(e.message, 8000); return;
  }
  if (App.cfg._draft) $('#previewBanner').hidden = false;
  const demo = App.cfg.settings.demo;
  if (demo && demo.enabled) {
    $('#demoBar').hidden = false;
    if (demo.contactUrl) { $('#demoCta').href = demo.contactUrl; $('#demoCta').textContent = demo.contactText || '洽詢客製化'; }
    else $('#demoCta').remove();
    if (demo.counter) countView(demo.counter);
  }
  $('#companyName').textContent = App.cfg.company || '示範營造股份有限公司';
  $('#footCompany').textContent = App.cfg.company || '示範營造股份有限公司';
  const list = siteList();
  const qs = new URLSearchParams(location.search);
  const want = qs.get('site') || localStorage.getItem(LS_SITE);
  const first = list.find(s => s.id === want) || list[0];
  if (first) selectSite(first, false);
  else { $('#siteName').textContent = '尚未建立工地'; $('#siteInfo').textContent = '請管理者登入後台新增工地專案，或於上方輸入地點查詢。'; }
})();
