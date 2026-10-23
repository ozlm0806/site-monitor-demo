/* 資料擷取：Open-Meteo（免金鑰）、中央氣象署開放資料（需金鑰，可選）、USGS 地震 */
'use strict';

const DataSrc = (() => {
  const CWA = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/';
  const cache = new Map(); // key -> {t, data}

  async function getJSON(url, ttlMs = 0, timeoutMs = 20000) {
    if (ttlMs) {
      const c = cache.get(url);
      if (c && Date.now() - c.t < ttlMs) return c.data;
    }
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (ttlMs) cache.set(url, { t: Date.now(), data });
      return data;
    } finally { clearTimeout(tm); }
  }
  const cwaUrl = (id, key, q = '') => `${CWA}${id}?Authorization=${encodeURIComponent(key)}&format=JSON${q}`;
  const val = v => { const n = Number(v); return (v === null || v === '' || isNaN(n) || n <= -90) ? null : n; };

  /* ---------- Open-Meteo 模式資料 ---------- */
  async function openMeteo(lat, lon) {
    const hourly = 'temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,uv_index';
    const current = 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${hourly}&current=${current}` +
      `&wind_speed_unit=ms&timezone=Asia%2FTaipei&past_days=2&forecast_days=2`;
    return getJSON(url, 5 * 60e3);
  }
  /* 多工地即時概況（工地按鈕上的燈號） */
  async function openMeteoMulti(sites) {
    if (!sites.length) return [];
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${sites.map(s => s.lat).join(',')}&longitude=${sites.map(s => s.lon).join(',')}` +
      `&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_gusts_10m&wind_speed_unit=ms&timezone=Asia%2FTaipei`;
    const d = await getJSON(url, 5 * 60e3);
    return Array.isArray(d) ? d : [d];
  }

  /* ---------- 地名查座標 ---------- */
  async function geocode(q) {
    try {
      const d = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=zh&format=json`);
      const r = (d.results || []).find(x => x.country_code === 'TW') || (d.results || [])[0];
      if (r) return { lat: r.latitude, lon: r.longitude, name: [r.name, r.admin1].filter(x => x && !/ or /.test(x) && x !== r.name).join('，') };
    } catch (e) { /* 改用 Nominatim */ }
    const d2 = await getJSON(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=zh-TW&countrycodes=tw&q=${encodeURIComponent(q)}`);
    if (d2 && d2[0]) return { lat: +d2[0].lat, lon: +d2[0].lon, name: d2[0].display_name.split(',').slice(0, 2).join('，') };
    throw new Error('找不到此地點');
  }

  /* ---------- 氣象署：自動氣象站 / 雨量站 ---------- */
  function stationCoord(st) {
    const cs = st.GeoInfo?.Coordinates || [];
    const c = cs.find(x => /WGS84/i.test(x.CoordinateName)) || cs[0];
    return c ? { lat: +c.StationLatitude, lon: +c.StationLongitude } : null;
  }
  async function cwaStations(key) {
    const d = await getJSON(cwaUrl('O-A0001-001', key), 5 * 60e3);
    return (d.records?.Station || []).map(st => {
      const c = stationCoord(st); const w = st.WeatherElement || {};
      return c && {
        id: st.StationId, name: st.StationName, lat: c.lat, lon: c.lon,
        county: st.GeoInfo?.CountyName, town: st.GeoInfo?.TownName, obsTime: st.ObsTime?.DateTime,
        temp: val(w.AirTemperature), rh: val(w.RelativeHumidity), wind: val(w.WindSpeed), dir: val(w.WindDirection),
        gust: val(w.GustInfo?.PeakGustSpeed), pressure: val(w.AirPressure), rainDay: val(w.Now?.Precipitation),
        uv: val(w.UVIndex)
      };
    }).filter(Boolean);
  }
  async function cwaRainStations(key) {
    const d = await getJSON(cwaUrl('O-A0002-001', key), 5 * 60e3);
    return (d.records?.Station || []).map(st => {
      const c = stationCoord(st); const r = st.RainfallElement || {};
      return c && {
        id: st.StationId, name: st.StationName, lat: c.lat, lon: c.lon, county: st.GeoInfo?.CountyName,
        obsTime: st.ObsTime?.DateTime,
        p10m: val(r.Past10Min?.Precipitation), p1h: val(r.Past1hr?.Precipitation), p3h: val(r.Past3hr?.Precipitation),
        p6h: val(r.Past6Hr?.Precipitation ?? r.Past6hr?.Precipitation), p24h: val(r.Past24hr?.Precipitation),
        day: val(r.Now?.Precipitation)
      };
    }).filter(Boolean);
  }
  const nearest = (list, lat, lon, filter = () => true) =>
    list.filter(filter).map(s => ({ ...s, dist: KL.distKm(lat, lon, s.lat, s.lon) })).sort((a, b) => a.dist - b.dist);

  /* ---------- 地震 ---------- */
  // 氣象署時間可能是 "2026-10-13T17:30:10+08:00" 或 "2026-10-13 17:30:10"
  const parseTwTime = s => {
    const t = String(s || '').trim().replace(' ', 'T');
    return new Date(/[+-]\d\d:?\d\d$|Z$/.test(t) ? t : t + '+08:00');
  };
  async function cwaQuakes(key) {
    const d = await getJSON(cwaUrl('E-A0015-001', key, '&limit=30'), 5 * 60e3);
    return (d.records?.Earthquake || []).map(q => {
      const i = q.EarthquakeInfo || {};
      return {
        no: q.EarthquakeNo, report: q.ReportContent, time: parseTwTime(i.OriginTime),
        mag: val(i.EarthquakeMagnitude?.MagnitudeValue), depth: val(i.FocalDepth),
        lat: val(i.Epicenter?.EpicenterLatitude), lon: val(i.Epicenter?.EpicenterLongitude), location: i.Epicenter?.Location || '',
        areas: q.Intensity?.ShakingArea || []
      };
    });
  }
  async function usgsQuakes(lat, lon) {
    const start = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const d = await getJSON(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${start}&latitude=${lat}&longitude=${lon}&maxradiuskm=400&minmagnitude=3&orderby=time&limit=100`, 10 * 60e3);
    return (d.features || []).map(f => ({
      time: new Date(f.properties.time), mag: f.properties.mag, depth: f.geometry.coordinates[2],
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], location: f.properties.place || '', areas: []
    }));
  }
  /* 估算工地震度 */
  function estIntensity(q, lat, lon) {
    const epi = KL.distKm(lat, lon, q.lat, q.lon);
    const r = Math.max(Math.sqrt(epi * epi + (q.depth || 10) ** 2), 5);
    const pga = 1.657 * Math.exp(1.533 * q.mag) * Math.pow(r, -1.607);
    return KL.intensityFromPGA(pga);
  }
  function siteIntensity(q, lat, lon, county) {
    let best = null;
    for (const a of q.areas) {
      for (const s of (a.EqStation || [])) {
        const d = KL.distKm(lat, lon, +s.StationLatitude, +s.StationLongitude);
        if (!best || d < best.dist) best = { dist: d, name: s.StationName, int: s.SeismicIntensity };
      }
    }
    if (best && best.dist <= 25) return { text: best.int, src: `${best.name} 站 ${best.dist.toFixed(0)} km` };
    if (county) {
      const a = q.areas.find(x => (x.CountyName || '').includes(county) || (x.AreaDesc || '').includes(county));
      if (a) return { text: a.AreaIntensity, src: `${county} 最大震度` };
    }
    return { text: estIntensity(q, lat, lon), src: '依規模與距離估算' };
  }

  /* ---------- 天氣特報 ---------- */
  async function cwaWarnings(key, county) {
    const d = await getJSON(cwaUrl('W-C0033-001', key), 5 * 60e3);
    const locs = d.records?.location || [];
    const norm = s => String(s || '').replace('台', '臺');
    const all = locs.map(l => ({
      county: l.locationName,
      hazards: (l.hazardConditions?.hazards || []).map(h => `${h.info?.phenomena || ''}${h.info?.significance || ''}`).filter(Boolean)
    }));
    const mine = all.find(x => norm(x.county) === norm(county));
    return { mine: mine ? mine.hazards : [], all: all.filter(x => x.hazards.length) };
  }

  /* ---------- 颱風 ---------- */
  // 氣象署欄位大小寫曾經改版（tropicalCyclone / TropicalCyclone），一律轉小寫再讀取
  const lowerKeys = o => Array.isArray(o) ? o.map(lowerKeys)
    : (o && typeof o === 'object') ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), lowerKeys(v)])) : o;
  const arr = x => x == null ? [] : Array.isArray(x) ? x : [x];
  const fixCoord = f => {
    if (f.coordinatelatitude != null) return { lat: +f.coordinatelatitude, lon: +f.coordinatelongitude };
    if (!f.coordinate) return null;
    const [a, b] = String(f.coordinate).split(',').map(Number);
    if (!isFinite(a) || !isFinite(b)) return null;
    return a > 90 ? { lon: a, lat: b } : { lat: a, lon: b };
  };
  const r15 = f => val((f.circle15ms || f.circleof15ms)?.radius);
  const r25 = f => val((f.circle25ms || f.circleof25ms)?.radius);
  const DIR_EN = { N: '北', NNE: '北北東', NE: '東北', ENE: '東北東', E: '東', ESE: '東南東', SE: '東南', SSE: '南南東', S: '南', SSW: '南南西', SW: '西南', WSW: '西南西', W: '西', WNW: '西北西', NW: '西北', NNW: '北北西' };
  const tyClass = ms => ms == null ? '' : ms >= 51 ? '強烈颱風' : ms >= 32.7 ? '中度颱風' : ms >= 17.2 ? '輕度颱風' : '熱帶性低氣壓';
  async function cwaTyphoons(key, lat, lon) {
    const d = lowerKeys(await getJSON(cwaUrl('W-C0034-005', key), 10 * 60e3));
    const list = arr(d.records?.tropicalcyclones?.tropicalcyclone);
    return list.map(t => {
      const fixes = arr(t.analysisdata?.fix);
      const cur = fixes[fixes.length - 1] || {};
      const c = fixCoord(cur);
      const r7 = r15(cur), r10 = r25(cur);
      const dist = c ? KL.distKm(lat, lon, c.lat, c.lon) : null;
      let closest = null;
      for (const f of arr(t.forecastdata?.fix)) {
        const fc = fixCoord(f); if (!fc) continue;
        const dd = KL.distKm(lat, lon, fc.lat, fc.lon);
        const fr = r15(f) ?? r7;
        if (!closest || dd < closest.dist) closest = {
          dist: dd, tau: val(f.forecasthour ?? f.tau), wind: val(f.maxwindspeed), r7: fr,
          p70: val(f.radius70percentprobability ?? f.radiusof70percentprobability), willEnter: fr != null && dd <= fr
        };
      }
      const inside = dist != null && r7 != null && dist <= r7;
      const enterFut = !inside && closest && closest.willEnter;
      const pred = arr(cur.movingprediction).find(p => p.lang === 'zh-hant');
      const wind = val(cur.maxwindspeed);
      return {
        name: t.cwatyphoonname || t.typhoonname || '熱帶性低氣壓', en: t.typhoonname || '', no: t.cwatyno || t.cwatdno || '',
        time: String(cur.datetime || cur.fixtime || '').replace('T', ' ').slice(0, 16),
        lat: c?.lat, lon: c?.lon, wind, gust: val(cur.maxgustspeed), pressure: val(cur.pressure),
        speed: val(cur.movingspeed), moveDir: DIR_EN[cur.movingdirection] || cur.movingdirection, movePred: pred?.value || '',
        r7, r10, dist, inside, enterFut, closest, cls: tyClass(wind)
      };
    }).filter(t => t.lat != null);
  }

  /* ---------- 組合成一份快照 ---------- */
  async function snapshot(site, cfg, opt = {}) {
    const key = (cfg.settings.cwaApiKey || '').trim();
    const { lat, lon } = site;
    const snap = { site, fetchedAt: new Date(), src: {}, errors: [], hasKey: !!key };

    const om = await openMeteo(lat, lon);
    const H = om.hourly; const times = H.time.map(t => new Date(t + ':00+08:00'));
    const now = new Date();
    const hNow = new Date(now); hNow.setMinutes(0, 0, 0);
    let idx = times.findIndex(t => t.getTime() === hNow.getTime());
    if (idx < 0) idx = times.findIndex(t => t > now) - 1;
    const g = (k, i) => (H[k] && H[k][i] != null) ? H[k][i] : null;
    const sum = (k, a, b) => { let s = 0; for (let i = a; i <= b; i++) s += g(k, i) || 0; return s; };
    const max = (k, a, b) => { let m = null, at = null; for (let i = a; i <= b; i++) { const v = g(k, i); if (v != null && (m == null || v > m)) { m = v; at = i; } } return { m, at }; };

    snap.hourly = [];
    for (let i = idx - 12; i <= idx + 12; i++) {
      if (i < 0 || i >= times.length) continue;
      snap.hourly.push({
        time: times[i], rain: g('precipitation', i), rain3: sum('precipitation', i - 2, i), temp: g('temperature_2m', i),
        rh: g('relative_humidity_2m', i), wind: g('wind_speed_10m', i), gust: g('wind_gusts_10m', i), dir: g('wind_direction_10m', i),
        pressure: g('surface_pressure', i), pop: g('precipitation_probability', i), uv: g('uv_index', i), isNow: i === idx, isFut: i > idx
      });
    }
    const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
    let dayStart = times.findIndex(t => t > today0);
    const C = om.current || {};
    const g24 = max('wind_gusts_10m', idx - 23, idx), g12 = max('wind_gusts_10m', idx + 1, idx + 12);

    snap.rain = {
      now: g('precipitation', idx + 1) ?? C.precipitation, past3h: sum('precipitation', idx - 2, idx),
      day: dayStart >= 0 ? sum('precipitation', dayStart, idx) : null, rolling24: sum('precipitation', idx - 23, idx),
      fut12: sum('precipitation', idx + 1, idx + 12), fut2: sum('precipitation', idx + 1, idx + 2), model: true
    };
    snap.temp = {
      t: C.temperature_2m ?? g('temperature_2m', idx), rh: C.relative_humidity_2m ?? g('relative_humidity_2m', idx),
      feel: C.apparent_temperature ?? g('apparent_temperature', idx), dir: C.wind_direction_10m ?? g('wind_direction_10m', idx)
    };
    snap.wind = {
      avg: C.wind_speed_10m ?? g('wind_speed_10m', idx), dir: C.wind_direction_10m ?? g('wind_direction_10m', idx),
      gustNow: C.wind_gusts_10m ?? g('wind_gusts_10m', idx), gust24: g24.m, fut12: g12.m,
      fut12At: g12.at != null ? times[g12.at] : null, model: true
    };
    snap.pressure = C.surface_pressure ?? g('surface_pressure', idx);
    snap.uv = g('uv_index', idx);
    snap.src = { rain: '模式推估', temp: '模式推估', wind: '模式推估', quake: 'USGS' };
    snap.county = site.county || '';

    /* 氣象署實測覆蓋 */
    if (key) {
      const tasks = [
        cwaStations(key).then(list => {
          const near = nearest(list, lat, lon, s => s.temp != null);
          snap.stations = near.slice(0, 6);
          let st = near[0];
          if (opt.stationId) st = near.find(s => s.id === opt.stationId) || st;
          if (st && st.dist < 30) {
            snap.station = st;
            if (!snap.county) snap.county = st.county;
            snap.temp.t = st.temp; if (st.rh != null) snap.temp.rh = st.rh;
            if (st.wind != null) { snap.wind.avg = st.wind; snap.wind.model = false; }
            if (st.dir != null) { snap.wind.dir = st.dir; snap.temp.dir = st.dir; }
            if (st.gust != null) snap.wind.gustNow = st.gust;
            if (st.pressure != null) snap.pressure = st.pressure;
            if (st.uv != null) snap.uv = st.uv;
            const tm = st.obsTime ? new Date(st.obsTime) : null;
            snap.src.temp = snap.src.wind = `氣象站實測 ${st.name}${tm ? ' ' + KL.fmtTime(tm) : ''}`;
          }
          if (!snap.county && near[0]) snap.county = near[0].county;
        }),
        cwaRainStations(key).then(list => {
          const near = nearest(list, lat, lon, s => s.p1h != null || s.day != null);
          const rs = near[0];
          if (rs && rs.dist < 20) {
            snap.rainStation = rs;
            if (rs.p10m != null) snap.rain.now = rs.p10m * 6;
            if (rs.p3h != null) snap.rain.past3h = rs.p3h;
            if (rs.day != null) snap.rain.day = rs.day;
            if (rs.p24h != null) snap.rain.rolling24 = rs.p24h;
            snap.rain.model = false;
            const tm = rs.obsTime ? new Date(rs.obsTime) : null;
            snap.src.rain = `雨量站實測 ${rs.name}${tm ? ' ' + KL.fmtTime(tm) : ''}`;
          }
        })
      ];
      for (const r of await Promise.allSettled(tasks)) if (r.status === 'rejected') snap.errors.push('氣象署測站：' + r.reason.message);
    }

    /* 地震 */
    try {
      let qs = null;
      if (key) { try { qs = await cwaQuakes(key); snap.src.quake = '氣象署有感地震報告'; } catch (e) { snap.errors.push('氣象署地震：' + e.message); } }
      if (!qs) { qs = await usgsQuakes(lat, lon); snap.src.quake = 'USGS（震度為估算）'; }
      const recent = qs.filter(q => q.mag != null && q.lat != null).sort((a, b) => b.time - a.time);
      const q = recent[0];
      snap.quake = {
        last: q ? { ...q, dist: KL.distKm(lat, lon, q.lat, q.lon), int: siteIntensity(q, lat, lon, snap.county) } : null,
        count7: recent.filter(x => x.mag >= 4 && Date.now() - x.time < 7 * 864e5).length
      };
    } catch (e) { snap.quake = null; snap.errors.push('地震資料：' + e.message); }

    /* 特報與颱風 */
    if (key) {
      const [w, t] = await Promise.allSettled([cwaWarnings(key, snap.county), cwaTyphoons(key, lat, lon)]);
      if (w.status === 'fulfilled') snap.warnings = w.value; else snap.errors.push('天氣特報：' + w.reason.message);
      if (t.status === 'fulfilled') snap.typhoons = t.value; else snap.errors.push('颱風資料：' + t.reason.message);
    }

    /* 衍生值 */
    const T = snap.temp;
    T.dew = KL.dewPoint(T.t, T.rh);
    T.hi = KL.heatIndex(T.t, T.rh);
    T.wbgt = KL.wbgt(T.t, T.rh);
    return snap;
  }

  return { snapshot, geocode, openMeteoMulti };
})();
