/* 工地環境安全氣象日報表：列印 / 另存 PDF、另開視窗、下載 HTML */
'use strict';

const Report = (() => {
  const E = KL.esc, N = KL.num;

  function build(app) {
    const s = app.snap, site = app.site, cfg = app.cfg, th = cfg.settings.thresholds;
    const R = s.rain, T = s.temp, W = s.wind, q = s.quake?.last;
    const now = new Date();
    const bf = v => { const b = KL.beaufort(v); return b == null ? '' : `（${b} 級）`; };
    const ty = (s.typhoons || [])[0];
    const nowcast = (R.now ?? 0) >= 0.5 ? `目前降雨中（約 ${N(R.now)} mm/hr）；未來 2 小時預估累積 ${N(R.fut2)} mm` : `目前無明顯降雨；未來 2 小時預估累積 ${N(R.fut2)} mm`;

    const obs = [
      ['即時降雨強度', `${N(R.now)} mm/hr`],
      ['過去 3 小時雨量', `${N(R.past3h)} mm`],
      ['當日累積雨量（00:00 起算）', `${N(R.day)} mm（大雨 ${th.dayHeavy} / 豪雨 ${th.dayTorrential}）`],
      ['滾動 24 小時累積雨量', `${N(R.rolling24)} mm`],
      ['未來 12 小時預報雨量', `${N(R.fut12)} mm`],
      ['降雨快報', nowcast],
      ['平均風速 / 最大陣風', `${N(W.avg)} / ${N(W.gustNow)} m/s${bf(W.gustNow)}`],
      ['24 小時最大陣風', `${N(W.gust24)} m/s`],
      ['未來 12 小時最大陣風', `${N(W.fut12)} m/s${W.fut12At ? '（約 ' + KL.fmtTime(W.fut12At) + '）' : ''}`],
      ['風向', `${KL.dirName(W.dir)}（${N(W.dir, 0)}° 來向）`],
      ['氣溫 / 體感', `${N(T.t)} / ${N(T.feel)} °C`],
      ['相對濕度 / 露點', `${N(T.rh, 0)} % / ${N(T.dew)} °C`],
      ['熱指數 / 熱危害分級', `${N(T.hi)} °C / ${KL.heatLevel(T.hi).name}`],
      ['WBGT 綜合溫度熱指數（估算）', `${N(T.wbgt)} °C`],
      ['紫外線指數', `${N(s.uv, 0)}（${KL.uvLevel(s.uv).name}）`],
      ['最近地震', q ? `M${N(q.mag)}　${KL.fmtDateTime(q.time).slice(5)}　距 ${N(q.dist, 0)} km　本地震度 ${E(q.int.text)}（${E(q.int.src)}）` : '無資料'],
      ['氣象署特報', s.hasKey ? (s.warnings ? (s.warnings.mine.length ? `${s.county}：${s.warnings.mine.join('、')}` : '無') : '讀取失敗') : '未設定金鑰'],
      ['颱風', s.hasKey ? (ty ? `${ty.name}（${ty.cls}）距 ${N(ty.dist, 0)} km，七級風半徑 ${N(ty.r7, 0)} km` : '無') : '未設定金鑰']
    ];
    const lvColor = { r: '#d42f43', y: '#c98a00', g: '#1f9d3a', m: '#888' };
    const safety = app.safety.map(x => `<tr><td>${E(x.title)}</td><td style="color:${lvColor[x.cls]};font-weight:700;text-align:center">${E(x.status)}</td><td>${E(x.desc)}</td></tr>`).join('');
    const hourly = s.hourly.map(h => `<tr${h.isNow ? ' class="now"' : ''}><td>${KL.fmtMD(h.time)} ${KL.fmtTime(h.time)}${h.isNow ? ' ←現在' : h.isFut ? '（預報）' : ''}</td>
      <td>${N(h.rain)}</td><td>${N(h.rain3)}</td><td>${N(h.temp)}</td><td>${N(h.rh, 0)}</td><td>${N(h.wind)}</td><td>${N(h.gust)}</td><td>${KL.dirName(h.dir)}</td></tr>`).join('');
    const src = [s.src.rain, s.src.temp !== s.src.rain ? s.src.temp : '', s.src.quake].filter(Boolean).join('；');

    return `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>工地環境安全氣象日報表_${E(site.name)}_${now.getFullYear()}${KL.pad(now.getMonth() + 1)}${KL.pad(now.getDate())}</title>
<style>
body{font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#222;margin:24px;font-size:13px}
.hd{display:flex;align-items:center;gap:12px;border-bottom:3px solid #2a0069;padding-bottom:8px}
.hd img{height:46px}.hd h1{font-size:22px;margin:0}.hd .co{color:#ff4a00;font-weight:700}
.info{margin:8px 0 14px;color:#444;line-height:1.7}
h2{font-size:15px;border-left:5px solid #2a0069;padding-left:8px;margin:18px 0 6px}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:4px 7px}th{background:#eef0f4}
table.obs td:first-child{width:34%;text-align:center;background:#fafafa}table.obs td:last-child{text-align:right}
table.hr td{text-align:right}table.hr td:first-child{text-align:left}tr.now td{background:#dff3f7;font-weight:700}
.sign{display:flex;gap:24px;margin-top:40px}.sign div{flex:1;border-top:1px solid #333;text-align:center;padding-top:6px}
.note{margin-top:16px;font-size:11px;color:#555;line-height:1.6}
@media print{body{margin:10mm}h2{break-after:avoid}tr{break-inside:avoid}}
</style></head><body>
<div class="hd"><img src="${new URL('icons/logo.png', location.href).href}" alt="logo"><div><div class="co">${E(cfg.company)}</div><h1>工地環境安全氣象日報表</h1></div></div>
<div class="info">工地名稱：<b>${E(site.name)}</b>${site.code ? '　｜　工程編號：' + E(site.code) : ''}　｜　座標：${(+site.lat).toFixed(5)}, ${(+site.lon).toFixed(5)}${site.address ? '　｜　地址：' + E(site.address) : ''}<br>
填表時間：${KL.fmtDateTime(now)}　｜　資料時間：${KL.fmtDateTime(s.fetchedAt)}　｜　資料來源：${E(src)}</div>
<h2>一、即時氣象觀測值</h2>
<table class="obs"><tr><th>項目</th><th>數值</th></tr>${obs.map(([a, b]) => `<tr><td>${E(a)}</td><td>${E(b)}</td></tr>`).join('')}</table>
<h2>二、作業安全研判</h2>
<table><tr><th style="width:18%">作業項目</th><th style="width:16%">研判結果</th><th>說明與應辦事項</th></tr>${safety}</table>
<h2>三、逐時紀錄（過去 12 小時 ～ 未來 12 小時）</h2>
<table class="hr"><tr><th>時間</th><th>雨量 mm</th><th>3hr 累積 mm</th><th>氣溫 °C</th><th>濕度 %</th><th>風速 m/s</th><th>陣風 m/s</th><th>風向</th></tr>${hourly}</table>
<div class="sign"><div>現場工地主任${site.manager ? '（' + E(site.manager) + '）' : ''}</div><div>職業安全衛生人員</div><div>監造 / 業主</div></div>
<div class="note">備註：本報表門檻為一般參考值（陣風 ≥${th.gustStop} m/s 或平均風速 ≥${th.windAvgStop} m/s 停止吊掛；平均風速 ≥10 m/s 停止高處作業；時雨量 ≥${th.rainNowStop} mm 或未來 12 小時 ≥${th.rain12hStop} mm 停止混凝土澆置；
當日累積大雨 ${th.dayHeavy} mm / 豪雨 ${th.dayTorrential} mm；熱指數依勞動部熱危害分級；地震本地震度 ≥${th.quakeStopIntensity} 級應停工檢查）。
逐時資料為數值模式分析與預報。停工與復工仍依現場實測、契約規定與監造指示；經簽名後可作為停工與工期展延申請之佐證。</div>
</body></html>`;
  }

  function open(app, openModal) {
    const html = build(app);
    const blob = () => new Blob([html], { type: 'text/html;charset=utf-8' });
    const fname = `工地氣象日報表_${app.site.name}_${new Date().toISOString().slice(0, 10)}.html`.replace(/[\\/:*?"<>|]/g, '_');
    openModal('工地氣象日報表', '<iframe class="report" id="reportFrame"></iframe>',
      `<button class="btn btn-accent btn-mini" id="rpPrint">🖨 列印 / 另存 PDF</button>
       <button class="btn btn-mini" id="rpOpen">↗ 另開視窗</button>
       <button class="btn btn-mini" id="rpDown">⬇ 下載 HTML</button>`);
    const fr = document.getElementById('reportFrame');
    fr.srcdoc = html;
    document.getElementById('rpPrint').onclick = () => { fr.contentWindow.focus(); fr.contentWindow.print(); };
    document.getElementById('rpOpen').onclick = () => window.open(URL.createObjectURL(blob()), '_blank');
    document.getElementById('rpDown').onclick = () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob()); a.download = fname; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
  }
  return { open, build };
})();
