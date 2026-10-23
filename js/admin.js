/* 管理後台：登入、工地專案、系統設定、管理者帳號、發佈到 GitHub */
'use strict';

const A = { cfg: null, base: null, user: null, editId: null, map: null, marker: null, others: null };
const $ = KL.$;
const SS_USER = 'klwsdemo_admin_user';
const LS_TOKEN = 'klwsdemo_gh_token';
const TH_LABELS = {
  windAvgWarn: '平均風速 警戒 (m/s)', windAvgStop: '平均風速 停止 (m/s)', gustWarn: '陣風 警戒 (m/s)', gustStop: '陣風 停止吊掛 (m/s)',
  rainNowWarn: '時雨量 警戒 (mm/hr)', rainNowStop: '時雨量 停止澆置 (mm/hr)', rain12hWarn: '未來12h雨量 警戒 (mm)', rain12hStop: '未來12h雨量 停止 (mm)',
  dayHeavy: '日累積 大雨 (mm)', dayTorrential: '日累積 豪雨 (mm)', paintRhWarn: '塗裝濕度 警戒 (%)', paintRhStop: '塗裝濕度 停止 (%)',
  quakeStopIntensity: '地震停工檢查震度 (級)'
};

/* ---------- 草稿 ---------- */
function clean(c) { const o = JSON.parse(JSON.stringify(c)); delete o._draft; return o; }
function saveDraft() {
  A.cfg.updatedAt = new Date().toISOString();
  localStorage.setItem(KL.LS_DRAFT, JSON.stringify(clean(A.cfg)));
  markDirty();
}
function markDirty() {
  const dirty = JSON.stringify(stripTime(clean(A.cfg))) !== JSON.stringify(stripTime(clean(A.base)));
  $('#dirtyFlag').hidden = !dirty;
  if (!dirty) localStorage.removeItem(KL.LS_DRAFT);
}
const stripTime = c => { const o = { ...c }; delete o.updatedAt; return o; };

/* ---------- 登入 ---------- */
async function checkPw(adm, pw) { return adm && (await KL.sha256(adm.salt + pw)) === adm.hash; }
async function setPw(adm, pw) { adm.salt = KL.randHex(8); adm.hash = await KL.sha256(adm.salt + pw); }

async function login() {
  const u = $('#lgUser').value.trim(), p = $('#lgPass').value;
  const adm = A.cfg.admins.find(a => a.user === u);
  if (!(await checkPw(adm, p))) { KL.toast('帳號或密碼錯誤'); return; }
  sessionStorage.setItem(SS_USER, u);
  enter(adm);
}
function enter(adm) {
  A.user = adm.user;
  A.demo = !!adm.demo;  // 展示版試用帳號：可操作，但變更只留在瀏覽器、不能發佈
  $('#loginBox').hidden = true; $('#adminMain').hidden = false; $('#btnLogout').hidden = false;
  $('#whoami').textContent = `登入：${adm.name || adm.user}`;
  if (A.demo) {
    $('#demoAdminBar').hidden = false;
    $('#btnPublish').disabled = true;
    $('#btnPublish').title = '展示版試用帳號無法發佈';
  }
  renderAll();
  if (adm.mustChange) $('#pwModal').hidden = false;
}

