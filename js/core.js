/* 共用工具：設定檔載入、計算公式、格式化 */
'use strict';

const KL = {
  VERSION: '1.0.1',
  CONFIG_URL: 'data/config.json',
  LS_DRAFT: 'klwsdemo_draft_config',
  LS_PREVIEW: 'klwsdemo_preview_draft',
  COUNTIES: ['基隆市', '臺北市', '新北市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣',
    '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣'],
  DEFAULT_THRESHOLDS: {
    windAvgWarn: 7, windAvgStop: 10, gustWarn: 10, gustStop: 15,
    rainNowWarn: 0.5, rainNowStop: 10, rain12hWarn: 10, rain12hStop: 50,
    dayHeavy: 80, dayTorrential: 200, paintRhWarn: 80, paintRhStop: 85, quakeStopIntensity: 4
  }
};

KL.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
KL.$ = sel => document.querySelector(sel);
KL.num = (v, d = 1) => (v == null || isNaN(v)) ? '--' : Number(v).toFixed(d);
KL.pad = n => String(n).padStart(2, '0');
KL.fmtTime = d => `${KL.pad(d.getHours())}:${KL.pad(d.getMinutes())}`;
KL.fmtMD = d => `${KL.pad(d.getMonth() + 1)}/${KL.pad(d.getDate())}`;
KL.fmtDateTime = d => `${d.getFullYear()}/${KL.pad(d.getMonth() + 1)}/${KL.pad(d.getDate())} ${KL.fmtTime(d)}`;
KL.WEEK = ['日', '一', '二', '三', '四', '五', '六'];

KL.toast = (msg, ms = 3000) => {
  const t = document.getElementById('toast');
  if (!t) return alert(msg);
  t.textContent = msg; t.hidden = false;
  clearTimeout(KL._toastT); KL._toastT = setTimeout(() => (t.hidden = true), ms);
};

/* 讀取設定檔；若此裝置開啟「草稿預覽」則改用本機草稿 */
KL.loadConfig = async (allowPreview = true) => {
  if (allowPreview && localStorage.getItem(KL.LS_PREVIEW) === '1') {
    try {
      const d = JSON.parse(localStorage.getItem(KL.LS_DRAFT));
      if (d && d.sites) return KL.normalizeConfig(d, true);
    } catch (e) { /* 草稿損毀則改讀正式設定 */ }
  }
  const r = await fetch(`${KL.CONFIG_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('無法讀取設定檔 config.json');
  return KL.normalizeConfig(await r.json(), false);
};
KL.normalizeConfig = (c, isDraft) => {
  c.settings = c.settings || {};
  c.settings.thresholds = Object.assign({}, KL.DEFAULT_THRESHOLDS, c.settings.thresholds || {});
  c.settings.github = Object.assign({ owner: '', repo: '', branch: 'main', path: 'data/config.json' }, c.settings.github || {});
  c.settings.refreshMinutes = Number(c.settings.refreshMinutes) || 5;
  c.sites = c.sites || []; c.admins = c.admins || [];
  c._draft = !!isDraft;
  return c;
};

KL.sha256 = async text => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
};
KL.randHex = (n = 8) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');

/* 兩點距離（公里） */
KL.distKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};
/* 方位角（度，自 from 指向 to） */
KL.bearing = (lat1, lon1, lat2, lon2) => {
  const rad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
};
KL.DIR16 = ['北', '北北東', '東北', '東北東', '東', '東南東', '東南', '南南東', '南', '南南西', '西南', '西南西', '西', '西北西', '西北', '北北西'];
KL.dirName = deg => (deg == null || isNaN(deg)) ? '--' : KL.DIR16[Math.round(deg / 22.5) % 16];

/* 蒲福風級 */
KL.beaufort = ms => {
  if (ms == null || isNaN(ms)) return null;
  const t = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7, 37.0, 41.5, 46.2, 51.0, 56.1, 61.3];
  let i = 0; while (i < t.length && ms >= t[i]) i++;
  return i;
};

/* 熱指數（NWS Rothfusz，輸入/輸出 °C） */
KL.heatIndex = (tC, rh) => {
  if (tC == null || rh == null) return null;
  const T = tC * 9 / 5 + 32;
  let hi = 0.5 * (T + 61 + (T - 68) * 1.2 + rh * 0.094);
  if ((hi + T) / 2 >= 80) {
    hi = -42.379 + 2.04901523 * T + 10.14333127 * rh - 0.22475541 * T * rh - 0.00683783 * T * T
      - 0.05481717 * rh * rh + 0.00122874 * T * T * rh + 0.00085282 * T * rh * rh - 0.00000199 * T * T * rh * rh;
    if (rh < 13 && T >= 80 && T <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    else if (rh > 85 && T >= 80 && T <= 87) hi += ((rh - 85) / 10) * ((87 - T) / 5);
  }
  return (hi - 32) * 5 / 9;
};
/* 勞動部熱危害分級（依熱指數） */
KL.heatLevel = hi => {
  if (hi == null) return { lv: -1, name: '--', cls: 'm' };
  if (hi >= 54) return { lv: 4, name: '第四級', cls: 'r', desc: '極度危險，應停止戶外作業' };
  if (hi >= 41) return { lv: 3, name: '第三級', cls: 'r', desc: '危險，縮短作業時間並增加休息' };
  if (hi >= 32) return { lv: 2, name: '第二級', cls: 'y', desc: '警告，定時補充水分與休息' };
  if (hi >= 26.7) return { lv: 1, name: '第一級', cls: 'y', desc: '注意，基本防護原則，從事重體力作業應留意' };
  return { lv: 0, name: '未達高溫風險', cls: 'g', desc: '仍應適時補充水分' };
};
/* WBGT 簡易估算（澳洲氣象局公式，陰影下） */
KL.wbgt = (tC, rh) => {
  if (tC == null || rh == null) return null;
  const e = (rh / 100) * 6.105 * Math.exp(17.27 * tC / (237.7 + tC));
  return 0.567 * tC + 0.393 * e + 3.94;
};
KL.dewPoint = (tC, rh) => {
  if (tC == null || rh == null || rh <= 0) return null;
  const a = 17.27, b = 237.7, g = a * tC / (b + tC) + Math.log(rh / 100);
  return b * g / (a - g);
};
KL.uvLevel = uv => {
  if (uv == null) return { name: '--', cls: 'm' };
  if (uv >= 11) return { name: '危險級', cls: 'r', desc: '避免戶外曝曬' };
  if (uv >= 8) return { name: '過量級', cls: 'r', desc: '加強防曬，避免長時間曝曬' };
  if (uv >= 6) return { name: '高量級', cls: 'y', desc: '戴帽、穿長袖、擦防曬' };
  if (uv >= 3) return { name: '中量級', cls: 'g', desc: '建議戴帽或撐傘' };
  return { name: '低量級', cls: 'g', desc: '無須特別防曬' };
};
/* 地震震度（氣象署 PGA 分級） */
KL.intensityFromPGA = pga => {
  const t = [[800, '7級'], [440, '6強'], [250, '6弱'], [140, '5強'], [80, '5弱'], [25, '4級'], [8, '3級'], [2.5, '2級'], [0.8, '1級']];
  for (const [v, n] of t) if (pga >= v) return n;
  return '0級';
};
KL.intensityNum = s => {
  if (!s) return 0;
  const m = String(s).match(/(\d)/);
  if (!m) return 0;
  return Number(m[1]) + (/強/.test(s) ? 0.5 : 0);
};

/* 顯示用：依門檻回傳顏色 class */
KL.lvCls = (v, warn, stop) => (v == null || isNaN(v)) ? 'c-m' : v >= stop ? 'c-r' : v >= warn ? 'c-y' : 'c-g';

/* 工地座標驗證（臺灣及離島範圍） */
KL.validLatLon = (lat, lon) => isFinite(lat) && isFinite(lon) && lat >= 20 && lat <= 27 && lon >= 116 && lon <= 123;