/* ---------- 工地 ---------- */
function renderSites() {
  const L = A.cfg.sites;
  $('#siteList').innerHTML = L.length ? L.map((s, i) => `
    <div class="site-row${s.enabled === false ? ' off' : ''}">
      <div class="nm">${KL.esc(s.name)}${s.enabled === false ? '（停用）' : ''}<small>${KL.esc([s.county, s.address, s.code && '編號 ' + s.code, s.manager && '主任 ' + s.manager].filter(Boolean).join('　'))}　📍 ${(+s.lat).toFixed(5)}, ${(+s.lon).toFixed(5)}</small></div>
      <div class="ops">
        <button class="btn btn-mini" data-op="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="btn btn-mini" data-op="down" data-i="${i}" ${i === L.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="btn btn-mini" data-op="toggle" data-i="${i}">${s.enabled === false ? '啟用' : '停用'}</button>
        <button class="btn btn-mini" data-op="edit" data-i="${i}">✎ 編輯</button>
        <a class="btn btn-mini" href="index.html?site=${encodeURIComponent(s.id)}" target="_blank">看監控</a>
        <button class="btn btn-mini btn-danger" data-op="del" data-i="${i}">刪除</button>
      </div>
    </div>`).join('') : '<p class="muted">尚無工地，請按「＋ 新增工地」。</p>';
}
function openEditor(site) {
  A.editId = site ? site.id : null;
  $('#siteEditor').hidden = false;
  $('#edTitle').textContent = site ? `編輯工地：${site.name}` : '新增工地';
  const s = site || { county: '', lat: '', lon: '', enabled: true };
  $('#fName').value = s.name || ''; $('#fCode').value = s.code || ''; $('#fCounty').value = s.county || '';
  $('#fAddr').value = s.address || ''; $('#fLat').value = s.lat ?? ''; $('#fLon').value = s.lon ?? '';
  $('#fMgr').value = s.manager || ''; $('#fPhone').value = s.phone || ''; $('#fStart').value = s.startDate || '';
  $('#fEnd').value = s.endDate || ''; $('#fNote').value = s.note || ''; $('#fEnabled').checked = s.enabled !== false;
  $('#fGeoQ').value = s.address || '';
  initMap();
  const lat = parseFloat(s.lat), lon = parseFloat(s.lon);
  if (KL.validLatLon(lat, lon)) setPoint(lat, lon, 15); else { A.marker && A.marker.remove(); A.marker = null; A.map.setView([23.7, 120.9], 7); }
  drawOthers();
  $('#siteEditor').scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => A.map.invalidateSize(), 200);
}
function initMap() {
  if (A.map || !window.L) return;
  A.map = L.map('map').setView([23.7, 120.9], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(A.map);
  A.map.on('click', e => setPoint(e.latlng.lat, e.latlng.lng));
}
function drawOthers() {
  if (!A.map) return;
  if (A.others) A.others.remove();
  A.others = L.layerGroup(A.cfg.sites.filter(s => s.id !== A.editId).map(s =>
    L.circleMarker([s.lat, s.lon], { radius: 6, color: '#3fc1d9' }).bindTooltip(s.name))).addTo(A.map);
}
function setPoint(lat, lon, zoom) {
  lat = +(+lat).toFixed(6); lon = +(+lon).toFixed(6);
  $('#fLat').value = lat; $('#fLon').value = lon;
  if (!A.map) return;
  if (!A.marker) {
    A.marker = L.marker([lat, lon], { draggable: true }).addTo(A.map);
    A.marker.on('dragend', () => { const p = A.marker.getLatLng(); setPoint(p.lat, p.lng); });
  } else A.marker.setLatLng([lat, lon]);
  if (zoom) A.map.setView([lat, lon], zoom);
}
function saveSite() {
  const lat = parseFloat($('#fLat').value), lon = parseFloat($('#fLon').value);
  const name = $('#fName').value.trim(), county = $('#fCounty').value;
  if (!name) return KL.toast('請輸入工地名稱');
  if (!county) return KL.toast('請選擇所在縣市');
  if (!KL.validLatLon(lat, lon)) return KL.toast('GPS 座標不正確（需位於臺灣地區）');
  const data = {
    name, code: $('#fCode').value.trim(), county, address: $('#fAddr').value.trim(), lat, lon,
    manager: $('#fMgr').value.trim(), phone: $('#fPhone').value.trim(), startDate: $('#fStart').value, endDate: $('#fEnd').value,
    note: $('#fNote').value.trim(), enabled: $('#fEnabled').checked
  };
  if (A.editId) Object.assign(A.cfg.sites.find(s => s.id === A.editId), data);
  else A.cfg.sites.push({ id: 'site-' + Date.now().toString(36), ...data });
  saveDraft(); renderSites();
  $('#siteEditor').hidden = true;
  KL.toast('已儲存為本機草稿，記得到「發佈 / 備份」發佈');
}
function siteOp(op, i) {
  const L = A.cfg.sites, s = L[i];
  if (op === 'edit') return openEditor(s);
  if (op === 'up' && i > 0) [L[i - 1], L[i]] = [L[i], L[i - 1]];
  if (op === 'down' && i < L.length - 1) [L[i + 1], L[i]] = [L[i], L[i + 1]];
  if (op === 'toggle') s.enabled = s.enabled === false;
  if (op === 'del') { if (!confirm(`確定刪除工地「${s.name}」？`)) return; L.splice(i, 1); }
  saveDraft(); renderSites();
}

/* ---------- 系統設定 ---------- */
function renderSettings() {
  const st = A.cfg.settings;
  $('#sCompany').value = A.cfg.company || ''; $('#sRefresh').value = st.refreshMinutes; $('#sCwaKey').value = st.cwaApiKey || '';
  if (A.demo) { $('#sCwaKey').value = ''; $('#sCwaKey').placeholder = '展示版不顯示金鑰'; $('#sCwaKey').disabled = $('#btnTestKey').disabled = true; }
  $('#thGrid').innerHTML = Object.keys(TH_LABELS).map(k =>
    `<label class="fld"><span>${TH_LABELS[k]}</span><input type="number" step="0.1" data-th="${k}" value="${st.thresholds[k]}"></label>`).join('');
}
function saveSettings() {
  const st = A.cfg.settings;
  A.cfg.company = $('#sCompany').value.trim() || '示範營造股份有限公司';
  st.refreshMinutes = Math.min(60, Math.max(2, parseInt($('#sRefresh').value) || 5));
  if (!A.demo) st.cwaApiKey = $('#sCwaKey').value.trim();
  document.querySelectorAll('[data-th]').forEach(i => { const v = parseFloat(i.value); if (isFinite(v)) st.thresholds[i.dataset.th] = v; });
  saveDraft(); renderSettings(); KL.toast('設定已儲存為本機草稿');
}
async function testKey() {
  const k = $('#sCwaKey').value.trim();
  if (!k) return KL.toast('請先輸入金鑰');
  try {
    const r = await fetch(`https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?Authorization=${encodeURIComponent(k)}&limit=1&format=JSON`);
    const d = await r.json();
    KL.toast(d.success === 'true' || d.success === true ? '✅ 金鑰可用' : '❌ 金鑰無效：' + (d.message || r.status), 5000);
  } catch (e) { KL.toast('❌ 測試失敗：' + e.message, 5000); }
}

/* ---------- 管理者 ---------- */
function renderAdmins() {
  $('#adminTable').innerHTML = '<tr><th>帳號</th><th>姓名</th><th>狀態</th><th style="text-align:right">操作</th></tr>' +
    A.cfg.admins.map((a, i) => `<tr><td>${KL.esc(a.user)}${a.user === A.user ? '（我）' : ''}</td><td style="text-align:left">${KL.esc(a.name || '')}</td>
      <td style="text-align:left">${a.mustChange ? '待變更密碼' : '正常'}</td>
      <td>${a.user === A.user ? '' : `<button class="btn btn-mini" data-aop="reset" data-i="${i}">重設密碼</button> <button class="btn btn-mini btn-danger" data-aop="del" data-i="${i}">刪除</button>`}</td></tr>`).join('');
}
async function addAdmin() {
  const u = $('#nUser').value.trim(), n = $('#nName').value.trim(), p = $('#nPass').value;
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(u)) return KL.toast('帳號需為 3–20 碼英數字');
  if (A.cfg.admins.some(a => a.user === u)) return KL.toast('帳號已存在');
  if (p.length < 8) return KL.toast('密碼至少 8 碼');
  const adm = { user: u, name: n, mustChange: true }; await setPw(adm, p);
  A.cfg.admins.push(adm); saveDraft(); renderAdmins();
  $('#nUser').value = $('#nName').value = $('#nPass').value = '';
  KL.toast('已新增管理者（需發佈後其他裝置才能登入）');
}
async function adminOp(op, i) {
  const a = A.cfg.admins[i];
  if (op === 'del') {
    if (A.cfg.admins.length <= 1) return KL.toast('至少需保留一位管理者');
    if (!confirm(`確定刪除管理者「${a.user}」？`)) return;
    A.cfg.admins.splice(i, 1);
  }
  if (op === 'reset') {
    const p = prompt(`輸入「${a.user}」的新密碼（至少 8 碼），對方下次登入需再變更：`);
    if (!p) return; if (p.length < 8) return KL.toast('密碼至少 8 碼');
    await setPw(a, p); a.mustChange = true;
  }
  saveDraft(); renderAdmins();
}
async function changeMyPw(oldPw, p1, p2, skipOld) {
  const me = A.cfg.admins.find(a => a.user === A.user);
  if (!skipOld && !(await checkPw(me, oldPw))) return KL.toast('目前密碼錯誤'), false;
  if (p1.length < 8) return KL.toast('新密碼至少 8 碼'), false;
  if (p1 !== p2) return KL.toast('兩次輸入的新密碼不一致'), false;
  await setPw(me, p1); me.mustChange = false;
  saveDraft(); renderAdmins(); KL.toast('密碼已變更（請發佈讓其他裝置生效）', 4000);
  return true;
}

/* ---------- GitHub 發佈 ---------- */
function detectRepo() {
  const g = A.cfg.settings.github;
  let owner = g.owner, repo = g.repo;
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (m) {
    owner = owner || m[1];
    const seg = location.pathname.split('/').filter(Boolean)[0];
    repo = repo || (seg && !/\.html$/.test(seg) ? seg : `${m[1]}.github.io`);
  }
  return { owner, repo, branch: g.branch || 'main', path: g.path || 'data/config.json' };
}
function renderPublish() {
  const r = detectRepo();
  $('#gOwner').value = A.cfg.settings.github.owner || ''; $('#gOwner').placeholder = r.owner || '例：kainan-co';
  $('#gRepo').value = A.cfg.settings.github.repo || ''; $('#gRepo').placeholder = r.repo || '例：site-monitor';
  $('#gBranch').value = A.cfg.settings.github.branch || 'main';
  const t = localStorage.getItem(LS_TOKEN) || sessionStorage.getItem(LS_TOKEN) || '';
  $('#gToken').value = t; $('#gRemember').checked = !!localStorage.getItem(LS_TOKEN);
}
function b64utf8(str) {
  const bytes = new TextEncoder().encode(str); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function publish() {
  if (A.demo) return KL.toast('展示版試用帳號無法發佈；您的變更只保存在這台裝置的瀏覽器中');
  const g = A.cfg.settings.github;
  g.owner = $('#gOwner').value.trim(); g.repo = $('#gRepo').value.trim(); g.branch = $('#gBranch').value.trim() || 'main';
  const { owner, repo, branch, path } = detectRepo();
  const token = $('#gToken').value.trim();
  if (!owner || !repo) return KL.toast('請填寫 GitHub 帳號與儲存庫名稱');
  if (!token) return KL.toast('請輸入 GitHub 存取權杖');
  if ($('#gRemember').checked) localStorage.setItem(LS_TOKEN, token); else { localStorage.removeItem(LS_TOKEN); sessionStorage.setItem(LS_TOKEN, token); }
  const log = m => ($('#pubLog').textContent = m);
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const H = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  try {
    log('連線 GitHub…');
    let sha;
    const cur = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers: H, cache: 'no-store' });
    if (cur.ok) {
      const j = await cur.json(); sha = j.sha;
      try {
        const remote = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\n/g, '')), c => c.charCodeAt(0))));
        if (remote.updatedAt && A.base.updatedAt && remote.updatedAt !== A.base.updatedAt &&
          !confirm('GitHub 上的設定在您開啟後台後已被其他人更新過，確定要以您的版本覆蓋？')) return log('已取消發佈');
      } catch (e) { /* 無法比對則直接發佈 */ }
    } else if (cur.status !== 404) throw new Error(`讀取失敗 HTTP ${cur.status}（請確認權杖權限與儲存庫名稱）`);
    A.cfg.updatedAt = new Date().toISOString();
    const body = JSON.stringify(clean(A.cfg), null, 2) + '\n';
    const r = await fetch(api, {
      method: 'PUT', headers: H,
      body: JSON.stringify({ message: `更新工地監控設定（${A.user}）`, content: b64utf8(body), sha, branch })
    });
    if (!r.ok) throw new Error(`發佈失敗 HTTP ${r.status}：${(await r.json().catch(() => ({}))).message || ''}`);
    A.base = JSON.parse(JSON.stringify(A.cfg));
    localStorage.removeItem(KL.LS_DRAFT); localStorage.removeItem(KL.LS_PREVIEW);
    markDirty();
    log(`✅ 已於 ${KL.fmtDateTime(new Date())} 發佈到 ${owner}/${repo}（${branch}）。約 1～2 分鐘後網站更新。`);
  } catch (e) { log('❌ ' + e.message); }
}

/* ---------- 備份 ---------- */
function exportJson() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(clean(A.cfg), null, 2) + '\n'], { type: 'application/json' }));
  a.download = 'config.json'; a.click();
}
function importJson(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const c = JSON.parse(rd.result);
      if (!Array.isArray(c.sites) || !Array.isArray(c.admins) || !c.admins.length) throw new Error('格式不正確');
      if (!confirm(`將以匯入的檔案取代目前設定（${c.sites.length} 個工地、${c.admins.length} 位管理者），確定？`)) return;
      A.cfg = KL.normalizeConfig(c); saveDraft(); renderAll(); KL.toast('已匯入為本機草稿');
    } catch (e) { KL.toast('匯入失敗：' + e.message); }
  };
  rd.readAsText(file);
}

/* ---------- 共用 ---------- */
function renderAll() {
  $('#companyName').textContent = A.cfg.company;
  renderSites(); renderSettings(); renderAdmins(); renderPublish(); markDirty();
}
function bind() {
  $('#btnLogin').onclick = login;
  $('#lgPass').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  $('#btnLogout').onclick = () => { sessionStorage.removeItem(SS_USER); location.reload(); };
  document.querySelector('.admin-tabs').addEventListener('click', e => {
    const b = e.target.closest('.tab'); if (!b) return;
    document.querySelectorAll('.admin-tabs .tab').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tabpane').forEach(p => (p.hidden = p.id !== 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'sites' && A.map) setTimeout(() => A.map.invalidateSize(), 100);
  });
  $('#fCounty').innerHTML = '<option value="">請選擇</option>' + KL.COUNTIES.map(c => `<option>${c}</option>`).join('');
  $('#btnNewSite').onclick = () => openEditor(null);
  $('#btnCancelSite').onclick = () => ($('#siteEditor').hidden = true);
  $('#btnSaveSite').onclick = saveSite;
  $('#siteList').addEventListener('click', e => { const b = e.target.closest('[data-op]'); if (b) siteOp(b.dataset.op, +b.dataset.i); });
  ['#fLat', '#fLon'].forEach(id => $(id).addEventListener('change', () => {
    const lat = parseFloat($('#fLat').value), lon = parseFloat($('#fLon').value);
    if (KL.validLatLon(lat, lon)) setPoint(lat, lon, 15);
  }));
  $('#btnGeoFind').onclick = async () => {
    const q = $('#fGeoQ').value.trim() || $('#fAddr').value.trim();
    if (!q) return KL.toast('請輸入地址或地名');
    try {
      const g = await DataSrc.geocode(q); setPoint(g.lat, g.lon, 15);
      const c = KL.COUNTIES.find(x => (g.name || '').replace('台', '臺').includes(x));
      if (c && !$('#fCounty').value) $('#fCounty').value = c;
      KL.toast(`找到：${g.name}，請在地圖上確認位置`);
    } catch (e) { KL.toast(e.message); }
  };
  $('#btnGeoHere').onclick = () => navigator.geolocation?.getCurrentPosition(
    p => setPoint(p.coords.latitude, p.coords.longitude, 16), err => KL.toast('無法定位：' + err.message), { enableHighAccuracy: true });
  $('#btnSaveSettings').onclick = saveSettings;
  $('#btnResetTh').onclick = () => { A.cfg.settings.thresholds = { ...KL.DEFAULT_THRESHOLDS }; renderSettings(); KL.toast('已帶入預設值，按「儲存設定」生效'); };
  $('#btnTestKey').onclick = testKey;
  $('#btnAddAdmin').onclick = addAdmin;
  $('#adminTable').addEventListener('click', e => { const b = e.target.closest('[data-aop]'); if (b) adminOp(b.dataset.aop, +b.dataset.i); });
  $('#btnChangePw').onclick = async () => {
    if (await changeMyPw($('#cOld').value, $('#cNew').value, $('#cNew2').value)) $('#cOld').value = $('#cNew').value = $('#cNew2').value = '';
  };
  $('#btnMustChange').onclick = async () => {
    if (await changeMyPw('', $('#mNew').value, $('#mNew2').value, true)) $('#pwModal').hidden = true;
  };
  $('#btnPublish').onclick = publish;
  $('#btnPreview').onclick = () => { saveDraft(); localStorage.setItem(KL.LS_PREVIEW, '1'); window.open('index.html', '_blank'); };
  $('#btnDiscard').onclick = () => {
    if (!confirm('確定捨棄所有尚未發佈的變更？')) return;
    localStorage.removeItem(KL.LS_DRAFT); localStorage.removeItem(KL.LS_PREVIEW); location.reload();
  };
  $('#btnExport').onclick = exportJson;
  $('#fileImport').onchange = e => e.target.files[0] && importJson(e.target.files[0]);
  window.addEventListener('beforeunload', e => { if (!$('#dirtyFlag').hidden) { e.preventDefault(); e.returnValue = ''; } });
}

(async function init() {
  bind();
  try {
    A.base = await KL.loadConfig(false);
  } catch (e) { KL.toast(e.message, 8000); return; }
  A.cfg = JSON.parse(JSON.stringify(A.base));
  try {
    const d = JSON.parse(localStorage.getItem(KL.LS_DRAFT) || 'null');
    if (d && d.sites) { A.cfg = KL.normalizeConfig(d); KL.toast('已載入此裝置上尚未發佈的草稿', 4000); }
  } catch (e) { /* 草稿損毀則忽略 */ }
  if (!window.isSecureContext || !crypto.subtle) KL.toast('請使用 https 或 localhost 開啟管理後台', 8000);
  const demo = A.base.settings.demo;
  if (demo && demo.enabled) {
    $('#demoHint').hidden = false;
    $('#demoHint').innerHTML = `展示版試用帳號：<b>${KL.esc(demo.user)}</b>　密碼：<b>${KL.esc(demo.password)}</b><br>可自由新增工地、調整門檻，變更只保存在您的瀏覽器，不會影響展示網站。`;
    $('#lgUser').value = demo.user; $('#lgPass').value = demo.password;
  }
  const u = sessionStorage.getItem(SS_USER);
  const adm = u && A.cfg.admins.find(a => a.user === u);
  if (adm) enter(adm);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
