// OddsAnalyzer Companion — Türkçe Maç ve Oran Paneli

// ------------------------------------------------------------------ Helpers
function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const fmt = (v) => (v === null || v === undefined || v === "" ? "—" : v);
const fmtNum = (n) => (typeof n === "number" ? n.toLocaleString("tr-TR") : fmt(n));
const scorePairHTML = (half, full) => `<span class="score-pair">İY: ${escapeHTML(half || "—")}<br>MS: ${escapeHTML(full || "—")}</span>`;
const oddsTimingText = row => {
  const usedAt = row.odds_quote_state === 'final'
    ? (row.final_odds_checked_at || row.verified_at || row.captured_at)
    : row.captured_at;
  const kickoff = Date.parse(row.kickoff_at_utc || '');
  const captured = Date.parse(usedAt || '');
  if (!Number.isFinite(kickoff) || !Number.isFinite(captured) || captured >= kickoff) return '';
  const minutes = Math.max(0, Math.round((kickoff-captured)/60000));
  return `Maçın başlamasına ${minutes} dk kala son oran çekildi.`;
};

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let errorDetail = "";
    try {
      const errJson = await res.json();
      errorDetail = errJson.error || errJson.detail || "";
    } catch (_) {}
    throw new Error(errorDetail ? `${res.status} — ${errorDetail}` : `İstek başarısız (${res.status}): ${url}`);
  }
  return res.json();
}

// ------------------------------------------------------------------ Navigation
const tabs = ["tab-weekly", "tab-matches", "tab-analysis", "tab-research", "tab-backfill", "tab-health", "tab-live", "tab-kickoff", "tab-flashscore", "tab-htft-pairs"];
let currentTab = "tab-analysis";
let backfillInterval = null;
let liveInterval = null;
let liveLoading = false;
let liveData = null;

function liveTime(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('tr-TR', {timeZone:'Europe/Istanbul'}) : 'Bilinmiyor';
}
function liveOfficialPredictions(row) {
  return (row.prediction_groups?.official || row.predictions || []).filter(p =>
    !p.void && p.source && !/^(preview-|alternatives)/.test(p.source));
}
function livePerformance(rows, sourceFilter=null) {
  const s = {won:0,lost:0,pending:0,wonMatches:0,lostMatches:0,mixedMatches:0,pendingMatches:0,net:0,unpriced:0};
  for (const row of rows) {
    const picks = liveOfficialPredictions(row).filter(p => !sourceFilter || sourceFilter(p.source));
    if (!picks.length) continue;
    let won=0, lost=0, pending=0;
    for (const p of picks) {
      if (p.outcome === 'Tuttu') won++;
      else if (p.outcome === 'Tutmadı') lost++;
      else { pending++; continue; }
      const price=Number(p.price);
      if (!Number.isFinite(price) || price <= 1) { s.unpriced++; continue; }
      s.net += p.outcome === 'Tuttu' ? 1000*(price-1) : -1000;
    }
    s.won+=won; s.lost+=lost; s.pending+=pending;
    if (pending) s.pendingMatches++;
    else if (won && lost) s.mixedMatches++;
    else if (won) s.wonMatches++;
    else if (lost) s.lostMatches++;
  }
  s.rate=s.won+s.lost ? 100*s.won/(s.won+s.lost) : null;
  s.net=Math.round(s.net*100)/100;
  return s;
}
function liveMethodPerformance(rows) {
  const methods=[['main-v3-1li','Resmî tekli'],['main-v3-2li','Resmî ikili'],['main-v3-3li','Resmî üçlü']];
  const result=methods.map(([source,label])=>({label,...livePerformance(rows,s=>s===source)}));
  const other=livePerformance(rows,s=>!methods.some(([source])=>source===s));
  if (other.won+other.lost+other.pending) result.push({label:'Diğer / eski resmî',...other});
  return result;
}
function liveMethodTable(rows) {
  const money=n=>(n>0?'+':'')+n.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+' TL';
  return '<h3>Yöntem bazında sonuçlar</h3><p>Seçili tarih ve liste filtreleri geçerlidir. İkili/üçlü birer analiz yöntemidir; kupon değildir. Her tahmin kaydı ayrı 1.000 TL bahis sayılır. Bekleyen ve kaldırılan kayıtlar başarıya ve net sonuca dahil edilmez.</p><div class="table-responsive"><table class="data-table"><thead><tr><th scope="col">Yöntem</th><th scope="col">Tutan oran</th><th scope="col">Tutmayan oran</th><th scope="col">Bekleyen</th><th scope="col">Tutma oranı</th><th scope="col">Net kâr/zarar</th></tr></thead><tbody>'+liveMethodPerformance(rows).map(s=>'<tr><th scope="row">'+s.label+'</th><td>'+s.won+'</td><td>'+s.lost+'</td><td>'+s.pending+'</td><td>'+(s.rate===null?'—':'%'+s.rate.toLocaleString('tr-TR',{maximumFractionDigits:1}))+'</td><td>'+money(s.net)+(s.unpriced?'<br><small>'+s.unpriced+' sonuçta oran eksik; net hesaba dahil değil</small>':'')+'</td></tr>').join('')+'</tbody></table></div><p>Bu tablo tek başına en iyi yöntemi kanıtlamaz. Yeni maç sonuçları ayrıca Oran Analizi → Yeni Kapsam · 100 Maç Takibi bölümünde izlenir.</p>';
}
function renderLiveMatches() {
  if (!liveData) return;
  const query = document.getElementById('live-search').value.toLocaleLowerCase('tr-TR');
  const finished = document.getElementById('live-finished').checked;
  const status = document.getElementById('live-status').value;
  const rows = liveData.rows.filter(r => {
    const hasPrediction = liveOfficialPredictions(r).length > 0;
    // A concrete match-state filter is about the fixture, not whether the
    // stricter prediction engine happened to approve a pick for it. Otherwise
    // selecting "Canlı" can hide every live match when no official pick exists.
    const matchesStatus = status === 'no-prediction' ? !hasPrediction :
      status === 'live' ? r.status === 'live' :
      status ? r.bucket === status : true;
    return matchesStatus && `${r.match_name} ${r.competition_name}`.toLocaleLowerCase('tr-TR').includes(query);
  });
  const sourceLabel = {'main':'Eski ana yöntem', 'alternatives':'Eski alternatif', 'main-v3-1li':'V3 tekli', 'main-v3-2li':'V3 ikili', 'main-v3-3li':'V3 üçlü', 'alternatives-v3':'V3 alternatif'};
  const render = (r, index) => `<tr>
    <td class="live-row-number">${index + 1}</td>
    <td><strong>${escapeHTML(r.match_name)}</strong><br><small>${escapeHTML(r.competition_name || 'Lig bilinmiyor')}</small></td>
    <td>${escapeHTML(liveTime(r.kickoff_at_utc))}</td>
    <td>${escapeHTML(r.phase)}<br><small>${r.bucket === 'delayed' ? 'Güncelliği doğrulanamıyor' : r.minute ? escapeHTML(r.minute) : r.status === 'finished' ? 'Tamamlandı' : 'Dakika bilgisi yok'}</small></td>
    <td><strong>${r.status === 'scheduled' ? '—' : escapeHTML(r.score)}</strong><br><small>İY: ${escapeHTML(r.half_score || '—')}</small>${r.stale ? '<br><small>Gecikmiş / doğrulanamayan veri</small>' : ''}</td>
    <td>${escapeHTML(liveTime(r.collected_at))}<br><small>${r.age_seconds == null ? 'Kontrol zamanı yok' : Math.floor(r.age_seconds/60) + ' dakika önce kontrol edildi'}</small>${r.source_updated_at ? '<br><small>Kaynak zamanı: '+escapeHTML(liveTime(r.source_updated_at))+'</small>' : ''}</td>
    <td>${renderPredictionGroups(r)}</td>
    <td><button type="button" disabled title="Ayrıntılı sorgu PC panelinde kullanılabilir" class="btn btn-action btn-sm live-odds" data-id="${escapeHTML(r.match_id)}">Detay PC panelinde</button></td>
  </tr>`;
  const active = rows.filter(r => r.bucket !== 'delayed' && (finished || r.bucket !== 'finished'));
  const delayed = rows.filter(r => r.bucket === 'delayed');
  document.getElementById('live-body').innerHTML = active.length ? active.map(render).join('') : '<tr><td colspan="8">Seçili tarih ve filtrelere uygun maç yok.</td></tr>';
  document.getElementById('live-delayed-body').innerHTML = delayed.map((r,i) => render(r, active.length+i)).join('');
  document.getElementById('live-delayed-title').textContent = `Güncelliği doğrulanamayan kayıtlar (${delayed.length})`;
  const c = liveData.counts;
  const visibleCount = active.length + delayed.length;
  document.getElementById('live-summary').textContent = `${liveData.date} · Toplam ${liveData.rows.length} maç · Canlı: ${c.live || 0} · Başlamayan: ${c.scheduled || 0} · Biten: ${c.finished || 0} · Diğer: ${c.other || 0} · Duraklatılmış: ${c.paused || 0} · Doğrulanamayan: ${c.delayed || 0} | Son kontrol: ${liveTime(liveData.generated_at)}`;
  document.querySelectorAll('#tab-live .live-odds').forEach(b => b.addEventListener('click', () => openOddsModal(b.dataset.id)));
  document.getElementById('live-summary').textContent = `Listelenen: ${visibleCount} maç (ana liste ${active.length}, doğrulanamayan ${delayed.length}) · ` + document.getElementById('live-summary').textContent;
  const s=livePerformance([...active,...delayed]);
  let methods=document.getElementById('live-method-performance');
  if (!methods) {
    methods=document.createElement('section'); methods.id='live-method-performance';
  }
  let stats=document.getElementById('live-performance');
  if (!stats) {
    stats=document.createElement('div'); stats.id='live-performance';
    stats.className='alert-box';
    document.getElementById('live-summary').after(stats);
  }
  stats.after(methods);
  methods.innerHTML=liveMethodTable([...active,...delayed]);
  stats.textContent=`Listelenen maçların resmî tahminleri | Tutan oran: ${s.won} · Tutmayan oran: ${s.lost} · Sonuç bekleyen: ${s.pending} · Tutma oranı: ${s.rate === null ? '—' : '%'+s.rate.toLocaleString('tr-TR',{maximumFractionDigits:1})} · Her tahmine 1.000 TL ile net kâr/zarar: ${s.net>0?'+':''}${s.net.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})} TL${s.unpriced ? ' · Oranı eksik '+s.unpriced+' sonuç kâr/zarara dahil değil' : ''}. Ön izleme ve alternatif arşivleri dahil değildir.`;
}
function renderPredictionGroups(row) {
  const a=row.live_analysis;
  const candidate=a?.candidate;
  const assessmentHTML=a ? `<div class="live-analysis"><strong>${escapeHTML(a.label)}</strong>${candidate ? `<p>${escapeHTML(candidate.market)} · ${escapeHTML(candidate.selection)} · ${escapeHTML(candidate.price)}<br><small>Örnek: ${escapeHTML(candidate.sample)} · Geçmiş gerçekleşme: ${escapeHTML(candidate.hit_pct)}%</small></p>` : ''}<small>${escapeHTML(a.scope || '')}</small>${(a.reasons || []).map(reason=>`<p class="muted">${escapeHTML(reason)}</p>`).join('')}${a.progress ? `<p>Güncel skor değerlendirmesi: ${escapeHTML(a.progress.outcome)}</p>` : ''}${a.evaluated_at ? `<small>Hesap: ${escapeHTML(liveTime(a.evaluated_at))}</small>` : ''}</div>` : '';
  if (!row.predictions.length) return assessmentHTML || 'Sistem onaylamadı · Maç öncesinde kaydedilmiş tahmin yok';
  const groups=row.prediction_groups || {official:row.predictions,preview:[],alternatives:[]};
  const state=row.prediction_consistency?.state;
  const warning=state==='conflict' ? '<p class="alert-box alert-warn"><strong>Geçmiş tahminler çelişiyor.</strong> Hepsi aynı skorla tutamaz; birlikte öneri değildir. Eski kayıtlar ve sonuçları korunmuştur.</p>' : state==='unverified' ? '<p class="alert-box alert-warn">Ortak skor uyumu doğrulanamadı; birlikte önerilmez.</p>' : '';
  const labels={'main':'Eski ana yöntem','main-v3-1li':'Resmî tekli','main-v3-2li':'Resmî ikili','main-v3-3li':'Resmî üçlü',
    'preview-v3-1li':'Ön izleme tekli','preview-v3-2li':'Ön izleme ikili','preview-v3-3li':'Ön izleme üçlü'};
  const render=p=>`<p><strong>${escapeHTML(p.market)} · ${escapeHTML(p.selection)} · ${escapeHTML(p.price)}</strong><br>${escapeHTML(labels[p.source] || p.source)} · ${escapeHTML(p.outcome)}<br><small>Kayıt: ${escapeHTML(liveTime(p.created_at))}</small></p>`;
  return assessmentHTML+warning+`<strong>Mackolik · Resmî kayıtlar</strong>${groups.official.length ? groups.official.map(render).join('') : '<p>Resmî kayıt yok.</p>'}`+
    (groups.preview.length ? `<details class="prediction-preview"><summary>Ön izleme arşivi (${groups.preview.length}) · Resmî öneri değil</summary>${groups.preview.map(render).join('')}</details>` : '')+
    (groups.alternatives.length ? `<details><summary>Alternatif yöntem arşivi (${groups.alternatives.length})</summary>${groups.alternatives.map(render).join('')}</details>` : '');
}
async function loadLiveMatches() {
  if (liveLoading) return;
  liveLoading = true;
  const errorBox = document.getElementById('live-error');
  const playable = document.getElementById('live-playable').checked;
  const dateInput = document.getElementById('live-date');
  if (!dateInput.value) dateInput.value = new Date().toLocaleDateString('sv-SE', {timeZone:'Europe/Istanbul'});
  const day = dateInput.value;
  try {
    const response = await fetch(`/api/live-matches?playable_only=${playable ? '1' : '0'}&date=${encodeURIComponent(day)}`, {signal:AbortSignal.timeout(45000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    liveData = await response.json();
    errorBox.classList.add('hidden');
    renderLiveMatches();
  } catch (err) {
    errorBox.textContent = `Güncelleme alınamadı; ekrandaki önceki skorları güncel kabul etme. ${err.message}`;
    errorBox.classList.remove('hidden');
  } finally {
    liveLoading = false;
    if ((playable !== document.getElementById('live-playable').checked || day !== dateInput.value) && currentTab === 'tab-live') loadLiveMatches();
  }
}
document.getElementById('live-refresh').addEventListener('click', loadLiveMatches);
document.getElementById('live-playable').addEventListener('change', loadLiveMatches);
document.getElementById('live-search').addEventListener('input', renderLiveMatches);
document.getElementById('live-finished').addEventListener('change', renderLiveMatches);
document.getElementById('live-date').addEventListener('change', loadLiveMatches);
document.getElementById('live-status').addEventListener('change', () => {
  if (document.getElementById('live-status').value === 'finished') document.getElementById('live-finished').checked = true;
  renderLiveMatches();
});
document.getElementById('live-today').addEventListener('click', () => {
  document.getElementById('live-date').value = new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'});
  loadLiveMatches();
});

function switchTab(tabId, analysisKey) {
  if (!tabs.includes(tabId)) tabId = "tab-analysis";
  const nested = ['tab-kickoff','tab-flashscore','tab-htft-pairs'].includes(tabId);
  const parentTab = nested ? 'tab-analysis' : tabId;
  if (parentTab === 'tab-analysis') selectAnalysisSubtab(analysisKey || (nested ? tabId.slice(4) : 'top3'), false);
  currentTab = tabId;
  document.dispatchEvent(new CustomEvent('companion-tab-change', {detail: tabId}));
  if (liveInterval) { clearInterval(liveInterval); liveInterval = null; }
  if (tabId === 'tab-live') {
    loadLiveMatches();
    liveInterval = setInterval(loadLiveMatches, 15000);
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const active = btn.dataset.tab === parentTab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.getElementById('analysis-subtabs')?.classList.toggle('analysis-active', parentTab === 'tab-analysis');
  const toolsTrigger = document.getElementById("tools-menu-trigger");
  if (toolsTrigger) {
    const toolsActive = ["tab-matches", "tab-research", "tab-backfill", "tab-health"].includes(parentTab);
    toolsTrigger.classList.toggle("active", toolsActive);
  }

  document.querySelectorAll(".tab-content").forEach((sec) => {
    sec.classList.toggle("active", sec.id === tabId || sec.id === parentTab);
  });

  const hash = tabId.replace("tab-", "");
  if (window.location.hash.replace("#", "") !== hash) {
    history.replaceState(null, "", `#${hash}`);
  }

  // Handle tab-specific data refresh
  if (tabId === "tab-backfill") {
    loadRollingStatus();
    loadBackfillStatus();
    if (!backfillInterval) {
      backfillInterval = setInterval(() => {
        loadRollingStatus();
        loadBackfillStatus();
      }, 5000);
    }
  } else {
    if (backfillInterval) {
      clearInterval(backfillInterval);
      backfillInterval = null;
    }
  }

  if (tabId === "tab-health") {
    loadHealth();
  } else if (tabId === "tab-analysis") {
    loadAnalysis();
  } else if (tabId === "tab-matches" && matchesDataLoaded === false) {
    loadMatches(1);
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    switchTab(btn.dataset.tab);
    if (btn.closest("#tools-menu-popover")) closeToolsMenu();
  });
});

const toolsMenu = document.getElementById("tools-menu");
const toolsMenuTrigger = document.getElementById("tools-menu-trigger");
const toolsMenuPopover = document.getElementById("tools-menu-popover");

function closeToolsMenu() {
  if (!toolsMenuTrigger || !toolsMenuPopover) return;
  toolsMenuPopover.hidden = true;
  toolsMenuTrigger.setAttribute("aria-expanded", "false");
}

if (toolsMenuTrigger && toolsMenuPopover) {
  toolsMenuTrigger.addEventListener("click", () => {
    const opening = toolsMenuPopover.hidden;
    toolsMenuPopover.hidden = !opening;
    toolsMenuTrigger.setAttribute("aria-expanded", opening ? "true" : "false");
    if (opening) toolsMenuPopover.querySelector(".tab-btn")?.focus();
  });
  document.addEventListener("click", (event) => {
    if (!toolsMenu?.contains(event.target)) closeToolsMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeToolsMenu();
      toolsMenuTrigger.focus();
    }
  });
}

// ------------------------------------------------------------------ Tab 1: Genel Bakış
async function loadOverview() {
  try {
    const summary = await getJSON("/api/summary");
    const t = summary.totals || {};
    const kr = summary.kickoff_range || {};

    document.getElementById("stat-matches").innerText = fmtNum(t.matches);
    document.getElementById("stat-snapshots").innerText = fmtNum(t.odds_snapshots);
    document.getElementById("stat-markets").innerText = fmtNum(summary.row_counts?.markets || 0);
    document.getElementById("stat-observations").innerText = fmtNum(t.odds_observations);
    document.getElementById("stat-competitions").innerText = fmtNum(t.competitions);

    const minDate = summary.kickoff_range?.min || summary.row_counts?.min_date;
    const maxDate = summary.kickoff_range?.max || summary.row_counts?.max_date;
    document.getElementById("stat-date-range").innerText =
      minDate && maxDate ? `${minDate} .. ${maxDate}` : "Tüm Kayıtlar";

    // Whitelist summary
    const w = summary.whitelist || {};
    document.getElementById("overview-whitelist").innerHTML = `
      <table class="data-table">
        <tbody>
          <tr><th>Toplam Karar</th><td><strong>${fmtNum(w.total)}</strong></td></tr>
          <tr><th>Kabul Edilen (Accepted)</th><td><span class="pill ok">${fmtNum(w.accepted)}</span></td></tr>
          <tr><th>Reddedilen / Engellenen</th><td><span class="pill bad">${fmtNum(w.rejected)}</span></td></tr>
          <tr><th>Bilinmeyen Turnuva</th><td><span class="pill warn">${fmtNum(w.unknown_competition)}</span></td></tr>
        </tbody>
      </table>`;

    // Competitions
    const aggs = await getJSON("/api/aggregations");
    const comps = aggs.matches_by_competition || [];
    if (!comps.length) {
      document.getElementById("overview-competitions").innerHTML = "<p class='muted'>Kayıt bulunamadı.</p>";
    } else {
      document.getElementById("overview-competitions").innerHTML = `
        <table class="data-table">
          <thead><tr><th>Turnuva ID</th><th>Maç Sayısı</th></tr></thead>
          <tbody>
            ${comps.slice(0, 8).map((c) => `<tr><td><code>${escapeHTML(c.competition_id || "Bilinmiyor")}</code></td><td>${fmtNum(c.n)}</td></tr>`).join("")}
          </tbody>
        </table>`;
    }

    // Recent items
    const recent = await getJSON("/api/recent");
    const recentMatches = recent.recent_matches || [];
    const rMatchEl = document.getElementById("overview-recent-matches");
    if (!recentMatches.length) {
      rMatchEl.innerHTML = "<tr><td class='muted'>Kayıt bulunamadı.</td></tr>";
    } else {
      rMatchEl.innerHTML = `
        <thead><tr><th>Maç Adı</th><th>Tarih</th><th>Durum</th></tr></thead>
        <tbody>
          ${recentMatches.slice(0, 7).map((m) => `
            <tr>
              <td><strong>${escapeHTML(m.match_name || `${m.home_team || "?"} vs ${m.away_team || "?"}`)}</strong></td>
              <td>${escapeHTML(m.kickoff_at_utc || m.captured_at || "—")}</td>
              <td><span class="pill ${m.filter_decision === "ACCEPTED" ? "ok" : "warn"}">${escapeHTML(m.filter_decision || "—")}</span></td>
            </tr>`).join("")}
        </tbody>`;
    }

    const recentOdds = recent.recent_odds || [];
    const rOddsEl = document.getElementById("overview-recent-odds");
    if (!recentOdds.length) {
      rOddsEl.innerHTML = "<tr><td class='muted'>Oran kaydı bulunamadı.</td></tr>";
    } else {
      rOddsEl.innerHTML = `
        <thead><tr><th>Snapshot ID</th><th>Maç ID</th><th>Gözlem Sayısı</th><th>Zaman</th></tr></thead>
        <tbody>
          ${recentOdds.slice(0, 7).map((o) => `
            <tr>
              <td><code>${escapeHTML(o.snapshot_id)}</code></td>
              <td><code>${escapeHTML(o.match_id)}</code></td>
              <td><strong>${fmtNum(o.observation_count || 0)}</strong></td>
              <td>${escapeHTML(o.captured_at)}</td>
            </tr>`).join("")}
        </tbody>`;
    }
  } catch (err) {
    console.error("Overview load error:", err);
  }
}

// ------------------------------------------------------------------ Tab 2: Maçlar ve Oranlar
let matchesCurrentPage = 1;
let matchesPageSize = 25;
let matchesDataLoaded = false;

async function loadMatches(page = 1) {
  matchesCurrentPage = page;
  const tbody = document.getElementById("matches-tbody");
  tbody.innerHTML = `<tr><td colspan="8" class="text-center muted p-2">Maçlar getiriliyor...</td></tr>`;

  const form = document.getElementById("matches-filter-form");
  const fd = new FormData(form);
  const params = new URLSearchParams();

  for (const [key, value] of fd.entries()) {
    if (value) params.set(key, value);
  }
  params.set("page", page);
  matchesPageSize = parseInt(fd.get("page_size") || "25", 10);
  params.set("page_size", matchesPageSize);

  try {
    const data = await getJSON(`/api/matches-with-odds?${params.toString()}`);
    matchesDataLoaded = true;

    // Update top metrics
    const t = data.totals || {};
    document.getElementById("matches-metric-total").innerText = `${fmtNum(t.matches)} Maç`;
    document.getElementById("matches-metric-counts").innerText =
      `${fmtNum(t.snapshots)} Snapshot · ${fmtNum(t.markets)} Market · ${fmtNum(t.odds_observations)} Oran`;

    const dr = data.date_range || {};
    document.getElementById("matches-metric-range").innerText =
      dr.min && dr.max ? `${dr.min} — ${dr.max}` : "Bilinmiyor";

    // Counter and pagination
    const total = data.total || 0;
    const totalPages = Math.max(1, Math.ceil(total / matchesPageSize));
    const startIdx = total === 0 ? 0 : (page - 1) * matchesPageSize + 1;
    const endIdx = Math.min(total, page * matchesPageSize);

    const counterText = `Toplam ${fmtNum(total)} maçtan ${fmtNum(startIdx)} - ${fmtNum(endIdx)} arası listeleniyor (Sayfa ${page} / ${totalPages})`;
    document.getElementById("matches-counter").innerText = counterText;

    renderPaginationControls("pagination-top", page, totalPages);
    renderPaginationControls("pagination-bottom", page, totalPages);

    const rows = data.rows || [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center muted p-2">Filtre kriterlerine uygun maç bulunamadı.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map((r) => {
        const hasOdds = r.has_odds;
        const snapBadge = hasOdds
          ? `<span class="pill ok">${r.snapshot_count} snapshot</span>`
          : `<span class="pill unknown">Oran Yok</span>`;

        const statusBadge = r.status === "finished"
          ? `<span class="pill ok">${escapeHTML(r.status_tr)}</span>`
          : (r.status === "cancelled" || r.status === "postponed"
              ? `<span class="pill bad">${escapeHTML(r.status_tr)}</span>`
              : `<span class="pill unknown">${escapeHTML(r.status_tr || "—")}</span>`);

        const scoreDisplay = r.score_text
          ? `<span class="score-display"><strong>${escapeHTML(r.score_text)}</strong> ${r.halftime_text ? `<small class="muted">${escapeHTML(r.halftime_text)}</small>` : ""}</span>`
          : `<span class="muted">—</span>`;

        return `
        <tr>
          <td><strong>${escapeHTML(r.date || r.raw_date || "—")}</strong></td>
          <td><code>${escapeHTML(r.time || "—")}</code></td>
          <td><span class="tournament-badge">${escapeHTML(r.tournament || "Bilinmiyor")}</span></td>
          <td class="team-cell">${escapeHTML(r.home_team || "Bilinmiyor")}</td>
          <td class="text-center score-cell">${scoreDisplay}</td>
          <td class="team-cell">${escapeHTML(r.away_team || "Bilinmiyor")}</td>
          <td>${statusBadge}</td>
          <td>${snapBadge}</td>
          <td><span class="muted">${escapeHTML(r.last_odds_time || "—")}</span></td>
          <td class="text-right">
            <button type="button" class="btn btn-action btn-sm btn-view-odds" data-id="${escapeHTML(r.match_id)}">
              Oranları Gör
            </button>
          </td>
        </tr>`;
      })
      .join("");

    // Attach click events to "Oranları Gör" buttons
    tbody.querySelectorAll(".btn-view-odds").forEach((b) => {
      b.addEventListener("click", () => openOddsModal(b.dataset.id));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center p-2"><span class="pill bad">Hata: ${escapeHTML(err.message)}</span></td></tr>`;
  }
}

function renderPaginationControls(containerId, page, totalPages) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <button type="button" class="page-btn" ${page <= 1 ? "disabled" : ""} data-p="1" title="İlk Sayfa">« İlk</button>
    <button type="button" class="page-btn" ${page <= 1 ? "disabled" : ""} data-p="${page - 1}" title="Önceki Sayfa">‹ Önceki</button>
    <span class="page-info">${page} / ${totalPages}</span>
    <button type="button" class="page-btn" ${page >= totalPages ? "disabled" : ""} data-p="${page + 1}" title="Sonraki Sayfa">Sonraki ›</button>
    <button type="button" class="page-btn" ${page >= totalPages ? "disabled" : ""} data-p="${totalPages}" title="Son Sayfa">Son »</button>
  `;

  container.querySelectorAll(".page-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = parseInt(btn.dataset.p, 10);
      if (p && p !== matchesCurrentPage) loadMatches(p);
    });
  });
}

document.getElementById("matches-filter-form").addEventListener("submit", (e) => {
  e.preventDefault();
  loadMatches(1);
});

document.getElementById("btn-reset-filters").addEventListener("click", () => {
  const form = document.getElementById("matches-filter-form");
  form.reset();
  loadMatches(1);
});

// ------------------------------------------------------------------ Oran Detay Modalı
const modal = document.getElementById("odds-modal");
let currentModalData = null;
let modalRequestVersion = 0;
let insightsController = null;

function evidenceText(stat) {
  return stat && stat.sample ? `${stat.hits}/${stat.sample} geçmiş maç · %${stat.pct}${stat.sample < 20 ? ' · ZAYIF KANIT: 20 maçın altında; kazanma ihtimali değildir' : ''}` : 'Yetersiz veri';
}

function conditionText(p) {
  if (!p) return '';
  return `${p.method || ''} koşul: ${(p.legs || []).map(l => `${l.market} ${l.selection} ${l.price}`).join(' + ')}`;
}
function distributionDetails(d) {
  if (!d || !d.sample) return '<p>Bu oran koşullarına uyan sonuçlanmış maç yok.</p>';
  const metric = (label, value) => `${label}: ${value?.count || 0} (%${value?.pct || 0})`;
  return `<details><summary>Bu oranlar birlikteyken maçlar nasıl bitmiş? (${d.sample} maç)</summary><p>${['1','0','2'].map(k => metric('MS ' + k, d.outcomes[k])).join(' · ')}</p><p>${['1-0','0-2','1-2'].map(k => metric('ÇŞ ' + k, d.double_chance[k])).join(' · ')}</p>${Object.entries(d.totals || {}).map(([line, values]) => `<p>${line} gol: ${metric('Alt', values.Alt)} · ${metric('Üst', values['Üst'])}</p>`).join('')}<p>Son eşleşmeler (en fazla 20):</p>${(d.examples || []).map(m => `<div>${escapeHTML(m.date || '')} · ${escapeHTML(m.match_name)} · ${escapeHTML(m.score)}</div>`).join('')}<p>Oranlar aynı maçın aynı kaydında eşleşir; çarpılmaz. Ana analiz tüm günleri kapsar.</p></details>`;
}

function evidenceDetails(insight) {
  return (insight.condition_evidence || []).map(p => `<p><strong>${escapeHTML(conditionText(p))}</strong><br>Bu satırdaki sonuç: ${escapeHTML(evidenceText(p.history))}<br>Aynı kalan süre: ${escapeHTML(evidenceText(p.same_time))}<br>Aynı hareket yönü: ${escapeHTML(evidenceText(p.same_movement))}<br>İsteğe bağlı gün karşılaştırması: ${escapeHTML(evidenceText(p.weekday_history))}</p>${distributionDetails(p.distribution)}`).join('');
}

async function loadMatchInsights(matchId, version) {
  if (version !== modalRequestVersion) return;
  insightsController = new AbortController();
  const controller = insightsController;
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(`/api/match-insights/${encodeURIComponent(matchId)}`, {signal: insightsController.signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (version !== modalRequestVersion) return;
    if (response.status === 202) {
      document.getElementById('modal-insights').textContent = data.error ? 'Geçmiş hazırlığında hata oldu; otomatik tekrar denenecek. Oranlar kullanılabilir.' : data.message;
      setTimeout(() => loadMatchInsights(matchId, version), 5000);
      return;
    }
    const byKey = new Map(data.selections.map(s => [s.series_key, s]));
    for (const market of currentModalData.markets) {
      for (const selection of market.selections) selection.insight = byKey.get(selection.series_key);
    }
    const alternatives = data.alternatives.map(key => byKey.get(key)).filter(Boolean);
    document.getElementById('modal-insights').innerHTML = `<strong>${data.mode === 'retrospective' ? 'Değerlendirme görünümü — ayrı alternatifler' : 'Öne çıkan ayrı alternatifler'}</strong><p>${escapeHTML(data.timing_note || '')}</p><p>${escapeHTML(data.note)}</p>` +
      (alternatives.length ? alternatives.map(s => `<p><strong>${escapeHTML(s.market)} · ${escapeHTML(s.selection)} · ${s.price.toFixed(2)}</strong><br>Tüm günler: ${escapeHTML(evidenceText(s.recommendation_evidence?.history || s.history))}<br>${escapeHTML(conditionText(s.recommendation_evidence))}</p>`).join('') : `<p>${escapeHTML(data.reason)}</p>`) +
      `<small>Oran kaydı: ${escapeHTML(data.captured_at || 'Bilinmiyor')}. İkili/üçlü koşullar her seçimin detayında. Benzerlik: 0,05 genişliğinde oran dilimleri; geçmiş karşılaştırma tüm liglerden.</small>` +
      `<h4>Öneri kontrolü — neden var / neden yok?</h4><p>${escapeHTML(data.journal_status?.message || '')}</p><p>${escapeHTML(data.diagnostics?.scope || '')}</p>` +
      (data.diagnostics?.match_blocker ? `<p><strong>Maç düzeyinde engel:</strong> ${escapeHTML(data.diagnostics.match_blocker)}</p>` : '') +
      (data.diagnostics?.no_odds ? '<p>Bu maç için analiz edilebilecek oran kaydı yok.</p>' : '') +
      `<p>${data.diagnostics?.total_selections ?? 0} seçim incelendi; ${data.diagnostics?.eligible_selections ?? 0} seçim tüm koşulları geçti; ${alternatives.length} alternatif gösteriliyor.</p><p class="muted">${escapeHTML(data.diagnostics?.ranking_note || '')}</p>` +
      `<details ${alternatives.length ? '' : 'open'}><summary>Seçim bazında kontrol sonuçları</summary><div class="table-responsive"><table class="data-table"><thead><tr><th>Market / seçim</th><th>Oran</th><th>Geçmiş örnek</th><th>Gerçekleşme</th><th>Kontrol sonucu</th></tr></thead><tbody>${data.selections.map(s => {
        const h = s.recommendation_evidence?.history || s.history;
        const reasons = (s.rejection_reasons || []).map(r => r.message);
        if (data.diagnostics?.match_blocker) reasons.unshift('Maç düzeyindeki engel geçerli');
        if (!reasons.length) reasons.push(s.recommendation_status === 'selected' ? 'Alternatif olarak seçildi' : 'Şartları geçti; sıralama / farklı market sınırı nedeniyle gösterilmiyor');
        return `<tr><td>${escapeHTML(s.market)} · ${escapeHTML(s.selection)}</td><td>${s.price == null ? '—' : s.price.toFixed(2)}</td><td>${h.sample} / en az 20</td><td>${h.pct == null ? 'Veri yok' : '%' + h.pct} / en az %60</td><td>${reasons.map(escapeHTML).join('<br>')}</td></tr>`;
      }).join('')}</tbody></table></div></details>`;
    renderModalMarkets(currentModalData.markets, document.getElementById('modal-market-search').value);
  } catch (error) {
    if (version !== modalRequestVersion) return;
    currentModalData.insightsFailed = true;
    document.getElementById('modal-insights').textContent = 'Geçmiş analiz yüklenemedi. Oranlar aşağıda kullanılabilir; pencereyi yeniden açarak tekrar deneyebilirsin.';
    renderModalMarkets(currentModalData.markets, document.getElementById('modal-market-search').value);
  } finally { clearTimeout(timer); }
}

async function openOddsModal(matchId) {
  const version = ++modalRequestVersion;
  insightsController?.abort();
  currentModalData = null;
  document.getElementById('modal-market-search').value = '';
  document.getElementById('modal-insights').textContent = 'Geçmiş istatistikler ayrıca yükleniyor. Oranın ima ettiği yüzde 1/orandır; marj içerir ve kazanma tahmini değildir.';
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");

  document.getElementById("modal-tournament").innerText = "Turnuva yükleniyor...";
  document.getElementById("modal-match-title").innerText = "Oranlar Alınıyor...";
  document.getElementById("modal-match-meta").innerText = "Lütfen bekleyin...";
  document.getElementById("modal-stat-snaps").innerText = "—";
  document.getElementById("modal-stat-markets").innerText = "—";
  document.getElementById("modal-stat-obs").innerText = "—";
  document.getElementById("modal-stat-provider").innerText = "—";
  const resEl = document.getElementById("modal-result-section");
  if (resEl) resEl.innerHTML = "";
  const movEl = document.getElementById("modal-movement-banner");
  if (movEl) movEl.innerHTML = "";
  document.getElementById("modal-markets-container").innerHTML = `
    <div class="p-2 text-center muted">Detaylı oran ve snapshot verileri yükleniyor...</div>`;

  try {
    const data = await getJSON(`/api/match-odds/${encodeURIComponent(matchId)}`);
    if (version !== modalRequestVersion) return;
    currentModalData = data;
    const m = data.match || {};
    const totals = data.totals || {};

    document.getElementById("modal-tournament").innerText = m.tournament || "Bilinmiyor";
    document.getElementById("modal-match-title").innerText = `${m.home_team || "Bilinmiyor"} vs ${m.away_team || "Bilinmiyor"}`;
    document.getElementById("modal-match-meta").innerText = `Tarih: ${m.date || m.raw_date || "—"} · Saat: ${m.time || "—"} · Sağlayıcı: ${m.provider || "mackolik"}`;
    document.getElementById("modal-stat-snaps").innerText = fmtNum(totals.snapshots);
    document.getElementById("modal-stat-markets").innerText = fmtNum(totals.markets);
    document.getElementById("modal-stat-obs").innerText = fmtNum(totals.observations);
    document.getElementById("modal-stat-provider").innerText = m.provider || "mackolik";

    // 1. Maç Sonucu Kartı
    const res = data.result;
    if (resEl) {
      if (res && res.status === "finished" && res.score_text && res.score_text !== "—") {
        resEl.innerHTML = `
          <div class="match-result-card">
            <div class="result-teams-box">
              <span class="team-name">${escapeHTML(m.home_team || "Ev Sahibi")}</span>
              <span class="result-score">${escapeHTML(res.score_text)}</span>
              <span class="team-name">${escapeHTML(m.away_team || "Deplasman")}</span>
            </div>
            <div class="result-sub-info">
              <span class="pill ok">${escapeHTML(res.status_tr)}</span>
              ${res.halftime_text ? `<span class="ht-score">İlk Yarı: ${escapeHTML(res.halftime_text)}</span>` : ""}
              ${res.status_box ? `<span class="status-box-tag">${escapeHTML(res.status_box)}</span>` : ""}
              <span class="muted"><small>Sonuç Kaynağı: mackolik · Güncellenme: ${escapeHTML(res.updated_at || "—")}</small></span>
            </div>
          </div>`;
      } else if (res && (res.status === "cancelled" || res.status === "postponed" || res.status === "abandoned")) {
        resEl.innerHTML = `
          <div class="match-result-card">
            <div class="result-sub-info">
              <span class="pill bad">${escapeHTML(res.status_tr)}</span>
              ${res.status_box ? `<span class="status-box-tag">${escapeHTML(res.status_box)}</span>` : ""}
              <span class="muted">Maç oynanmadı veya tamamlanmadı.</span>
            </div>
          </div>`;
      } else if (res && res.status === "scheduled") {
        resEl.innerHTML = `
          <div class="match-result-card empty-result">
            <span class="pill unknown">Planlandı</span>
            <span class="muted">Maç henüz oynanmadı. Başlama saati: ${escapeHTML(m.time || "—")}</span>
          </div>`;
      } else {
        resEl.innerHTML = `
          <div class="match-result-card empty-result">
            <span class="muted">Sonuç bilgisi henüz işlenmedi veya maç oynanmadı.</span>
          </div>`;
      }
    }

    // 2. Oran Hareketleri Bannerı
    if (movEl) {
      if (data.movement_available) {
        movEl.innerHTML = `
          <div class="alert-box alert-success">
            📈 <strong>Gerçek Oran Değişimi Mevcut:</strong> Zaman serisi oran hareketleri ve değişim yüzdeleri aşağıda listelenmiştir.
          </div>`;
      } else {
        movEl.innerHTML = `
          <div class="alert-box alert-info">
            ℹ️ <strong>${escapeHTML(data.movement_message || "Gerçek oran değişimi henüz kaydedilmemiştir.")}</strong>
          </div>`;
      }
    }

    renderModalMarkets(data.markets || "");
    loadMatchInsights(matchId, version);
  } catch (err) {
    if (version !== modalRequestVersion) return;
    document.getElementById("modal-markets-container").innerHTML = `
      <div class="alert-box alert-warn">Oranlar alınamadı: ${escapeHTML(err.message)}</div>`;
  }
}

function renderModalMarkets(markets, query = "") {
  const container = document.getElementById("modal-markets-container");
  if (!markets || !markets.length) {
    container.innerHTML = `<div class="p-2 text-center muted">Bu maça ait henüz kayıtlı oran bulunmuyor.</div>`;
    return;
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? markets.filter((m) => m.display_name.toLowerCase().includes(q))
    : markets;

  if (!filtered.length) {
    container.innerHTML = `<div class="p-2 text-center muted">Arama kriterine uygun market bulunamadı.</div>`;
    return;
  }

  container.innerHTML = filtered
    .map((m, mIdx) => {
      const selections = m.selections || [];
      const rowsHtml = selections
        .map((s, sIdx) => {
          let diffHtml = '<span class="diff-badge diff-flat">—</span>';
          if (s.has_movement && s.change_amount !== null && s.change_amount !== undefined) {
            if (s.direction === "up") {
              diffHtml = `<span class="diff-badge diff-up">▲ +${s.change_amount.toFixed(2)} (%+${s.change_percent.toFixed(1)})</span>`;
            } else if (s.direction === "down") {
              diffHtml = `<span class="diff-badge diff-down">▼ ${s.change_amount.toFixed(2)} (%${s.change_percent.toFixed(1)})</span>`;
            }
          } else if (s.direction === "flat") {
            diffHtml = `<span class="diff-badge diff-flat" title="${escapeHTML(s.message || 'Fiyat sabit kaldı')}">Değişmedi (${escapeHTML(s.current_price)})</span>`;
          } else {
            diffHtml = `<span class="diff-badge diff-single" title="${escapeHTML(s.message || '')}">Tek Ölçüm</span>`;
          }

          const histKey = `hist-${mIdx}-${sIdx}`;
          const numericPrice = Number(String(s.current_price || '').replace(',', '.'));
          const implied = Number.isFinite(numericPrice) && numericPrice > 1 ? `%${(100/numericPrice).toFixed(1)}` : '—';
          const insight = s.insight;
          const empirical = insight ? (insight.supported ? evidenceText(insight.history) : 'Fiyat türü veya sonuç verisi doğrulanamadı; analiz dışı') : (currentModalData?.insightsFailed ? 'Analiz alınamadı' : 'Hesaplanıyor…');
          const patternDetails = insight ? `<details><summary>Tekli / ikili / üçlü oran koşulları</summary><p>Bu oranın hareketi: ${escapeHTML(insight.movement || 'Yeterli ölçüm yok')} ${insight.change_pct == null ? '' : '%' + insight.change_pct}; ölçümde maça kalan süre: ${escapeHTML(insight.lead_band || 'Bilinmiyor')}</p><p>${escapeHTML(insight.weekday)} ek karşılaştırması: ${escapeHTML(evidenceText(insight.weekday_history))}</p>${insight.price_range ? `<p>Oran dilimi: ${insight.price_range.join('–')}</p>` : ''}${evidenceDetails(insight)}<p>Hareket ve süre alt grupları ek karşılaştırmadır; otomatik başarı artışı varsayılmaz.</p>${!insight.current_snapshot ? '<p>Son snapshot içinde yok; alternatif olarak kullanılmaz.</p>' : ''}</details>` : '';
          const history = s.history || [];
          const histBtnHtml = history.length > 1
            ? `<button type="button" class="price-history-btn" data-target="${histKey}">Zaman Serisi (${history.length})</button>`
            : `<span class="muted"><small>Tek ölçüm</small></span>`;

          return `
          <tr>
            <td><strong>${escapeHTML(s.selection_label || s.selection_key || "—")}</strong></td>
            <td><span class="price-current">${escapeHTML(s.current_price || "—")}</span></td>
            <td title="1 / oran. Marj içerir; model tahmini değildir.">${implied}</td>
            <td><small>${escapeHTML(empirical)}</small>${patternDetails}</td>
            <td><span class="muted">${escapeHTML(s.first_price || "—")}</span></td>
            <td>${diffHtml}</td>
            <td><span class="muted">${escapeHTML(s.last_captured_at || "—")}</span></td>
            <td><small>${escapeHTML(s.provider || "mackolik")}</small></td>
            <td class="text-right">
              ${histBtnHtml}
            </td>
          </tr>
          ${
            history.length > 1
              ? `<tr id="${histKey}" class="history-panel">
                  <td colspan="9">
                    <div class="history-timeline">
                      <span class="muted">Oran Değişim Zaman Serisi:</span>
                      ${history
                        .map(
                          (h) => `
                        <div class="history-chip">
                          <span class="time">${escapeHTML(h.captured_at || h.captured_at_raw)}:</span>
                          <span class="price">${escapeHTML(h.price)}</span>
                        </div>`
                        )
                        .join("")}
                    </div>
                  </td>
                </tr>`
              : ""
          }`;
        })
        .join("");

      return `
      <div class="market-group-card">
        <div class="market-group-header">
          <span class="market-group-title">🎯 ${escapeHTML(m.display_name)}</span>
          <span class="muted"><small>${selections.length} Seçenek</small></span>
        </div>
        <div class="table-responsive">
          <table class="selections-table">
            <thead>
              <tr>
                <th>Seçenek</th>
                <th>Son Oran</th>
                <th>Oranın İma Ettiği %</th>
                <th>Geçmiş Gerçekleşme</th>
                <th>İlk Oran</th>
                <th>Değişim</th>
                <th>Kayıt Zamanı</th>
                <th>Sağlayıcı</th>
                <th class="text-right">Geçmiş</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>`;
    })
    .join("");

  // Attach event listener for history toggles
  container.querySelectorAll(".price-history-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.target);
      if (target) {
        target.classList.toggle("open");
        btn.innerText = target.classList.contains("open") ? "Kapat" : `Zaman Serisi`;
      }
    });
  });
}

document.getElementById("modal-market-search").addEventListener("input", (e) => {
  if (currentModalData && currentModalData.markets) {
    renderModalMarkets(currentModalData.markets, e.target.value);
  }
});

function closeOddsModal() {
  ++modalRequestVersion;
  insightsController?.abort();
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  currentModalData = null;
}

document.getElementById("btn-close-modal").addEventListener("click", closeOddsModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeOddsModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal.classList.contains("open")) closeOddsModal();
});

// ------------------------------------------------------------------ Tab 3: Oran Analizi
let analysisLoaded = false;
let analysisLoading = false;
let analysisMarkets = [];
let automaticPatterns = [];
let singleAnalysisRows = [];
let visibleSingleRows = [];
let singleSort = { key: "sample", direction: "desc" };

const pctText = (entry) => `${fmtNum(entry?.count || 0)} (%${fmt(entry?.pct)})`;
const outcomeText = (value) => ({ "1": "MS 1", "0": "MS 0", "2": "MS 2" }[value] || "—");

function marketByKey(key) {
  return analysisMarkets.find((market) => market.key === key);
}

function setSelectionOptions(select, marketKey, includeAll = false) {
  const market = marketByKey(marketKey);
  const first = includeAll ? "Tüm seçimler" : "Seçim seç";
  select.innerHTML = `<option value="">${first}</option>` +
    (market?.selections || []).map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("");
}

function setupAnalysisControls(data) {
  analysisMarkets = data.markets || [];
  const marketOptions = analysisMarkets.map((market) => `<option value="${escapeHTML(market.key)}">${escapeHTML(market.label)}</option>`).join("");
  const mainMarket = document.getElementById("analysis-market");
  mainMarket.innerHTML = `<option value="">Tüm doğrulanabilir İddaa marketleri</option>${marketOptions}`;
  mainMarket.onchange = () => setSelectionOptions(document.getElementById("analysis-selection"), mainMarket.value, true);

  document.querySelectorAll(".leg-market").forEach((select, index) => {
    const prompt = index === 2 ? "İsteğe bağlı üçüncü market" : "Market seç";
    select.innerHTML = `<option value="">${prompt}</option>${marketOptions}`;
    select.onchange = () => setSelectionOptions(select.closest(".pattern-leg").querySelector(".leg-selection"), select.value);
  });

  const weekday = document.getElementById("analysis-weekday");
  weekday.innerHTML = `<option value="">Tüm günleri birleştir</option>` +
    (data.weekdays || []).map((day) => `<option value="${escapeHTML(day)}">Yalnız ${escapeHTML(day)}</option>`).join("");
  document.getElementById("analysis-finished-count").innerText = `${fmtNum(data.finished_results || 0)} / ${fmtNum(data.total_matches || 0)}`;
  document.getElementById("analysis-result-coverage").innerText =
    `%${fmt(data.result_coverage_pct)} sonuç kapsamı · ${fmtNum(data.result_competitions || 0)} lig/turnuva · ${escapeHTML(data.result_date_range?.min || "—")}–${escapeHTML(data.result_date_range?.max || "—")} · Analize uygun ${fmtNum(data.finished_matches || 0)}`;
  document.getElementById("analysis-scope").innerHTML = `<strong>Tüm ligler analizde</strong><span>Adaylar: Mackolik/İddaa oranı bulunan tüm maçlar</span>`;
  document.getElementById("analysis-league-list").textContent = "İstatistik eşiği: en az 20 geçmiş maç ve %60 gerçekleşme";
}

function renderSingleAnalysis(data) {
  singleAnalysisRows = data.rows || [];
  const body = document.getElementById("single-analysis-body");
  document.getElementById("single-analysis-count").innerText = `${fmtNum(data.total || 0)} oran dilimi`;
  if (!singleAnalysisRows.length) {
    body.innerHTML = `<tr><td colspan="13" class="muted text-center p-2">Bu filtrede yeterli tamamlanmış maç yok.</td></tr>`;
    return;
  }
  const valueFor = (row) => ({
    weekday: row.weekday, price: row.price, sample: row.sample,
    ms1: row.outcomes?.["1"]?.pct || 0, ms0: row.outcomes?.["0"]?.pct || 0, ms2: row.outcomes?.["2"]?.pct || 0,
    dc02: row.double_chance?.["0-2"]?.pct || 0, dc12: row.double_chance?.["1-2"]?.pct || 0, dc10: row.double_chance?.["1-0"]?.pct || 0,
    selection_hit_pct: row.selection_hit_pct, dominant_pct: row.dominant_pct,
  }[singleSort.key]);
  visibleSingleRows = [...singleAnalysisRows].sort((a, b) => {
    const av = valueFor(a); const bv = valueFor(b);
    const cmp = typeof av === "string" ? av.localeCompare(bv, "tr") : Number(av) - Number(bv);
    return singleSort.direction === "asc" ? cmp : -cmp;
  });
  body.innerHTML = visibleSingleRows.map((row, index) => `
    <tr>
      <td><span class="day-chip">${escapeHTML(row.weekday)}</span></td>
      <td><strong>${escapeHTML(row.market)}</strong><br><span class="selection-tag">${escapeHTML(row.selection)}</span></td>
      <td><span class="odds-value">${Number(row.price).toFixed(2)}</span><br><small class="muted">${row.price_range.map((v) => Number(v).toFixed(3)).join("–")}</small></td>
      <td><strong>${fmtNum(row.sample)}</strong></td>
      <td>${pctText(row.outcomes?.["1"])}</td>
      <td>${pctText(row.outcomes?.["0"])}</td>
      <td>${pctText(row.outcomes?.["2"])}</td>
      <td><strong>${pctText(row.double_chance?.["0-2"])}</strong></td>
      <td><strong>${pctText(row.double_chance?.["1-2"])}</strong></td>
      <td><strong>${pctText(row.double_chance?.["1-0"])}</strong></td>
      <td><span class="rate-pill">%${fmt(row.selection_hit_pct)}</span></td>
      <td><strong>${outcomeText(row.dominant_outcome)}</strong> · %${fmt(row.dominant_pct)}</td>
      <td><button class="btn btn-secondary btn-single-matches" data-index="${index}">Gör</button></td>
    </tr>`).join("");
  body.querySelectorAll(".btn-single-matches").forEach((button) => button.addEventListener("click", () => loadSingleMatches(visibleSingleRows[Number(button.dataset.index)])));
}

function patternLegText(leg) {
  return `${escapeHTML(leg.market)} <strong>${escapeHTML(leg.selection)}</strong> <span class="odds-value">${Number(leg.price).toFixed(2)}</span>`;
}

function renderAutomaticPatterns(data) {
  automaticPatterns = data.rows || [];
  const body = document.getElementById("pattern-analysis-body");
  document.getElementById("pattern-analysis-count").innerText = `${fmtNum(data.total || 0)} kalıp`;
  if (!automaticPatterns.length) {
    body.innerHTML = `<tr><td colspan="11" class="muted text-center p-2">Bu filtrede yeterli iki-oran kalıbı yok.</td></tr>`;
    return;
  }
  body.innerHTML = automaticPatterns.map((row, index) => `
    <tr>
      <td><span class="day-chip">${escapeHTML(row.weekday)}</span></td>
      <td><div class="leg-stack">${row.legs.map(patternLegText).join("<span class='plus-sign'>+</span>")}</div></td>
      <td><strong>${fmtNum(row.sample)}</strong></td>
      <td>${pctText(row.outcomes?.["1"])}</td><td>${pctText(row.outcomes?.["0"])}</td><td>${pctText(row.outcomes?.["2"])}</td>
      <td><strong>${pctText(row.double_chance?.["0-2"])}</strong></td>
      <td><strong>${pctText(row.double_chance?.["1-2"])}</strong></td>
      <td><strong>${pctText(row.double_chance?.["1-0"])}</strong></td>
      <td><strong>${outcomeText(row.dominant_outcome)}</strong> · %${fmt(row.dominant_pct)}</td>
      <td><button class="btn btn-secondary btn-use-pattern" data-index="${index}">Aç</button></td>
    </tr>`).join("");
  body.querySelectorAll(".btn-use-pattern").forEach((button) => button.addEventListener("click", () => useAutomaticPattern(Number(button.dataset.index))));
}

function recommendationHistoryHTML(row) {
  const detail = row.history_detail;
  if (!detail) return '<p>Bu önerinin geçmiş maç detayı henüz hazırlanmadı; sonraki yenilemeyi bekleyebilirsin.</p>';
  const checked = Date.parse(row.verified_at || row.captured_at);
  const stale = !Number.isFinite(checked) || Date.now() - checked > 6 * 3600000;
  return `<p><strong>${escapeHTML(row.method)} · ${escapeHTML(conditionText(row.evidence))}</strong></p>
    <p>İzlenen sonuç: ${escapeHTML(row.market)} · ${escapeHTML(row.selection)}. ${detail.total} farklı geçmiş maç: ${detail.hits} tuttu, ${detail.total-detail.hits} tutmadı. En yeni ${detail.shown} maç aşağıda; yüzdeler yalnız bu listeye değil tüm ${detail.total} maça dayanır.</p>
    <p>Son oran kontrolü: ${escapeHTML(liveTime(row.verified_at || row.captured_at))}. ${stale ? 'UYARI: oran güncelliği yeniden doğrulanmalı.' : 'Öneri hesaplanırken kullanılan oran kontrol zamanı gösterilir.'}</p>
    <p class="muted">Risk: ${escapeHTML(row.risk_level || 'Henüz değerlendirilmedi')}. ${detail.total < 20 ? 'Örnek sayısı yetersiz.' : 'Geçmiş gerçekleşme, bu maçın kesin kazanma ihtimali değildir.'} Aynı gün ve sonraki tarihli maçlar bu önerinin geçmişine katılmaz. Geç toplanmış arşiv oranları bulunabilir; hepsinin maç öncesi fiyat olduğu doğrulanmış değildir.</p>
    <div class="table-responsive"><table class="data-table"><thead><tr><th>Tarih</th><th>Maç / Lig</th><th>İlk yarı</th><th>Maç sonu</th><th>Önerilen seçim gerçekleşti mi?</th></tr></thead><tbody>${detail.matches.map(m => `<tr><td>${escapeHTML(m.date)}</td><td>${escapeHTML(m.match_name)}<br><small>${escapeHTML(m.league)}</small></td><td>${escapeHTML(m.half_time_score || '—')}</td><td>${escapeHTML(m.score)}</td><td>${m.hit ? 'Tuttu' : 'Tutmadı'}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderRecommendations(data) {
  if (!document.getElementById('daily-match-cards')) renderDailyMatchCards([]);
  if (data.building) {
    document.getElementById('recommendation-count').textContent = 'Geçmiş hazırlanıyor';
    document.getElementById('recommendation-body').innerHTML = '<tr><td colspan="8">Maç öncesi oran geçmişi hazırlanıyor; otomatik tekrar kontrol edilecek.</td></tr>';
    setTimeout(async () => {
      try { renderRecommendations(await getJSON('/api/analysis/recommendations')); }
      catch (_) { document.getElementById('recommendation-count').textContent = 'Analizi yenileyerek tekrar deneyebilirsin'; }
    }, 15000);
    return;
  }
  const rows = data.rows || [];
  const body = document.getElementById("recommendation-body");
  renderDailyMatchCards(rows);
  const d = data.diagnostics;
  const coverage = data.coverage || {};
  document.getElementById('analysis-coverage').textContent = coverage.finished_results == null ? '' :
    `${fmtNum(coverage.finished_results)} sonuçlu maç; ${fmtNum(coverage.finished_with_odds)} maçın oran kaydı geçmiş analiz havuzunda değerlendirilir. Bunların ${fmtNum(coverage.finished_with_prematch_odds)} tanesinde maç öncesi kayıt doğrulanmış; diğerleri dışlanmaz. Geç toplanan arşiv oranlarının maç öncesi fiyat olduğu kesin değildir. Kullanılabilir market ve skor koşulları uygulanır. Oran dilimi: ${Number(coverage.price_bucket).toFixed(2)}. Tahmin başarı günlüğü yalnız gerçek maç öncesi kayıtları sayar.`;
  document.getElementById("recommendation-count").innerText = `${fmtNum(rows.length)} aday` + (d ? ` | ${d.total_matches} İddaa oranlı maç · zaman uygun değil ${d.invalid_time} · güncel oran kontrolü bekleyen ${d.stale_quotes} · eşleşme hesabına giren ${d.eligible_matches}` : '');
  const forwardLine = (row, days) => {
    const p = row.forward_performance?.[String(days)] || {};
    const settled = Number(p.won || 0) + Number(p.lost || 0);
    return settled ? `${days} gün: ${settled} sonuç · ort. ${p.average_odds == null ? '—' : Number(p.average_odds).toFixed(2)} · ROI ${p.roi_pct == null ? '—' : '%' + p.roi_pct}` : `${days} gün: sonuçlanmış ileri kayıt yok`;
  };
  body.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escapeHTML(row.date)}<br><small>${escapeHTML(row.weekday)}${row.kickoff_at_utc && Number.isFinite(Date.parse(row.kickoff_at_utc)) ? ' · ' + new Date(row.kickoff_at_utc).toLocaleTimeString('tr-TR', {timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit'}) : ' · Saat bilinmiyor'}</small></td>
      <td><strong>${escapeHTML(row.match_name)}</strong><br><small>${escapeHTML(row.league)}</small></td>
      <td><strong>${escapeHTML(row.market)}</strong><br><span class="selection-tag">${escapeHTML(row.selection)}</span><br><small>${escapeHTML(conditionText(row.evidence))}</small>${row.odds_fallback_used ? `<br><small class="danger">⚠ Son oran çekilemedi; eldeki son kayıt kullanıldı.${oddsTimingText(row) ? ` ${escapeHTML(oddsTimingText(row))}` : ''}</small>` : row.odds_quote_state === 'final' ? `<br><small class="success">Son oran kontrol edildi.${oddsTimingText(row) ? ` ${escapeHTML(oddsTimingText(row))}` : ''}</small>` : ''}<details><summary>Neden önerildi?</summary>${(row.explanation || []).map(x => `<p>${escapeHTML(x)}</p>`).join('')}<p>${escapeHTML(row.odds_notice || '')}${oddsTimingText(row) ? `<br>${escapeHTML(oddsTimingText(row))}` : ''}</p><p>Oran hareketi: ${escapeHTML(row.movement || 'Yeterli ölçüm yok')}${row.change_pct == null ? '' : ` (%${fmt(row.change_pct)})`} · Maça kalan süre: ${escapeHTML(row.lead_band || 'Bilinmiyor')}</p><p>${escapeHTML(forwardLine(row,7))}<br>${escapeHTML(forwardLine(row,30))}</p>${row.evidence ? `<p>Aynı kalan süre geçmişi: ${escapeHTML(evidenceText(row.evidence.same_time))}<br>Aynı hareket geçmişi: ${escapeHTML(evidenceText(row.evidence.same_movement))}</p>` : ''}<p>Güç puanı garanti değildir; ileri sonuç azsa risk yükseltilir.</p></details></td>
      <td><span class="odds-value">${Number(row.price).toFixed(2)}</span></td>
      <td><strong>${fmtNum(row.sample)}</strong></td>
      <td><span class="rate-pill">%${fmt(row.hit_pct)}</span></td>
      <td><strong>%${fmt(row.confidence)}</strong></td>
      <td><strong>${fmt(row.strength_score)}/100</strong><br><span class="selection-tag">${escapeHTML(row.risk_level || 'Yüksek')} risk</span></td>
    </tr>`).join("") : `<tr><td colspan="8" class="muted text-center p-2">Şu an en az 20 maç ve %60 gerçekleşme şartını sağlayan yaklaşan İddaa maçı yok.</td></tr>`;
  body.querySelectorAll('tr').forEach((tr, index) => {
    const row = rows[index];
    if (!row) return;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Dayanak maçlar ve risk kontrolü';
    const content = document.createElement('div');
    details.append(summary, content);
    let rendered = false;
    details.addEventListener('toggle', () => {
      if (details.open && !rendered) {
        content.innerHTML = recommendationHistoryHTML(row);
        rendered = true;
      }
    });
    tr.children[2].append(details);
  });
  const near = d?.near_misses || [];
  const consistencyBlocked=[...(d?.conflicting_recommendations_suppressed || []),...(d?.frozen_consistency_blocked || []),...(d?.preview_consistency_blocked || []),...(data.consistency_blocked || [])];
  if (consistencyBlocked.length) document.getElementById('recommendation-count').innerText += ` · Tutarlılık / sabit kayıt kontrolüyle gösterilmeyen: ${consistencyBlocked.length}`;
  document.getElementById('near-miss-count').textContent = `${near.length} aday`;
  document.getElementById('near-miss-body').innerHTML = near.length ? near.map(row => `<tr>
    <td><strong>${escapeHTML(row.match_name)}</strong><br><small>${escapeHTML(row.league)} · ${escapeHTML(liveTime(row.kickoff_at_utc))}</small></td>
    <td><strong>${escapeHTML(row.method)}</strong><br><small>${escapeHTML((row.legs || []).map(l => `${l.market} ${l.selection} ${Number(l.price).toFixed(2)}`).join(' + '))}</small></td>
    <td><strong>${escapeHTML(row.market)} · ${escapeHTML(row.selection)}</strong><br><span class="odds-value">${Number(row.price).toFixed(2)}</span></td>
    <td>${row.sample} geçmiş maç · %${fmt(row.hit_pct)}${row.sample < 20 ? '<br><strong>ZAYIF KANIT — küçük örnek, kazanma ihtimali değil</strong>' : ''}</td>
    <td>${escapeHTML(row.reason)}<br><small>Gerekli: en az ${row.required_sample} maç ve %${fmt(row.required_hit_pct)}</small></td>
  </tr>`).join('') : '<tr><td colspan="5">Güncel oranı doğrulanmış ve geçmiş eşleşmesi bulunan ön izleme adayı yok.</td></tr>';
}

let predictionHistoryLoading = false;
let movementAuditLoading = false;
let dailyMovementLoading = false;

async function loadDailyClosingMovements() {
  if (dailyMovementLoading) return;
  const dateInput = document.getElementById('daily-movement-date');
  const status = document.getElementById('daily-movement-status');
  const summary = document.getElementById('daily-movement-summary');
  const details = document.getElementById('daily-movement-details');
  if (!dateInput || !status || !summary || !details) return;
  if (!dateInput.value) dateInput.value = new Date().toLocaleDateString('sv-SE', {timeZone:'Europe/Istanbul'});
  dailyMovementLoading = true;
  status.textContent = 'Rapor hesaplanıyor…';
  try {
    const data = await getJSON('/api/analysis/daily-closing-movements?date=' + encodeURIComponent(dateInput.value));
    const money = value => new Intl.NumberFormat('tr-TR', {style:'currency',currency:'TRY',maximumFractionDigits:0}).format(Number(value || 0));
    summary.innerHTML = (data.groups || []).map(row => `<tr>
      <td>${escapeHTML(row.band)}</td><td>${escapeHTML(row.direction)}</td><td>${row.total}</td>
      <td>${row.won}</td><td>${row.lost}</td><td>${row.hit_pct == null ? '—' : '%' + row.hit_pct}</td>
      <td class="${Number(row.net_profit) >= 0 ? 'positive' : 'negative'}">${money(row.net_profit)}</td>
    </tr>`).join('');
    details.innerHTML = (data.rows || []).map(row => `<tr>
      <td><strong>${escapeHTML(row.match_name)}</strong><br><small>${escapeHTML(liveTime(row.kickoff_at_utc))}</small></td>
      <td>${escapeHTML(row.market)} · ${escapeHTML(row.selection)}</td>
      <td>${escapeHTML(row.band)} · ${escapeHTML(row.direction)}</td>
      <td>${Number(row.first_price).toFixed(2)} → ${Number(row.last_price).toFixed(2)}</td>
      <td>${Number(row.delta) > 0 ? '+' : ''}${Number(row.delta).toFixed(2)}</td>
      <td>${scorePairHTML(row.half_score, row.score)}</td><td>${row.outcome === 'won' ? 'Tuttu' : 'Tutmadı'}</td>
      <td class="${Number(row.net_profit) >= 0 ? 'positive' : 'negative'}">${money(row.net_profit)}</td>
    </tr>`).join('') || '<tr><td colspan="8">Bu tarihte koşulları sağlayan seçim yok.</td></tr>';
    document.getElementById('daily-movement-detail-title').textContent = `Tüm seçimleri göster (${data.total_selections})`;
    status.textContent = `${data.scope} Biten maç: ${data.finished_matches}; hareket bulunan maç: ${data.matches_with_signals}; toplam seçim: ${data.total_selections}. API tüm ${data.rows.length} kaydı döndürdü; 100 kayıt sınırı uygulanmadı.`;
  } catch (error) {
    status.textContent = 'Rapor yüklenemedi: ' + error.message;
    summary.innerHTML = '<tr><td colspan="7">Rapor alınamadı.</td></tr>';
    details.innerHTML = '';
  } finally {
    dailyMovementLoading = false;
  }
}

let reverseMovementLoading = false;
let flashscoreMovementLoading = false;

async function loadFlashscoreMovements() {
  if (flashscoreMovementLoading) return;
  const fromInput = document.getElementById('flashscore-date-from');
  const toInput = document.getElementById('flashscore-date-to');
  const status = document.getElementById('flashscore-movement-status');
  const exactBody = document.getElementById('flashscore-exact-rows');
  const segmentBody = document.getElementById('flashscore-segment-rows');
  if (!fromInput || !toInput || !status || !exactBody || !segmentBody) return;
  const today = new Date().toLocaleDateString('sv-SE', {timeZone:'Europe/Istanbul'});
  const monthAgo = new Date(Date.now() - 30 * 86400000).toLocaleDateString('sv-SE', {timeZone:'Europe/Istanbul'});
  if (!fromInput.value) fromInput.value = monthAgo;
  if (!toInput.value) toInput.value = today;
  flashscoreMovementLoading = true;
  status.textContent = 'Flashscore analizi hesaplaniyor...';
  const pct = value => value == null ? '-' : '%' + Number(value).toFixed(1);
  const money = value => new Intl.NumberFormat('tr-TR', {style:'currency',currency:'TRY',maximumFractionDigits:0}).format(Number(value || 0));
  const direction = value => value === 'yukseldi' ? 'Yukseldi' : 'Dustu';
  const evidence = value => value === 'izlenebilir' ? 'Izlenebilir' : value === 'on-inceleme' ? 'On inceleme' : 'Yetersiz';
  try {
    const url = `/api/analysis/flashscore-movements?date_from=${encodeURIComponent(fromInput.value)}&date_to=${encodeURIComponent(toInput.value)}`;
    const data = await getJSON(url);
    if (!data.available) {
      status.textContent = data.message || 'Flashscore verisi henuz yok.';
      exactBody.innerHTML = '<tr><td colspan="10">Veri yok.</td></tr>';
      segmentBody.innerHTML = '';
      return;
    }
    const exact = [...(data.exact_movements || [])].sort((a,b) => {
      const priority = x => (x.exact_delta === '0.18' || x.exact_delta === '0.28') ? 0 : 1;
      return priority(a) - priority(b) || Number(b.total) - Number(a.total) || Number(a.exact_delta) - Number(b.exact_delta);
    });
    exactBody.innerHTML = exact.slice(0, 60).map(row => `<tr><td><strong>${Number(row.exact_delta).toFixed(2)}</strong></td><td>${direction(row.direction)}</td><td>${row.total}</td><td>${row.won}</td><td>${pct(row.hit_pct)}</td><td>${pct(row.ci95_low)} - ${pct(row.ci95_high)}</td><td>${pct(row.market_implied_pct)}</td><td class="${Number(row.roi_pct) >= 0 ? 'positive' : 'negative'}">${pct(row.roi_pct)}</td><td>${row.days}</td><td>${evidence(row.reliability)}</td></tr>`).join('') || '<tr><td colspan="10">Uygun hareket yok.</td></tr>';
    segmentBody.innerHTML = (data.segments || []).slice(0, 60).map(row => `<tr><td>${escapeHTML(row.delta_band)}</td><td>${direction(row.direction)}</td><td>${escapeHTML(row.opening_band)}</td><td>${row.total}</td><td>${pct(row.hit_pct)}</td><td>${pct(row.shrunk_hit_pct)}</td><td>${pct(row.ci95_low)} - ${pct(row.ci95_high)}</td><td>${money(row.net_profit)}</td><td class="${Number(row.roi_pct) >= 0 ? 'positive' : 'negative'}">${pct(row.roi_pct)}</td><td>${row.days} (${row.positive_days} pozitif)</td><td>${evidence(row.reliability)}</td></tr>`).join('') || '<tr><td colspan="11">Kirilim yok.</td></tr>';
    const o = data.overall || {};
    status.textContent = `${data.bookmaker} ${data.market}: ${data.total} sonuclanmis secim, ${data.date_count} farkli gun. Genel basari ${pct(o.hit_pct)}, %95 aralik ${pct(o.ci95_low)}-${pct(o.ci95_high)}, piyasa beklentisi ${pct(o.market_implied_pct)}, ROI ${pct(o.roi_pct)}. ${data.research_status === 'collecting' ? 'Henuz veri biriktirme ve arastirma asamasinda; otomatik oneri degil.' : 'Yeterli gun birikti; kararlilik incelemesine uygun.'}`;
  } catch (error) {
    status.textContent = 'Flashscore analizi yuklenemedi: ' + error.message;
    exactBody.innerHTML = '<tr><td colspan="10">Rapor alinamadi.</td></tr>';
    segmentBody.innerHTML = '';
  } finally {
    flashscoreMovementLoading = false;
  }
}

async function loadReverseMovements() {
  if (reverseMovementLoading) return;
  const fromInput = document.getElementById('reverse-date-from');
  const toInput = document.getElementById('reverse-date-to');
  const status = document.getElementById('reverse-movement-status');
  const body = document.getElementById('reverse-movement-rows');
  const allBody = document.getElementById('reverse-movement-all-rows');
  if (!fromInput || !toInput || !status || !body || !allBody) return;
  const today = new Date().toLocaleDateString('sv-SE', {timeZone:'Europe/Istanbul'});
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', {timeZone:'Europe/Istanbul'});
  const dayBefore = new Date(Date.now() - 172800000).toLocaleDateString('sv-SE', {timeZone:'Europe/Istanbul'});
  if (!fromInput.value) fromInput.value = dayBefore;
  if (!toInput.value) toInput.value = yesterday;
  reverseMovementLoading = true;
  status.textContent = 'Ters oran testi hesaplanıyor…';
  const money = value => new Intl.NumberFormat('tr-TR', {style:'currency',currency:'TRY',maximumFractionDigits:0}).format(Number(value || 0));
  const rowHTML = row => `<tr><td><strong>${escapeHTML(row.match_name)}</strong><br><small>${escapeHTML(row.date)}</small></td><td>${escapeHTML(row.market)} · ${escapeHTML(row.rising_selection)}<br>${Number(row.rising_first_price).toFixed(2)} → ${Number(row.rising_last_price).toFixed(2)}</td><td><strong>${escapeHTML(row.opposite_selection)}</strong><br>${row.opposite_first_price == null ? '—' : Number(row.opposite_first_price).toFixed(2)} → ${Number(row.opposite_last_price).toFixed(2)}</td><td>${scorePairHTML(row.half_score, row.score)}</td><td>${row.outcome === 'won' ? 'Tuttu' : 'Tutmadı'}</td><td>${money(row.net_profit)}</td></tr>`;
  try {
    const url = `/api/analysis/reverse-movements?date_from=${encodeURIComponent(fromInput.value)}&date_to=${encodeURIComponent(toInput.value)}`;
    const data = await getJSON(url);
    body.innerHTML = (data.rows || []).map(rowHTML).join('') || '<tr><td colspan="6">Karşı oranı en az 1,40 olan uygun sinyal yok.</td></tr>';
    allBody.innerHTML = (data.all_paired_rows || []).map(row => `<tr><td>${escapeHTML(row.match_name)}</td><td>${escapeHTML(row.market)} · ${escapeHTML(row.rising_selection)} ${Number(row.rising_first_price).toFixed(2)} → ${Number(row.rising_last_price).toFixed(2)}</td><td>${escapeHTML(row.opposite_selection)} · ${Number(row.opposite_last_price).toFixed(2)}</td><td>${row.eligible ? 'Uygun' : '1,40 altı'}</td><td>${row.outcome === 'won' ? 'Tuttu' : 'Tutmadı'}</td></tr>`).join('') || '<tr><td colspan="5">Eşleşme yok.</td></tr>';
    status.textContent = `${data.scope} Ham yükselen sinyal: ${data.raw_rising_signals}; gerçek karşı oranı bulunan: ${data.paired_signals}; 1,40+ uygun: ${data.eligible_signals}. Sonuç: ${data.won} tuttu / ${data.lost} tutmadı · Başarı ${data.hit_pct == null ? '—' : '%' + data.hit_pct} · Net ${money(data.net_profit)} · ROI ${data.roi_pct == null ? '—' : '%' + data.roi_pct}.`;
  } catch (error) {
    status.textContent = 'Ters oran testi yüklenemedi: ' + error.message;
    body.innerHTML = '<tr><td colspan="6">Rapor alınamadı.</td></tr>';
    allBody.innerHTML = '';
  } finally {
    reverseMovementLoading = false;
  }
}

async function loadOddsMovementAudit() {
  const panel = document.getElementById('prediction-odds-movement-audit');
  if (!panel || movementAuditLoading || panel.dataset.loaded === '1') return;
  movementAuditLoading = true;
  try {
    const data = await getJSON('/api/analysis/odds-movement?threshold=0.15');
    const stats = (data.overall || []).map(row => `<tr><td>${escapeHTML(row.direction)}</td><td>${row.total}</td><td>${row.won}</td><td>${row.lost}</td><td>${row.missing}</td><td>${row.hit_pct == null ? '—' : '%' + row.hit_pct}</td><td>${row.average_delta ?? '—'}</td></tr>`).join('');
    const markets = (data.by_market || []).slice(0, 40).map(row => `<tr><td>${escapeHTML(row.direction)}</td><td>${escapeHTML(row.market)} · ${escapeHTML(row.selection)}</td><td>${row.settled}</td><td>${row.won}</td><td>${row.lost}</td><td>${row.hit_pct == null ? '—' : '%' + row.hit_pct}</td><td>${row.average_delta ?? '—'}</td></tr>`).join('');
    const examples = (data.examples || []).slice(-60).reverse().map(row => `<tr><td>${escapeHTML(row.date || '—')}</td><td>${escapeHTML(row.match_name)}</td><td>${escapeHTML(row.market)} · ${escapeHTML(row.selection)}</td><td>${escapeHTML(row.direction)}</td><td>${row.first_price} → ${row.last_price}</td><td>${row.delta > 0 ? '+' : ''}${row.delta}</td><td>${scorePairHTML(row.half_score, row.score)}</td><td>${row.outcome === 'won' ? 'Tuttu' : row.outcome === 'lost' ? 'Tutmadı' : 'Eksik'}</td></tr>`).join('');
    panel.innerHTML = `<h3>±0,15 oran hareketi ve sonuç denetimi</h3><p class="muted">${escapeHTML(data.scope || '')} Toplam hareketli seçim: ${data.total_moved || 0}. Fark, ilk ve son maç öncesi kayıtlı oran arasındadır; bu tablo öneri değildir.</p><div class="table-responsive"><table class="data-table"><thead><tr><th>Hareket</th><th>Seçim</th><th>Toplam</th><th>Tuttu</th><th>Tutmadı</th><th>Eksik</th><th>Tutma %</th><th>Ort. fark</th></tr></thead><tbody>${stats || '<tr><td colspan="8">±0,15 üzerinde hareket bulunamadı.</td></tr>'}</tbody></table></div><details><summary>Market/seçim kırılımı</summary><div class="table-responsive"><table class="data-table"><thead><tr><th>Hareket</th><th>Market / seçim</th><th>Sonuçlanan</th><th>Tuttu</th><th>Tutmadı</th><th>Tutma %</th><th>Ort. fark</th></tr></thead><tbody>${markets || '<tr><td colspan="7">Kırılım yok.</td></tr>'}</tbody></table></div></details><details><summary>Son hareketli maç örnekleri</summary><div class="table-responsive"><table class="data-table"><thead><tr><th>Tarih</th><th>Maç</th><th>Market / seçim</th><th>Hareket</th><th>İlk → son</th><th>Fark</th><th>İY / MS</th><th>Sonuç</th></tr></thead><tbody>${examples || '<tr><td colspan="8">Örnek yok.</td></tr>'}</tbody></table></div></details>`;
    const final15 = data.final_15m || {};
    const final15Rows = (final15.overall || []).map(row => '<tr><td>' + escapeHTML(row.direction || '') + '</td><td>' + (row.total || 0) + '</td><td>' + (row.won || 0) + '</td><td>' + (row.lost || 0) + '</td><td>' + (row.hit_pct == null ? '—' : '%' + row.hit_pct) + '</td><td>' + (row.average_delta == null ? '—' : row.average_delta) + '</td></tr>').join('');
    const final15Wf = (final15.strategy || {}).walk_forward || {};
    const final15Panel = document.createElement('div');
    final15Panel.className = 'movement-final15-panel';
    final15Panel.innerHTML = '<h3>Maçtan önceki son 15 dakikadaki hareket</h3><p class="muted">' + escapeHTML(final15.scope || 'Son oran kaydı başlangıçtan en fazla 15 dakika önce olan seçimler.') + ' Toplam hareketli seçim: ' + (final15.total_moved || 0) + '. Bu, bahis miktarı değil; son oran hareketi üzerinden dolaylı bir göstergedir.</p><div class="table-responsive"><table class="data-table"><thead><tr><th>Hareket</th><th>Toplam</th><th>Tuttu</th><th>Tutmadı</th><th>Tutma %</th><th>Ort. fark</th></tr></thead><tbody>' + (final15Rows || '<tr><td colspan="6">Son 15 dakikaya ait yeterli hareketli seçim yok.</td></tr>') + '</tbody></table></div><p><strong>Walk-forward:</strong> ' + (final15Wf.signals || 0) + ' sinyal · ' + (final15Wf.won || 0) + ' tuttu · ' + (final15Wf.lost || 0) + ' tutmadı · Tutma ' + (final15Wf.hit_pct == null ? '—' : '%' + final15Wf.hit_pct) + ' · Net ' + (final15Wf.net_profit == null ? '—' : Number(final15Wf.net_profit).toLocaleString('tr-TR') + ' TL') + ' · ROI ' + (final15Wf.roi_pct == null ? '—' : '%' + final15Wf.roi_pct) + '</p><p class="muted">En az 30 geçmiş sonuç şartı vardır; pozitif görünse bile otomatik öneriye henüz bağlanmaz.</p>';
    panel.append(final15Panel);
    const playableRows = (final15.playable_overall || []).map(row => '<tr><td>' + escapeHTML(row.direction || '') + '</td><td>' + (row.total || 0) + '</td><td>' + (row.won || 0) + '</td><td>' + (row.lost || 0) + '</td><td>' + (row.hit_pct == null ? '—' : '%' + row.hit_pct) + '</td><td>' + (row.net_profit == null ? '—' : Number(row.net_profit).toLocaleString('tr-TR') + ' TL') + '</td><td>' + (row.roi_pct == null ? '—' : '%' + row.roi_pct) + '</td></tr>').join('');
    const playableBands = (final15.price_bands || []).map(row => '<tr><td>' + escapeHTML(row.band || '') + '</td><td>' + escapeHTML(row.direction || '') + '</td><td>' + (row.settled || 0) + '</td><td>' + (row.won || 0) + '</td><td>' + (row.lost || 0) + '</td><td>' + (row.hit_pct == null ? '—' : '%' + row.hit_pct) + '</td><td>' + (row.net_profit == null ? '—' : Number(row.net_profit).toLocaleString('tr-TR') + ' TL') + '</td><td>' + (row.roi_pct == null ? '—' : '%' + row.roi_pct) + '</td></tr>').join('');
    const playablePanel = document.createElement('div');
    playablePanel.className = 'movement-playable15-panel';
    playablePanel.innerHTML = '<h4>1,40+ oynanabilir oranlarda son 15 dakika</h4><p class="muted">Bu kırılım 1,40 altı seçimleri dışlar; bahis hacmi ölçümü değildir.</p><div class="table-responsive"><table class="data-table"><thead><tr><th>Hareket</th><th>Toplam</th><th>Tuttu</th><th>Tutmadı</th><th>Tutma %</th><th>Net</th><th>ROI</th></tr></thead><tbody>' + (playableRows || '<tr><td colspan="7">Yeterli veri yok.</td></tr>') + '</tbody></table></div><details><summary>Oran bandı kırılımı</summary><div class="table-responsive"><table class="data-table"><thead><tr><th>Oran bandı</th><th>Hareket</th><th>Sonuçlanan</th><th>Tuttu</th><th>Tutmadı</th><th>Tutma %</th><th>Net</th><th>ROI</th></tr></thead><tbody>' + (playableBands || '<tr><td colspan="8">Oran bandı verisi yok.</td></tr>') + '</tbody></table></div></details>';
    panel.append(playablePanel);
    const strategy = data.strategy || {};
    const wf = strategy.walk_forward || {};
    const fmtTL = value => value == null ? '\u2014' : Number(value).toLocaleString('tr-TR') + ' TL';
    const candidates = (strategy.candidates || []).slice(0, 30).map(row => {
      const forward = row.forward || {};
      return `<tr><td>${escapeHTML(row.market_key || '')}</td><td>${escapeHTML(row.selection || '')}</td><td>${escapeHTML(row.direction || '')}</td><td>${row.training_signals || 0}</td><td>${row.training_hit_pct == null ? '\u2014' : '%' + row.training_hit_pct}</td><td>${forward.settled || 0}</td><td>${forward.hit_pct == null ? '\u2014' : '%' + forward.hit_pct}</td><td>${fmtTL(forward.net_profit)}</td><td>${forward.net_profit > 0 ? 'Pozitif' : 'Negatif'}</td></tr>`;
    }).join('');
    const strategyPanel = document.createElement('div');
    strategyPanel.className = 'movement-strategy-panel';
    strategyPanel.innerHTML = `<h3>Walk-forward oran hareketi filtresi</h3><p class="muted">Minimum ${strategy.min_sample || 30} gecmis sonucu ve 1.000 TL simulasyon. Her sinyal yalnizca kendisinden onceki sonuclarla uygunluk kazandi; gelecek verisi egitime sizmadi.</p><p><strong>Toplam sinyal:</strong> ${wf.signals || 0} - <strong>Tuttu:</strong> ${wf.won || 0} - <strong>Yatmadi:</strong> ${wf.lost || 0} - <strong>Tutma:</strong> ${wf.hit_pct == null ? '\u2014' : '%' + wf.hit_pct} - <strong>Net:</strong> ${fmtTL(wf.net_profit)} - <strong>ROI:</strong> ${wf.roi_pct == null ? '\u2014' : '%' + wf.roi_pct}</p><p class="muted">Pozitif egitim gecmisi olan kaliplar aday olarak listelenir; gelecek performansi ayrica gosterilir ve otomatik tavsiyeye henuz eklenmez.</p><div class="table-responsive"><table class="data-table"><thead><tr><th>Market anahtari</th><th>Secim</th><th>Hareket</th><th>Egitim n</th><th>Egitim %</th><th>Gelecek n</th><th>Gelecek %</th><th>Gelecek net</th><th>Durum</th></tr></thead><tbody>${candidates || '<tr><td colspan="9">Minimum ornek ve pozitif egitim sonucu kosulunu saglayan kalip yok.</td></tbody>'}</table></div>`;
    const marketRows = (data.by_market_type || []).slice(0, 60).map(row => {
      const net = row.net_profit == null ? '\u2014' : Number(row.net_profit).toLocaleString('tr-TR') + ' TL';
      return '<tr><td>' + escapeHTML(row.market_key || '') + '</td><td>' + escapeHTML(row.market || '') + '</td><td>' + escapeHTML(row.direction || '') + '</td><td>' + (row.settled || 0) + '</td><td>' + (row.won || 0) + '</td><td>' + (row.lost || 0) + '</td><td>' + (row.hit_pct == null ? '\u2014' : '%' + row.hit_pct) + '</td><td>' + net + '</td><td>' + (row.roi_pct == null ? '\u2014' : '%' + row.roi_pct) + '</td></tr>';
    }).join('');
    const marketPanel = document.createElement('div');
    marketPanel.className = 'movement-market-panel';
    marketPanel.innerHTML = '<h3>Market bazli oran hareketi</h3><p class="muted">Ilk kayit ile son mac onu kaydi arasindaki hareket; her market ve yon ayri hesaplanir.</p><div class="table-responsive"><table class="data-table"><thead><tr><th>Market anahtari</th><th>Market</th><th>Hareket</th><th>Sonuclanan</th><th>Tuttu</th><th>Tutmadi</th><th>Tutma %</th><th>Net</th><th>ROI</th></tr></thead><tbody>' + (marketRows || '<tr><td colspan="9">Market bazli veri yok.</td></tr>') + '</tbody></table></div>';
    panel.append(marketPanel);
    const conditional = data.conditional_ms_x_to_dc_1_2 || {};
    const conditionalRows = (conditional.by_direction || []).map(row => {
      const net = row.net_profit == null ? '—' : Number(row.net_profit).toLocaleString('tr-TR') + ' TL';
      const roi = row.roi_pct == null ? '—' : '%' + row.roi_pct;
      return '<tr><td>' + escapeHTML(row.direction || '') + '</td><td>' + (row.eligible_matches || 0) + ' / ' + (row.raw_signal_matches || 0) + '</td><td>' + (row.won || 0) + '</td><td>' + (row.lost || 0) + '</td><td>' + (row.hit_pct == null ? '—' : '%' + row.hit_pct) + '</td><td>' + (row.excluded_below_min || 0) + ' / ' + (row.missing_target_odds || 0) + '</td><td>' + net + '</td><td>' + roi + '</td></tr>';
    }).join('');
    const leagueRows = (conditional.by_league || []).slice(0, 40).map(row => {
      const net = row.net_profit == null ? '—' : Number(row.net_profit).toLocaleString('tr-TR') + ' TL';
      return '<tr><td>' + escapeHTML(row.league || row.league_id || '') + '</td><td>' + escapeHTML(row.direction || '') + '</td><td>' + (row.settled || 0) + '</td><td>' + (row.won || 0) + '</td><td>' + (row.lost || 0) + '</td><td>' + (row.hit_pct == null ? '—' : '%' + row.hit_pct) + '</td><td>' + net + '</td><td>' + (row.roi_pct == null ? '—' : '%' + row.roi_pct) + '</td></tr>';
    }).join('');
    const conditionalWf = conditional.walk_forward || {};
    const conditionalWfNet = conditionalWf.net_profit == null ? '—' : Number(wf.net_profit).toLocaleString('tr-TR') + ' TL';
    const conditionalPanel = document.createElement('div');
    conditionalPanel.className = 'movement-conditional-panel';
    conditionalPanel.innerHTML = '<h3>MS X hareketi → Çifte Şans 1-2</h3><p class="muted">Hedef oran alt sınırı: <strong>' + (conditional.minimum_target_price || 1.40).toFixed(2) + '</strong>. Koşul: Maç Sonucu X oranının ilk ve son maç önü kaydı arasında ±0,15 üzeri hareket. ÇŞ 1-2 için beraberlik kayıp sayılır; maçlar tekilleştirilmiştir.</p><div class="table-responsive"><table class="data-table"><thead><tr><th>MS X hareketi</th><th>Uygun / ham maç</th><th>Tuttu</th><th>Tutmadı</th><th>Tutma %</th><th>Düşük oran / eksik</th><th>Net</th><th>ROI</th></tr></thead><tbody>' + (conditionalRows || '<tr><td colspan="8">Bu koşul için veri yok.</td></tr>') + '</tbody></table></div><p class="muted">Uygun maç: ' + (conditional.eligible_matches || 0) + ' · 1,40 altı dışlanan: ' + (conditional.excluded_below_min || 0) + ' · Hedef oranı eksik: ' + (conditional.missing_target_odds || 0) + '</p><details><summary>Lig kırılımı</summary><div class="table-responsive"><table class="data-table"><thead><tr><th>Lig</th><th>Hareket</th><th>Sonuçlanan</th><th>Tuttu</th><th>Tutmadı</th><th>Tutma %</th><th>Net</th><th>ROI</th></tr></thead><tbody>' + (leagueRows || '<tr><td colspan="8">Lig kırılımı yok.</td></tr>') + '</tbody></table></div></details><details><summary>Walk-forward sonucu</summary><p>Minimum geçmiş örnek: ' + (conditionalWf.min_sample || conditional.min_sample || 30) + ' · Geleceğe açılan sinyal: ' + (conditionalWf.signals || 0) + ' · Tuttu: ' + (conditionalWf.won || 0) + ' · Tutmadı: ' + (conditionalWf.lost || 0) + ' · Tutma: ' + (conditionalWf.hit_pct == null ? '—' : '%' + conditionalWf.hit_pct) + ' · Net: ' + conditionalWfNet + ' · Aday grup: ' + (conditionalWf.candidate_groups || 0) + '</p><p class="muted">Walk-forward geçmişteki önceki sonuçlarla uygunluk arar; aynı veriyi hem öğrenme hem ölçüm için kullanmaz.</p></details>';
    panel.append(conditionalPanel);
    panel.append(strategyPanel);
    panel.dataset.loaded = '1';
  } catch (error) {
    panel.innerHTML = `<p class="muted">Oran hareketi denetimi yüklenemedi: ${escapeHTML(error.message)}</p>`;
  } finally { movementAuditLoading = false; }
}
async function loadExperiments() {
  let panel = document.getElementById('prediction-experiments');
  if (!panel) {
    panel = document.createElement('div'); panel.id = 'prediction-experiments';
    document.getElementById('prediction-status').before(panel);
  }
  const money = v => v == null ? '—' : Number(v).toLocaleString('tr-TR') + ' TL';
  const track = t => t === 'normal' ? 'Normal sistem' : 'Sürpriz denemesi';
  const status = {won:'Tuttu',lost:'Tutmadı',pending:'Bekliyor',missing:'Eksik skor',void:'İade',excluded:'Geç kayıt; hesap dışı'};
  try {
    const data = await getJSON('/api/predictions/experiments');
    panel.innerHTML = `<h3>Tahmin Denemeleri — ${escapeHTML(data.day || '')}</h3><p>Her seçim ayrı 1.000 TL simülasyonudur; gerçek bahis değildir. İlk seçim ve oran sabittir. Bu kayıtlar normal başarı günlüğüne tekrar eklenmez. Gruplar aynı maçları içerebilir; bağımsız kazançlar değildir.</p>` +
      data.summaries.map(s => `<p><strong>${track(s.track)}</strong>: ${s.won} tuttu / ${s.lost} tutmadı / ${s.pending} bekliyor / ${s.missing} eksik / ${s.void} iade · Sonuçlanan tutar: ${money(s.settled_stake)} · Bekleyen: ${money(s.pending_stake)} · Geri dönüş: ${money(s.gross_return)} · Net: ${money(s.net_profit)}</p>`).join('') +
      `<div class="table-responsive"><table class="data-table"><thead><tr><th>Maç / yöntem</th><th>Seçim</th><th>Sabit oran</th><th>Örnek</th><th>Kayıt zamanı</th><th>Sonuç</th><th>Geri dönüş</th><th>Net K/Z</th></tr></thead><tbody>${data.rows.map(p => `<tr><td>${escapeHTML(p.match_name)}<br>${track(p.track)} / ${escapeHTML(p.method)}</td><td>${escapeHTML(p.market)} · ${escapeHTML(p.selection)}</td><td>${p.price}</td><td>${p.sample}</td><td>${escapeHTML(liveTime(p.registered_at))}<br><small>${p.linked_journal_id ? 'Mevcut günlük kaydı: ' + p.linked_journal_id + ' · ' + escapeHTML(liveTime(p.original_journal_time)) : 'Ayrı deneme kaydı; geçmiş tarih verilmedi'}</small></td><td>${status[p.outcome]}</td><td>${money(p.gross_return)}</td><td>${money(p.net_profit)}</td></tr>`).join('')}</tbody></table></div>`;
    const quoteText = q => q ? `${Number(q.price).toFixed(2)}<br><small>Kayıt: ${escapeHTML(liveTime(q.captured_at))}<br>Kontrol: ${escapeHTML(liveTime(q.checked_at))}</small>` : 'Kayıt yok';
    const header = panel.querySelector('thead tr');
    ['Son kaydedilen oran', 'Son maç öncesi kayıt', 'Gerçek ölçüm hareketi'].forEach(label => {
      const th = document.createElement('th'); th.textContent = label; header.append(th);
    });
    panel.querySelectorAll('tbody tr').forEach((row, i) => {
      const t = data.rows[i].odds_tracking || {};
      const movement = t.status === 'ambiguous' ? 'Birden fazla oran serisi; eşleştirme belirsiz' :
        t.change == null ? 'Hareket verisi yok' :
        `${t.change > 0 ? 'Yükseldi +' : t.change < 0 ? 'Düştü ' : 'Değişmedi '}${Number(t.change).toFixed(2)}<br><small>${Number(t.measurements)} kayıt · İlk ölçüm: ${quoteText(t.first)}</small>`;
      [quoteText(t.latest), quoteText(t.prematch), movement].forEach(html => {
        const td = document.createElement('td'); td.innerHTML = html; row.append(td);
      });
    });
    const note = document.createElement('p');
    note.textContent = 'Hareket, aynı marketin ilk ve son gerçek ölçümü arasındadır; sabit tahmin oranı ve kazanç hesabı değişmez. Tek ölçüm hareket sayılmaz. Son kayıt güncel oran garantisi değildir. Maç öncesi kayıt, sağlayıcının kesin kapanış oranı değildir; maç başlayana kadar değişebilir. Kontrol zamanı oran değişmeden yapılan doğrulamayı da gösterebilir.';
    panel.append(note);
  } catch (error) { panel.textContent = 'Tahmin Denemeleri yüklenemedi: ' + error.message; }
}
async function loadPredictionHistory() {
  if (predictionHistoryLoading) return;
  predictionHistoryLoading = true;
  loadExperiments();
  const sources = {main: 'Eski gün bazlı ana öneri', alternatives: 'Eski gün bazlı alternatif', 'main-v3-1li':'Resmî tekli', 'main-v3-2li':'Resmî ikili', 'main-v3-3li':'Resmî üçlü', 'preview-v3-1li':'Ön izleme tekli', 'preview-v3-2li':'Ön izleme ikili', 'preview-v3-3li':'Ön izleme üçlü', 'alternatives-v3':'V3 maç alternatifi'};
  const outcomes = {won: 'Tuttu', lost: 'Tutmadı', pending: 'Bekliyor', missing: 'Eksik skor', void: 'İptal / değerlendirme dışı'};
  const money = value => value == null ? '—' : new Intl.NumberFormat('tr-TR', {style:'currency',currency:'TRY',maximumFractionDigits:0}).format(value);
  const track = value => value === 'preview' ? 'Ön izleme' : value === 'alternatives' ? 'Alternatif' : 'Resmî';
  try {
    const windowDays = document.getElementById('prediction-window')?.value || '';
    const data = await getJSON('/api/predictions/history' + (windowDays ? `?days=${windowDays}` : ''));
    const state = data.collector || {};
    void loadOddsMovementAudit();
    const trackSelect = document.getElementById('prediction-track-filter');
    const trackFilter = trackSelect?.value || 'official';
    const sourceTrack = source => source?.startsWith('preview-') ? 'preview' : source?.startsWith('alternatives-') ? 'alternatives' : 'official';
    const visible = rows => (rows || []).filter(row => trackFilter === 'all' || row.track === trackFilter);
    const visibleSources = rows => (rows || []).filter(row => trackFilter === 'all' || sourceTrack(row.source) === trackFilter);
    if (trackSelect) trackSelect.onchange = () => loadPredictionHistory();
    let auditPanel = document.getElementById('prediction-percentage-audit');
    if (!auditPanel) {
      auditPanel = document.createElement('div'); auditPanel.id = 'prediction-percentage-audit';
      document.getElementById('prediction-common-pool').before(auditPanel);
    }
    const audit = data.percentage_audit || {rows:[]};
    const dailyOfficial = Object.values((data.days || []).filter(d => sourceTrack(d.source) === 'official').reduce((acc, d) => {
      const row = acc[d.day] || (acc[d.day] = {day:d.day,total:0,won:0,lost:0,pending:0,missing:0,void:0,net_profit:0,settled_stake:0,stake_total:0});
      for (const key of ['total','won','lost','pending','missing','void']) row[key] += Number(d[key] || 0);
      row.net_profit += Number(d.net_profit || 0); row.settled_stake += Number(d.settled_stake || 0); row.stake_total += Number(d.stake_total || 0);
      return acc;
    }, {})).sort((a,b) => b.day.localeCompare(a.day));
    document.getElementById('prediction-official-daily-card').innerHTML = `<h3>Resmî tahminlerin günlük sonucu</h3><p class="muted">Bu kart yalnızca resmî kayıtları toplar; ön izleme ve alternatifler dahil değildir.</p><div class="table-responsive"><table class="data-table"><thead><tr><th>Gün</th><th>Toplam bahis</th><th>Tuttu</th><th>Yattı</th><th>Bekleyen</th><th>Sonuçlanan tutar</th><th>Net K/Z</th><th>ROI</th></tr></thead><tbody>${dailyOfficial.length ? dailyOfficial.map(d => `<tr><td>${escapeHTML(d.day)}</td><td>${d.total}</td><td>${d.won}</td><td>${d.lost}</td><td>${d.pending + d.missing}</td><td>${money(d.settled_stake)}</td><td><strong>${money(d.net_profit)}</strong></td><td>${d.settled_stake ? '%' + (100*d.net_profit/d.settled_stake).toFixed(1) : '—'}</td></tr>`).join('') : '<tr><td colspan="8">Henüz resmî sonuç yok.</td></tr>'}</tbody></table></div>`;
    auditPanel.innerHTML = `<h3>Kaydedilen yüzde / gerçekleşen başarı</h3><p>${escapeHTML(audit.note || '')}</p><p>Seçilen rapor dönemi geçerlidir. Yüzdesi eksik/geçersiz olduğu için dışarıda: ${audit.excluded_missing_percentage || 0}. Her sonuçlanan seçime 1.000 TL simülasyonu.</p><div class="table-responsive"><table class="data-table"><thead><tr><th>Takip / yöntem</th><th>Kayıtlı yüzde aralığı</th><th>Toplam / sonuçlanan</th><th>Tuttu / tutmadı</th><th>Bekleyen / eksik / iptal</th><th>Kayıtlı ortalama %</th><th>Gerçekleşen %</th><th>Fark (yüzde puan)</th><th>Yatırılan</th><th>Geri dönüş</th><th>Net K/Z</th><th>ROI</th><th>Veri durumu</th></tr></thead><tbody>${visible(audit.rows).map(a => `<tr><td>${track(a.track)} / ${escapeHTML(a.method)}</td><td>${escapeHTML(a.band)}</td><td>${a.total} / ${a.settled}<br>${a.settled_matches} farklı sonuçlanmış maç</td><td>${a.won} / ${a.lost}</td><td>${a.pending} / ${a.missing} / ${a.void}</td><td>${a.recorded_pct ?? '—'}</td><td>${a.realized_pct ?? '—'}</td><td>${a.gap_points ?? '—'}</td><td>${money(a.stake_total)}</td><td>${money(a.gross_return)}</td><td>${money(a.net_profit)}</td><td>${a.roi_pct == null ? '—' : '%' + a.roi_pct}</td><td>${escapeHTML(a.sample_note)}</td></tr>`).join('') || '<tr><td colspan="13">Kayıtlı yüzdesi bulunan tahmin bekleniyor.</td></tr>'}</tbody></table></div>`;
    let readinessPanel = document.getElementById('prematch-readiness');
    if (!readinessPanel) {
      readinessPanel = document.createElement('div'); readinessPanel.id = 'prematch-readiness';
      document.getElementById('prediction-status').before(readinessPanel);
    }
    const ready = data.readiness || {counts:{},matches:[]};
    const rc = ready.counts;
    readinessPanel.innerHTML = `<h3>Maç öncesi kayıt hazırlığı</h3><p>${escapeHTML(ready.scope || '')}</p><p>Yaklaşan: ${rc.upcoming || 0} · Oranı güncel: ${rc.ready || 0} · Oranı eksik: ${rc.missing || 0} · Oranı eski/doğrulanamayan: ${rc.stale || 0} · Resmî tahmini kayıtlı: ${rc.prediction_saved || 0} · Son 24 saatte tahminsiz başlayan: ${rc.missed_record || 0}</p><details><summary>Maç bazında hazırlık ve eksikler</summary><div class="table-responsive"><table class="data-table"><thead><tr><th>Maç</th><th>Başlama</th><th>Resmî tahmin</th><th>Açıklama</th></tr></thead><tbody>${ready.matches.map(m => `<tr><td>${escapeHTML(m.match_name)}</td><td>${escapeHTML(liveTime(m.kickoff_at))}</td><td>${m.prediction_saved ? 'Kayıtlı' : 'Kayıt yok'}</td><td>${escapeHTML(m.message)}</td></tr>`).join('')}</tbody></table></div></details>`;
    const auditNote = document.createElement('p');
    auditNote.className = 'muted';
    auditNote.textContent = `Son kayıt denetimi: ${ready.audit_at ? liveTime(ready.audit_at) : 'Henüz tamamlanmadı'} · Sonraki kontrol: ${state.next_check_at ? liveTime(state.next_check_at) : 'Hazırlanıyor'} · Teknik kayıt hatası: ${(state.record_errors || []).length}. Teknik hatada en fazla 3 kısa yeniden deneme (1 dk), ardından normal 5 dk döngüsü. Maç başladıktan sonra yeni kayıt oluşturulmaz.`;
    readinessPanel.append(auditNote);
    let performanceSummary = document.getElementById('prediction-performance-summary');
    if (!performanceSummary) {
      performanceSummary = document.createElement('div');
      performanceSummary.id = 'prediction-performance-summary';
      document.getElementById('prediction-status').after(performanceSummary);
    }
    performanceSummary.innerHTML = visible(data.summaries).map(s => `<p><strong>${track(s.track)}</strong>: ${s.won} tuttu / ${s.lost} tutmadı · ${s.pending} bekliyor · ${s.missing} eksik skor · ${s.void} iptal. Net: <strong>${money(s.net_profit)}</strong> · Getiri: ${s.roi_pct == null ? '—' : '%' + s.roi_pct} · Sonuçlanan bahis: ${money(s.settled_stake)} · Bekleyen tutar: ${money(s.pending_stake)}</p>`).join('') + `<p class="muted">Her kayıt için 1.000 TL ile hesaplanan simülasyon; gerçek bahis hesabı değildir. Tekli/ikili/üçlü, analizde kullanılan oran sayısıdır. Aynı maç farklı yöntemlerde yer alabilir; yöntemleri bağımsız kazançlar gibi toplamayın. Maç öncesi kaydı doğrulanamayan ${Number(data.excluded_records || 0)} kayıt hesap dışında.</p>`;
    document.getElementById('prediction-status').textContent = state.error ? `Otomatik takip hatası: ${state.error}` :
      state.running || state.building ? 'Yeni tahminler ve maç öncesi geçmiş arka planda hazırlanıyor. Kayıtlı sonuçlar aşağıda.' :
      `Panel sunucusu açıkken her 5 dakikada kontrol edilir. Son tamamlanan kontrol: ${state.last_completed_at ? new Date(state.last_completed_at).toLocaleString('tr-TR', {timeZone:'Europe/Istanbul'}) : 'Henüz tamamlanmadı'}`;
    document.getElementById('prediction-days').innerHTML = visibleSources(data.days).length ? visibleSources(data.days).map(d =>
      `<tr><td>${escapeHTML(d.day)}</td><td>${sources[d.source] || escapeHTML(d.source)}</td><td>${d.total}</td><td>${d.won}</td><td>${d.lost}</td><td>${d.pending}</td><td>${d.missing}</td><td>${d.void}</td><td>${d.hit_pct == null ? '—' : '%' + d.hit_pct}</td><td>${money(d.net_profit)}</td><td>${d.roi_pct == null ? '—' : '%' + d.roi_pct}</td><td>${money(d.stake_total)}</td><td>${money(d.gross_return)}</td><td>${money(d.pending_stake)}</td></tr>`).join('') :
      '<tr><td colspan="14">Henüz maç öncesinde kaydedilmiş uygun tahmin yok. Geçmiş başarı uydurulmaz.</td></tr>';
    document.getElementById('prediction-common-pool').innerHTML = visible(data.common_pool).map(c => `<h4>${track(c.track)} — aynı maçlarda karşılaştırma</h4>
      <p>${c.eligible_matches} kayıtlı maçtan ${c.common_matches} ortak maç (kapsama: ${c.coverage_pct == null ? '—' : '%' + c.coverage_pct}). Üç yöntemi de sonuçlanan: ${c.settled_matches}. Bekleyen/eksik/iptal içeren ortak maç: ${c.unscored_common_matches}. Bir yöntemde birden fazla seçim olduğu için karşılaştırma dışında: ${c.ambiguous_matches}.</p>
      <p class="muted">${escapeHTML(c.sample_note)}. Her yönteme, aynı maçlar için ayrı ayrı 1.000 TL/seçim uygulanır; kupon değildir. Eksik geçmiş tahminler üretilmez.</p>
      <div class="table-responsive"><table class="data-table"><thead><tr><th>Yöntem</th><th>Ortak sonuçlanan maç</th><th>Tuttu</th><th>Tutmadı</th><th>Ort. oran</th><th>Tutma %</th><th>Yatırılan</th><th>Geri dönüş</th><th>Net K/Z</th><th>ROI</th></tr></thead><tbody>${c.methods.map(m => `<tr><td>${escapeHTML(m.method)}</td><td>${m.total}</td><td>${m.won}</td><td>${m.lost}</td><td>${m.average_odds ?? '—'}</td><td>${m.hit_pct == null ? '—' : '%' + m.hit_pct}</td><td>${money(m.settled_stake)}</td><td>${money(m.gross_return)}</td><td>${money(m.net_profit)}</td><td>${m.roi_pct == null ? '—' : '%' + m.roi_pct}</td></tr>`).join('')}</tbody></table></div>`).join('');
    let dailyPanel = document.getElementById('prediction-daily-detail');
    let marketPerformance = document.getElementById('method-market-performance');
    if (!marketPerformance) {
      marketPerformance = document.createElement('div');
      marketPerformance.id = 'method-market-performance';
      document.getElementById('prediction-common-pool').after(marketPerformance);
    }
    const perf = data.method_market_performance || {rows: []};
    const labels = {insufficient:'Yetersiz veri', positive:'Pozitif net sonuç', negative:'Negatif net sonuç', neutral:'Başabaş'};
    marketPerformance.innerHTML = `<h3>Yöntem ve Market Performansı</h3><p class="muted">${escapeHTML(perf.note || '')}</p><div class="table-responsive"><table class="data-table"><thead><tr><th>Takip / yöntem</th><th>Market</th><th>Farklı maç / sonuçlanan maç</th><th>Tuttu / tutmadı (seçim)</th><th>Bekleyen / eksik / iade</th><th>Tutma %</th><th>Sonuçlanan ort. oran</th><th>Sonuçlanan tutar</th><th>Geri dönüş (iade hariç)</th><th>Net K/Z</th><th>ROI</th><th>Değerlendirme</th></tr></thead><tbody>${visible(perf.rows).map(r => `<tr><td>${track(r.track)} / ${escapeHTML(r.method)}</td><td>${escapeHTML(r.market)}</td><td>${r.unique_matches} / ${r.settled_matches}</td><td>${r.won} / ${r.lost}</td><td>${r.pending} / ${r.missing} / ${r.void}</td><td>${r.hit_pct == null ? '—' : '%' + r.hit_pct}</td><td>${r.average_odds ?? '—'}</td><td>${money(r.settled_stake)}</td><td>${money(r.gross_return)}</td><td>${money(r.net_profit)}</td><td>${r.roi_pct == null ? '—' : '%' + r.roi_pct}</td><td>${labels[r.status]}</td></tr>`).join('') || '<tr><td colspan="12">Bu dönemde uygun V3 kaydı yok.</td></tr>'}</tbody></table></div><p class="muted">Her takip/yöntem grubunda yeterli verisi olan marketler ROI yüksekten düşüğe, yetersiz veriler en sonda gösterilir. Diğer kaynaklardan ${Number(perf.excluded_other_sources || 0)} kayıt bu karşılaştırmaya katılmadı; mevcut günlükte korunur.</p>`;
    const selectedDay = document.getElementById('prediction-day-select')?.value;
    const selectedSource = document.getElementById('prediction-source-select')?.value;
    if (!dailyPanel) {
      dailyPanel = document.createElement('div');
      dailyPanel.id = 'prediction-daily-detail';
      performanceSummary.after(dailyPanel);
    }
    const visibleDays = visibleSources(data.days);
    const availableDays = [...new Set(visibleDays.map(d => d.day))].sort().reverse();
    const availableSources = [...new Set(visibleDays.map(d => d.source))].sort();
    dailyPanel.innerHTML = `<h3>Gün seç — maç maç 1.000 TL simülasyonu</h3><label>Maç günü <select id="prediction-day-select">${availableDays.map(d => `<option value="${escapeHTML(d)}">${escapeHTML(d)}</option>`).join('')}</select></label> <label>Yöntem <select id="prediction-source-select">${availableSources.map(s => `<option value="${escapeHTML(s)}">${sources[s] || escapeHTML(s)}</option>`).join('')}</select></label><p id="prediction-daily-money"></p><div class="table-responsive"><table class="data-table"><thead><tr><th>Maç</th><th>Seçim</th><th>Kayıtlı oran</th><th>Bahis</th><th>Geri dönüş</th><th>Net K/Z</th><th>İY / MS</th><th>Sonuç</th></tr></thead><tbody id="prediction-daily-rows"></tbody></table></div><p class="muted">Türkiye saatine göre maç günü. Gerçek oynanmış bahis değil, maç öncesi kaydedilmiş tahminlerin simülasyonudur. Bekleyen/eksik skor zarar sayılmaz; iptal tutarı iade edilir.</p>`;
    const daySelect = document.getElementById('prediction-day-select');
    const sourceSelect = document.getElementById('prediction-source-select');
    const today = new Date().toLocaleDateString('sv-SE', {timeZone:'Europe/Istanbul'});
    if (availableDays.includes(selectedDay)) daySelect.value = selectedDay;
    else if (availableDays.includes(today)) daySelect.value = today;
    if (availableSources.includes(selectedSource)) sourceSelect.value = selectedSource;
    else if (availableSources.includes('main-v3-1li')) sourceSelect.value = 'main-v3-1li';
    const renderDaily = () => {
      const d = data.days.find(d => d.day === daySelect.value && d.source === sourceSelect.value);
      document.getElementById('prediction-daily-money').textContent = d ? `Toplam yatırılan: ${money(d.stake_total)} · Sonuçlanan bahis: ${money(d.settled_stake)} · Geri dönüş (iade dahil): ${money(d.gross_return)} · İade: ${money(d.refunded_stake)} · Bekleyen: ${money(d.pending_stake)} · Net kâr/zarar: ${money(d.net_profit)}` : 'Bu gün ve yöntem için kayıt yok.';
      const rows = (data.daily_predictions || []).filter(p => p.day === daySelect.value && p.source === sourceSelect.value);
      document.getElementById('prediction-daily-rows').innerHTML = rows.map(p => `<tr><td>${escapeHTML(p.match_name || p.match_id)}</td><td>${escapeHTML(p.market || p.market_key)} · ${escapeHTML(p.selection)}</td><td>${Number(p.price).toFixed(2)}</td><td>${money(p.stake)}</td><td>${money(p.gross_return)}</td><td>${money(p.net_profit)}</td><td>${scorePairHTML(p.half_score, p.score)}</td><td>${outcomes[p.outcome] || escapeHTML(p.outcome)}</td></tr>`).join('') || '<tr><td colspan="8">Kayıt yok.</td></tr>';
    };
    daySelect.addEventListener('change', renderDaily);
    sourceSelect.addEventListener('change', renderDaily);
    renderDaily();
    document.getElementById('prediction-methods').innerHTML = visible(data.methods).length ? visible(data.methods).map(m =>
      `<tr><td>${track(m.track)}</td><td>${escapeHTML(m.method)}<br><small>${escapeHTML(m.sample_note || '')}</small></td><td>${m.total} tahmin<br><small>${m.unique_matches} maç / ${m.settled_matches} sonuçlanan maç</small></td><td>${m.won}</td><td>${m.lost}</td><td>${m.average_odds == null ? '—' : Number(m.average_odds).toFixed(2)}</td><td>${m.hit_pct == null ? '—' : '%' + m.hit_pct}</td><td>${money(m.net_profit)}</td><td>${m.roi_pct == null ? '—' : '%' + m.roi_pct}</td></tr>`).join('') : '<tr><td colspan="9">Karşılaştırma için ileriye dönük kayıt bekleniyor.</td></tr>';
    document.getElementById('prediction-thresholds').innerHTML = visible(data.thresholds).length ? visible(data.thresholds).sort((a,b) => a.threshold-b.threshold || a.method.localeCompare(b.method)).map(t =>
      `<tr><td>En az ${t.threshold}</td><td>${track(t.track)} / ${escapeHTML(t.method)}</td><td>${t.total}</td><td>${t.won+t.lost}</td><td>${t.average_odds == null ? '—' : Number(t.average_odds).toFixed(2)}</td><td>${t.hit_pct == null ? '—' : '%' + t.hit_pct}</td><td>${money(t.net_profit)}</td><td>${t.roi_pct == null ? '—' : '%' + t.roi_pct}</td></tr>`).join('') : '<tr><td colspan="8">Eşik karşılaştırması için ileriye dönük sonuç bekleniyor.</td></tr>';
    const blocked = state.blocked_markets || [];
    document.getElementById('prediction-market-guard').textContent = blocked.length ? `Otomatik koruma: en az 20 resmî sonucu olup ROI değeri negatif olan ${blocked.length} market yeni önerilerde geçici durduruldu.` : 'Otomatik koruma hazır: bir market ancak en az 20 resmî sonucu oluşur ve ROI negatif kalırsa geçici durdurulur.';
    document.getElementById('prediction-contexts').innerHTML = visible(data.contexts).length ? visible(data.contexts).map(c =>
      `<tr><td>${track(c.track)} / ${escapeHTML(c.method)}</td><td>${c.dimension === 'movement' ? 'Oran hareketi' : 'Maça kalan süre'}</td><td>${escapeHTML(c.label)}</td><td>${c.won+c.lost}</td><td>${c.hit_pct == null ? '—' : '%' + c.hit_pct}</td><td>${money(c.net_profit)}</td><td>${c.roi_pct == null ? '—' : '%' + c.roi_pct}</td></tr>`).join('') : '<tr><td colspan="7">Karşılaştırma için sonuçlanmış kayıt bekleniyor.</td></tr>';
    document.getElementById('prediction-details').innerHTML = visible(data.predictions).map(p =>
      `<tr><td>${escapeHTML(p.day)}<br><small>${escapeHTML(new Date(p.created_at).toLocaleString('tr-TR', {timeZone:'Europe/Istanbul'}))}</small></td><td>${escapeHTML(p.match_name)}</td><td>${sources[p.source] || escapeHTML(p.source)}</td><td>${escapeHTML(p.market)} · ${escapeHTML(p.selection)}</td><td>${Number(p.price).toFixed(2)}</td><td>${money(p.stake)}</td><td>${money(p.net_profit)}</td><td>${scorePairHTML(p.half_score, p.score)}</td><td>${outcomes[p.outcome] || escapeHTML(p.outcome)}</td></tr>`).join('');
  } catch (err) {
    document.getElementById('prediction-status').textContent = `Tahmin takibi yüklenemedi: ${err.message}`;
  } finally { predictionHistoryLoading = false; }
}
setInterval(() => {
  if (currentTab === 'tab-analysis') loadAnalysis(true);
}, 60000);
document.getElementById('prediction-window')?.addEventListener('change', loadPredictionHistory);
document.addEventListener('analysis-subtab-change', event => {
  if (event.detail !== 'movements') return;
  void loadDailyClosingMovements();
  void loadFlashscoreMovements();
  void loadReverseMovements();
});

const analysisSectionCache = new Map();
const analysisSectionPending = new Set();
let analysisOptionsPromise = null;
function ensureAnalysisOptions() {
  if (analysisMarkets.length) return Promise.resolve();
  if (!analysisOptionsPromise) {
    analysisOptionsPromise = getJSON('/api/analysis/options').then(setupAnalysisControls)
      .finally(() => { analysisOptionsPromise = null; });
  }
  return analysisOptionsPromise;
}
document.addEventListener('analysis-subtab-change', () => {
  if (currentTab === 'tab-analysis') loadAnalysis();
});
async function preloadAnalysisSections() {
  // Sequential warm-up keeps the two expensive requests from competing.
  // Existing pending guards also prevent duplicate requests on tab clicks.
  await loadAnalysis(false, 'single');
  await loadAnalysis(false, 'patterns');
}
async function loadAnalysis(force = false, requestedSection = null) {
  const section = requestedSection || document.querySelector('[data-analysis-tab][aria-selected="true"]')?.dataset.analysisTab || 'recommendations';
  if (section === 'daily') { loadPredictionHistory(); return; }
  // Dedicated prediction tabs load themselves. Starting the historical
  // recommendation query here made every prediction tab compete for CPU/SQLite.
  if (!['recommendations', 'preview', 'single', 'patterns', 'query'].includes(section)) return;
  // Options must never delay the independently prepared recommendations.
  ensureAnalysisOptions().catch(err => {
    document.getElementById('analysis-scope').textContent = 'Filtreler yüklenemedi: ' + err.message;
  });
  if (section === 'query') return;
  const group = section === 'preview' ? 'recommendations' : section;
  if (analysisSectionPending.has(group)) return;
  analysisSectionPending.add(group);
  try {
    if (group !== 'recommendations') await ensureAnalysisOptions();
    const params = new URLSearchParams();
    const weekday = document.getElementById("analysis-weekday").value;
    const marketKey = document.getElementById("analysis-market").value;
    const selection = document.getElementById("analysis-selection").value;
    const minSample = document.getElementById("analysis-min-sample").value || "3";
    params.set("min_sample", minSample);
    if (weekday) params.set("weekday", weekday);
    const singleParams = new URLSearchParams(params);
    if (marketKey) singleParams.set("market_key", marketKey);
    if (selection) singleParams.set("selection", selection);
    const url = group === 'single' ? `/api/analysis/single?${singleParams}` :
      group === 'patterns' ? `/api/analysis/patterns?${params}` :
      `/api/analysis/recommendations?min_sample=${encodeURIComponent(minSample)}`;
    const previous = analysisSectionCache.get(group);
    if (!force && previous?.url === url && Date.now() - previous.at < 60000) return;
    const data = await getJSON(url);
    if (group === 'single') renderSingleAnalysis(data);
    else if (group === 'patterns') renderAutomaticPatterns(data);
    else renderRecommendations(data);
    if (data.table_cache) {
      const state = data.table_cache;
      const count = document.getElementById(group === 'single' ? 'single-analysis-count' : 'pattern-analysis-count');
      count.textContent += state.updated_at ? ` · Son güncelleme: ${liveTime(state.updated_at)}` : ' · İlk sonuç hazırlanıyor';
      if (state.refreshing) count.textContent += ' · Güncelleniyor…';
      else if (state.stale) count.textContent += ' · Önceki kayıt';
      if (state.error) count.textContent += ' · ' + state.error;
      if (!state.updated_at) {
        document.getElementById(group === 'single' ? 'single-analysis-body' : 'pattern-analysis-body').innerHTML =
          `<tr><td colspan="13">${state.error ? escapeHTML(state.error) : 'İlk analiz hazırlanıyor; hazır olduğunda otomatik gösterilecek.'}</td></tr>`;
      }
    }
    analysisSectionCache.set(group, {url, at: Date.now()});
  } catch (err) {
    const target = group === 'single' ? 'single-analysis-body' : group === 'patterns' ? 'pattern-analysis-body' : section === 'preview' ? 'near-miss-body' : 'recommendation-body';
    document.getElementById(target).innerHTML = `<tr><td colspan="13" class="text-center"><div class="alert-box alert-warn">Analiz yüklenemedi: ${escapeHTML(err.message)} · Analizi Yenile ile tekrar deneyebilirsin.</div></td></tr>`;
    analysisSectionCache.delete(group);
  } finally {
    analysisSectionPending.delete(group);
  }
}

async function loadSingleMatches(row) {
  const panel = document.getElementById("single-match-detail");
  const body = document.getElementById("single-detail-body");
  panel.classList.remove("hidden");
  document.getElementById("single-detail-title").innerText = `${row.weekday} · ${row.market} ${row.selection} · ${Number(row.price).toFixed(2)}`;
  body.innerHTML = `<tr><td class="muted text-center p-2">Maçlar getiriliyor…</td></tr>`;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const params = new URLSearchParams({ market_key: row.market_key, selection: row.selection, price: row.price, step: "0.05", weekday: row.weekday === 'Tüm günler' ? '' : row.weekday });
    const data = await getJSON(`/api/analysis/single-matches?${params}`);
    body.innerHTML = data.matches?.length
      ? `<tr><th>Tarih / Gün</th><th>Maç</th><th>Lig</th><th>Gerçek Oran</th><th>İY / MS · Sonuç</th></tr>` + data.matches.map((match) => `<tr><td>${escapeHTML(match.date)}<br><small>${escapeHTML(match.weekday)}</small></td><td><strong>${escapeHTML(match.match_name)}</strong></td><td>${escapeHTML(match.competition)}</td><td><span class="odds-value">${Number(match.prices[0]).toFixed(2)}</span></td><td>${scorePairHTML(match.half_time_score, match.score)}<br><small>Sonuç: MS ${escapeHTML(match.outcome)}</small></td></tr>`).join("")
      : `<tr><td class="muted text-center p-2">Bu oran diliminde maç bulunamadı.</td></tr>`;
  } catch (err) {
    body.innerHTML = `<tr><td><div class="alert-box alert-warn">Maçlar getirilemedi: ${escapeHTML(err.message)}</div></td></tr>`;
  }
}

function collectPatternLegs() {
  const legs = [];
  document.querySelectorAll(".pattern-leg").forEach((row, index) => {
    const marketKey = row.querySelector(".leg-market").value;
    const selection = row.querySelector(".leg-selection").value;
    const rawPrice = row.querySelector(".leg-price").value.trim().replace(",", ".");
    if (!marketKey && !selection && !rawPrice && index === 2) return;
    const price = Number(rawPrice);
    if (!marketKey || !selection || !Number.isFinite(price) || price <= 1) throw new Error(`${index + 1}. koşulda market, seçim ve oranı tamamla.`);
    legs.push({ market_key: marketKey, selection, price });
  });
  if (legs.length < 2 || legs.length > 3) throw new Error("2 veya 3 oran koşulu seçmelisin.");
  return legs;
}

function fillPatternLeg(index, leg) {
  const row = document.querySelector(`.pattern-leg[data-leg="${index}"]`);
  const market = row.querySelector(".leg-market");
  market.value = leg.market_key;
  const selection = row.querySelector(".leg-selection");
  setSelectionOptions(selection, leg.market_key);
  selection.value = leg.selection;
  row.querySelector(".leg-price").value = Number(leg.price).toFixed(2).replace(".", ",");
}

function useAutomaticPattern(index) {
  const pattern = automaticPatterns[index];
  if (!pattern) return;
  selectAnalysisSubtab('query');
  pattern.legs.forEach((leg, legIndex) => fillPatternLeg(legIndex, leg));
  document.getElementById("analysis-weekday").value = pattern.weekday || "";
  runPatternQuery(pattern.legs);
  document.querySelector(".pattern-builder-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function runPatternQuery(providedLegs = null) {
  const errorBox = document.getElementById("pattern-query-error");
  errorBox.innerHTML = "";
  try {
    const legs = providedLegs || collectPatternLegs();
    const params = new URLSearchParams({
      legs: JSON.stringify(legs),
      tolerance: document.getElementById("pattern-tolerance").value,
    });
    const weekday = document.getElementById("analysis-weekday").value;
    if (weekday) params.set("weekday", weekday);
    const data = await getJSON(`/api/analysis/pattern?${params}`);
    renderPatternResult(data);
  } catch (err) {
    errorBox.innerHTML = `<div class="alert-box alert-warn">${escapeHTML(err.message)}</div>`;
  }
}

function renderPatternResult(data) {
  const summary = data.summary || {};
  document.getElementById("pattern-results").classList.remove("hidden");
  document.getElementById("pattern-summary").innerHTML = `
    <div class="result-summary-grid">
      <div><span>Benzer maç</span><strong>${fmtNum(summary.sample || 0)}</strong></div>
      <div><span>MS 1</span><strong>%${fmt(summary.outcomes?.["1"]?.pct)}</strong></div>
      <div><span>MS 0</span><strong>%${fmt(summary.outcomes?.["0"]?.pct)}</strong></div>
      <div><span>MS 2</span><strong>%${fmt(summary.outcomes?.["2"]?.pct)}</strong></div>
      <div class="highlight"><span>ÇŞ 0-2</span><strong>%${fmt(summary.double_chance?.["0-2"]?.pct)}</strong></div>
      <div><span>ÇŞ 1-2</span><strong>%${fmt(summary.double_chance?.["1-2"]?.pct)}</strong></div>
      <div><span>ÇŞ 1-0</span><strong>%${fmt(summary.double_chance?.["1-0"]?.pct)}</strong></div>
    </div>
    <p class="muted result-note">Baskın gerçek sonuç: <strong>${outcomeText(summary.dominant_outcome)}</strong> (%${fmt(summary.dominant_pct)}). Bu bir garanti değil; örnek sayısıyla birlikte değerlendirilmelidir.</p>`;
  const matches = (data.matches || []).slice(0, 100);
  document.getElementById("pattern-matches-body").innerHTML = matches.length
    ? `<tr><th>Tarih / Gün</th><th>Maç</th><th>Lig</th><th>Oranlar</th><th>İY / MS · Sonuç</th></tr>` + matches.map((match) => `<tr><td>${escapeHTML(match.date)}<br><small>${escapeHTML(match.weekday)}</small></td><td>${escapeHTML(match.match_name)}</td><td>${escapeHTML(match.competition)}</td><td>${match.prices.map((p) => `<span class="odds-value">${Number(p).toFixed(2)}</span>`).join(" + ")}</td><td>${scorePairHTML(match.half_time_score, match.score)}<br><small>Sonuç: MS ${escapeHTML(match.outcome)}</small></td></tr>`).join("")
    : `<tr><td class="muted text-center p-2">Bu koşullara uyan tamamlanmış maç bulunamadı.</td></tr>`;
  const candidates = data.candidates || [];
  document.getElementById("pattern-candidates").innerHTML = candidates.length
    ? candidates.map((match) => `<div class="candidate-row"><div><strong>${escapeHTML(match.match_name)}</strong><span>${escapeHTML(match.league)} · ${escapeHTML(match.date)} ${escapeHTML(match.weekday)}</span></div><div>${match.prices.map((p) => `<span class="odds-value">${Number(p).toFixed(2)}</span>`).join(" + ")}</div></div>`).join("")
    : `<div class="empty-state"><strong>Şu an eşleşen aday yok</strong><span>İddaa oranı bulunan maçlarda bu oran ikilisi/üçlüsü görüldüğünde burada çıkacak.</span></div>`;
}

document.getElementById("btn-refresh-analysis").addEventListener("click", () => loadAnalysis(true));
document.getElementById("btn-run-pattern").addEventListener("click", () => runPatternQuery());
document.getElementById("btn-close-single-detail").addEventListener("click", () => document.getElementById("single-match-detail").classList.add("hidden"));
document.querySelectorAll("[data-single-sort]").forEach((header) => {
  header.classList.add("sortable");
  header.addEventListener("click", () => {
    const key = header.dataset.singleSort;
    singleSort = singleSort.key === key ? { key, direction: singleSort.direction === "desc" ? "asc" : "desc" } : { key, direction: "desc" };
    document.querySelectorAll("[data-single-sort]").forEach((item) => item.classList.toggle("active-sort", item === header));
    header.innerText = header.innerText.replace(/[ ↑↓↕]$/, "") + (singleSort.direction === "desc" ? " ↓" : " ↑");
    renderSingleAnalysis({ rows: singleAnalysisRows, total: singleAnalysisRows.length });
  });
});

// ------------------------------------------------------------------ Tab 4: Veri Toplama Durumu (Rolling & Backfill)
async function loadRollingStatus() {
  const statusPill = document.getElementById("rc-status-pill");
  if (!statusPill) return;
  try {
    const data = await getJSON("/api/rolling-status");
    let halfPanel = document.getElementById('halftime-recovery-status');
    if (!halfPanel) {
      halfPanel = document.createElement('div'); halfPanel.id = 'halftime-recovery-status'; halfPanel.className = 'card';
      document.getElementById('tab-backfill').prepend(halfPanel);
    }
    const half = data.halftime_recovery;
    const halfLabels = {updated:'Skor tamamlandı',provider_data_unavailable:'Kullanılabilir veri gelmedi / eşleşmedi',retry_error:'Teknik hata; yeniden denenecek'};
    halfPanel.innerHTML = half?.available ? `<h2>İlk Yarı Skorlarını Tamamlama</h2><p>Bu süreçte tamamlanan: <strong>${half.recovered ?? 'Doğrulanamıyor'}</strong> · Eksik kalan: <strong>${half.remaining}</strong> · İlk yarısı tam bitmiş maç: ${half.complete}</p><p>Kontrol edilmiş tarih: ${half.checked_dates} · Kuyruk: ${half.queued_dates} tarih / ${half.queued_matches} maç</p><p>İlk yarı skoru ve oran kaydı olan: <strong>${half.complete_with_odds}</strong>. ${escapeHTML(half.impact_note)}</p><p>Sıradaki kontrol için en erken zaman: ${half.next_check ? escapeHTML(liveTime(half.next_check)) : 'Bekleyen eski tarih yok'}. Canlı sonuç önceliği, sağlayıcı beklemeleri ve bilgisayarın açık olması bu zamanı etkiler.</p>${half.error ? `<p class="warn">${escapeHTML(half.error)}</p>` : ''}<details><summary>Kontrol edilen tarihler ve bekleme nedenleri</summary><div class="table-responsive"><table class="data-table"><thead><tr><th>Tarih</th><th>Son kontrol</th><th>Son kontrolde eklenen</th><th>Durum</th><th>Tekrar deneme</th></tr></thead><tbody>${half.dates.map(d => `<tr><td>${escapeHTML(d.date)}</td><td>${escapeHTML(liveTime(d.checked_at))}</td><td>${d.recovered}</td><td>${escapeHTML(halfLabels[d.status] || d.status || 'Bilinmiyor')}${d.error ? '<br>'+escapeHTML(d.error) : ''}</td><td>${escapeHTML(liveTime(d.next_check))}</td></tr>`).join('') || '<tr><td colspan="5">Henüz tarih kontrolü kaydedilmedi.</td></tr>'}</tbody></table></div></details>` : `<h2>İlk Yarı Skorlarını Tamamlama</h2><p>${escapeHTML(half?.error || 'İlerleme bilgisi alınamadı.')}</p>`;
    if (!data || !data.available) {
      statusPill.className = "pill pill-lg bad";
      statusPill.innerText = "Kayıt Yok / Durduruldu";
      document.getElementById("rc-heartbeat-time").innerText = "Heartbeat yok";
      document.getElementById("rc-pid").innerText = "PID yok";
      return;
    }

    // Worker status pill
    const state = data.worker_state || "unknown";
    statusPill.className = `pill pill-lg ${state}`;
    statusPill.innerText = data.worker_status || "Bilinmiyor";

    // Heartbeat & PID
    document.getElementById("rc-heartbeat-time").innerText = data.heartbeat_at || "Kayıt yok";
    document.getElementById("rc-heartbeat-age").innerText = data.heartbeat_age_text || "—";
    document.getElementById("rc-pid").innerText = data.pid ? `PID: ${data.pid}` : "—";
    document.getElementById("rc-pid-sub").innerText = data.is_pid_running ? "İşlem Aktif" : "Çalışmıyor";

    // Rate mode & delay
    document.getElementById("rc-rate-mode").innerText = `Mod: ${escapeHTML(data.rate_mode || "normal")}`;
    document.getElementById("rc-rate-delay").innerText = `Gecikme: ${data.request_delay_seconds || 1.5} sn`;

    // 1. Odds section
    const odds = data.odds || {};
    const oddsPill = document.getElementById("rc-odds-status-pill");
    if (oddsPill) {
      oddsPill.className = `pill ${odds.status || "unknown"}`;
      oddsPill.innerText = odds.status_label || "Bilinmiyor";
    }
    document.getElementById("rc-odds-window").innerText = data.window_range_text || "—";
    document.getElementById("rc-odds-matches-count").innerText = fmtNum(odds.tracked_matches_count || 0);
    document.getElementById("rc-odds-last-attempt").innerText = odds.last_attempt_at || "—";
    document.getElementById("rc-odds-last-success").innerText = odds.last_success_at || "—";
    document.getElementById("rc-odds-last-update").innerText = odds.last_data_update_at || "—";
    document.getElementById("rc-odds-next-scheduled").innerText = odds.next_scheduled_at || "—";

    const counts = odds.counts || {};
    document.getElementById("rc-odds-changed-count").innerText = `Değişen: ${fmtNum(counts.changed || 0)}`;
    document.getElementById("rc-odds-unchanged-count").innerText = `Aynı: ${fmtNum(counts.unchanged || 0)}`;
    document.getElementById("rc-odds-empty-count").innerText = `Boş: ${fmtNum(counts.empty || 0)}`;

    const oddsAlert = document.getElementById("rc-odds-alert");
    if (odds.last_error || odds.retry_reason) {
      oddsAlert.style.display = "block";
      document.getElementById("rc-odds-error-text").innerText = odds.last_error || odds.retry_reason;
    } else {
      oddsAlert.style.display = "none";
    }

    // 2. Results section
    const results = data.results || {};
    const resPill = document.getElementById("rc-results-status-pill");
    if (resPill) {
      resPill.className = `pill ${results.status || "unknown"}`;
      resPill.innerText = results.status_label || "Bilinmiyor";
    }
    document.getElementById("rc-results-live-dates").innerText = (results.live_due_dates || []).join(", ") || "—";
    document.getElementById("rc-results-outstanding-count").innerText = `${fmtNum(results.outstanding_count || 0)} maç`;
    document.getElementById("rc-results-backlog-count").innerText = `${fmtNum(results.historical_backlog_count || 0)} maç`;
    document.getElementById("rc-results-last-attempt").innerText = results.last_attempt_at || "—";
    document.getElementById("rc-results-last-update").innerText = results.last_data_update_at || "—";
    document.getElementById("rc-results-next-scheduled").innerText = results.next_scheduled_at || "—";

    const resAlert = document.getElementById("rc-results-alert");
    if (results.last_error || results.retry_reason) {
      resAlert.style.display = "block";
      document.getElementById("rc-results-error-text").innerText = results.last_error || results.retry_reason;
    } else {
      resAlert.style.display = "none";
    }

    // 3. Supervisor & HTTP
    const sup = data.supervisor || {};
    document.getElementById("rc-supervisor-last-restart").innerText = sup.last_restart_at || "Kayıt yok";
    document.getElementById("rc-supervisor-restarts-count").innerText = `${sup.recent_restarts_count || 0}`;

    document.getElementById("rc-http-status").innerText = data.last_http_status ? `HTTP ${data.last_http_status}` : "—";
    let queueHealth = document.getElementById('rc-queue-health');
    if (!queueHealth) {
      queueHealth = document.createElement('p'); queueHealth.id = 'rc-queue-health';
      document.getElementById('rc-status-pill').parentElement.after(queueHealth);
    }
    queueHealth.textContent = 'Kuyruk koruması: ' + (data.queue_health?.message || 'Henüz doğrulanmadı.') +
      (data.queue_health?.last_recovery ? ' Son kurtarma: '+data.queue_health.last_recovery.checked_at_utc : '');
    document.getElementById("rc-consecutive-failures").innerText = `${data.consecutive_failures || 0}`;
    document.getElementById("rc-retry-reason").innerText = data.held ? `${data.rate_mode} beklemesi` : "Normal akış";

    // 4. Log tail
    const logTail = data.log_tail || [];
    document.getElementById("rc-log-tail").innerText = logTail.length ? logTail.join("\n") : "Log dosyası boş veya okunamadı.";
  } catch (err) {
    statusPill.className = "pill pill-lg bad";
    statusPill.innerText = "Bağlantı Hatası";
  }
}

async function loadBackfillStatus() {
  const pill = document.getElementById("bf-status-pill");
  try {
    const data = await getJSON("/api/backfill-status");

    // Worker Status Pill
    const state = data.worker_state || "unknown";
    pill.className = `pill pill-lg ${state}`;
    pill.innerText = data.worker_status || "Bilinmiyor";

    // Heartbeat
    document.getElementById("bf-heartbeat-time").innerText = data.heartbeat_at || "Kayıt yok";
    document.getElementById("bf-heartbeat-age").innerText = data.heartbeat_age_text || "—";

    // Queue Progress
    const totalQ = data.total_queue || 0;
    const procQ = data.processed_records || 0;
    const remQ = data.remaining_records || 0;
    const pct = totalQ > 0 ? Math.min(100, Math.round((procQ / totalQ) * 100)) : 0;

    document.getElementById("bf-queue-progress").innerText = `${fmtNum(procQ)} / ${fmtNum(totalQ)} (%${pct})`;
    document.getElementById("bf-progress-bar").style.width = `${pct}%`;
    document.getElementById("bf-queue-sub").innerText = `Kalan kayıt: ${fmtNum(remQ)}`;

    // DB Matches
    document.getElementById("bf-db-matches").innerText = `${fmtNum(data.db_matches_count)} Maç`;

    // Rate mode & delay
    document.getElementById("bf-rate-mode").innerText = `Mod: ${escapeHTML(data.rate_mode)}`;
    document.getElementById("bf-rate-delay").innerText = `İstek Aralığı: ${data.request_delay_seconds} sn`;

    // HTTP Status
    const statusVal = data.last_http_status;
    document.getElementById("bf-http-status").innerText = statusVal ? `HTTP ${statusVal}` : "—";
    const consec = data.consecutive_failures || 0;
    document.getElementById("bf-consecutive-failures").innerText =
      consec > 0 ? `Art arda ${consec} başarısız istek` : "Son istek başarılı";

    // Error Alert Box
    const alertBox = document.getElementById("bf-error-alert");
    if (data.error_explanation || consec > 0) {
      alertBox.style.display = "block";
      document.getElementById("bf-error-text").innerText =
        data.error_explanation || `Art arda ${consec} istek başarısız oldu.`;
    } else {
      alertBox.style.display = "none";
    }

    // Last Batch Details
    const lb = data.last_batch;
    if (lb) {
      document.getElementById("bf-batch-details").innerHTML = `
        <table class="data-table">
          <tbody>
            <tr><th>Batch No</th><td><strong>#${lb.batch}</strong></td></tr>
            <tr><th>Boyut</th><td>${lb.size} maç</td></tr>
            <tr><th>Başarılı / Hatalı</th><td><span class="pill ok">${lb.success}</span> / <span class="pill ${lb.failed > 0 ? "bad" : "ok"}">${lb.failed}</span></td></tr>
            <tr><th>Yeniden Denenen</th><td>${lb.retried}</td></tr>
            <tr><th>Kalan Kayıt</th><td>${fmtNum(lb.remaining)}</td></tr>
            <tr><th>Tarih Aralığı</th><td>${lb.earliest_date} .. ${lb.latest_date}</td></tr>
          </tbody>
        </table>`;
    } else {
      document.getElementById("bf-batch-details").innerHTML = "<p class='muted'>Son batch bilgisi yok.</p>";
    }

    // HTTP Counters
    document.getElementById("bf-http-counters").innerHTML = `
      <table class="data-table">
        <tbody>
          <tr><th>Başarılı İstekler</th><td><span class="pill ok">${fmtNum(data.http_success_count)}</span></td></tr>
          <tr><th>5xx Sunucu Hataları</th><td><span class="pill ${data.http_5xx_count > 0 ? "warn" : "ok"}">${fmtNum(data.http_5xx_count)}</span></td></tr>
          <tr><th>Art Arda Hata</th><td>${consec}</td></tr>
          <tr><th>İşlemci PID</th><td><code>${fmt(data.pid)}</code> ${data.is_pid_running ? "(Aktif)" : "(Durduruldu)"}</td></tr>
        </tbody>
      </table>`;

    // Log Tail
    const logBox = document.getElementById("bf-log-tail");
    const tail = data.log_tail || [];
    logBox.innerText = tail.length ? tail.join("\n") : "Log dosyası henüz boş veya okunamadı.";
  } catch (err) {
    pill.className = "pill pill-lg bad";
    pill.innerText = "Hata";
    document.getElementById("bf-log-tail").innerText = `Hata: ${err.message}`;
  }
}

document.getElementById("btn-refresh-backfill").addEventListener("click", loadBackfillStatus);
document.getElementById("btn-refresh-rolling")?.addEventListener("click", loadRollingStatus);

// ------------------------------------------------------------------ Tab 5: Veri Sağlığı
async function loadHealth() {
  void loadScoreHealth();
  void loadInfrastructureStatus();
  void loadSourceComparison();
  const box = document.getElementById("health-overview-box");
  const qBox = document.getElementById("health-quality-box");
  const wBox = document.getElementById("health-whitelist-box");

  try {
    const health = await getJSON("/api/health");
    const quality = await getJSON("/api/quality");
    const summary = await getJSON("/api/summary");

    const statusPill =
      health.status === "healthy"
        ? '<span class="pill ok">Sağlıklı (Healthy)</span>'
        : health.status === "degraded"
        ? '<span class="pill warn">Kısmi / Yavaş (Degraded)</span>'
        : '<span class="pill bad">Kritik (Unhealthy)</span>';

    box.innerHTML = `
      <table class="data-table">
        <tbody>
          <tr><th>Genel Sağlık</th><td>${statusPill}</td></tr>
          <tr><th>Veritabanı Dosyası</th><td><code>${escapeHTML(health.db?.path || "—")}</code></td></tr>
          <tr><th>Dosya Mevcut mu?</th><td>${health.db?.exists ? '<span class="pill ok">Evet</span>' : '<span class="pill bad">Hayır</span>'}</td></tr>
          <tr><th>Dosya Boyutu</th><td>${health.db?.size_bytes ? fmtNum(health.db.size_bytes) + " bytes" : "—"}</td></tr>
          <tr><th>SQLite quick_check</th><td><span class="pill ${health.db?.quick_check === "ok" ? "ok" : "bad"}">${escapeHTML(health.db?.quick_check || "—")}</span></td></tr>
          <tr><th>Worker Durumu</th><td><span class="pill ${health.backfill?.worker_state || "unknown"}">${escapeHTML(health.backfill?.worker_status || "—")}</span></td></tr>
          <tr><th>Raporlama Zamanı</th><td>${escapeHTML(health.generated_at || "—")}</td></tr>
        </tbody>
      </table>`;

    // Quality Indicators
    const qRows = [];
    for (const [k, v] of Object.entries(quality)) {
      if (Array.isArray(v)) {
        qRows.push(`<tr><th>${escapeHTML(k)}</th><td>${v.length} grup — örnek: ${v.length ? escapeHTML(JSON.stringify(v[0])) : "—"}</td></tr>`);
      } else {
        const cls = typeof v === "number" && v > 0 ? "warn" : "ok";
        qRows.push(`<tr><th>${escapeHTML(k)}</th><td><span class="pill ${cls}">${fmt(v)}</span></td></tr>`);
      }
    }
    qBox.innerHTML = qRows.length
      ? `<table class="data-table">${qRows.join("")}</table>`
      : `<p class="muted">Kalite kontrol verisi bulunamadı.</p>`;

    // Whitelist breakdown
    const w = summary.whitelist || {};
    wBox.innerHTML = `
      <table class="data-table">
        <tbody>
          <tr><th>Toplam Whitelist Değerlendirmesi</th><td><strong>${fmtNum(w.total)}</strong></td></tr>
          <tr><th>Kabul Edilen (ACCEPTED)</th><td><span class="pill ok">${fmtNum(w.accepted)}</span></td></tr>
          <tr><th>Reddedilen (REJECTED/BLOCKED)</th><td><span class="pill bad">${fmtNum(w.rejected)}</span></td></tr>
          <tr><th>Eşleşmeyen Turnuva (UNKNOWN_COMPETITION)</th><td><span class="pill warn">${fmtNum(w.unknown_competition)}</span></td></tr>
        </tbody>
      </table>`;

    loadBackupStatus();
  } catch (err) {
    box.innerHTML = `<div class="alert-box alert-warn">Sağlık verileri alınamadı: ${escapeHTML(err.message)}</div>`;
  }
}

async function loadInfrastructureStatus() {
  const box=document.getElementById('infrastructure-status-box');
  const scopeBox=document.getElementById('collection-scope-box');
  if (!box) return;
  try {
    const data=await getJSON('/api/infrastructure-status');
    const scope=data.collection_scope || {}, nesine=scope.nesine || {}, mackolik=scope.mackolik || {}, flashscore=scope.flashscore || {};
    if (scopeBox) {
      const good=value=>['running','working'].includes(String(value||'').toLowerCase());
      const scopeAge=nesine.age_seconds==null?null:Math.max(0,Number(nesine.age_seconds));
      const age=scopeAge==null?'—':scopeAge<60?Math.round(scopeAge)+' sn':Math.round(scopeAge/60)+' dk';
      scopeBox.innerHTML=`<div class="table-responsive"><table class="data-table"><thead><tr><th>Kaynak</th><th>Durum</th><th>Nesine ile eşleşen / aktif</th><th>Elenen</th><th>Son bilgi</th></tr></thead><tbody>
        <tr><td><strong>Nesine</strong></td><td><span class="pill ${good(nesine.status)?'ok':'warn'}">${escapeHTML(nesine.status || 'bekliyor')}</span></td><td><strong>${fmtNum(nesine.active_matches)}</strong> oynanabilir maç</td><td>—</td><td>${escapeHTML(nesine.last_update ? liveTime(nesine.last_update) : '—')} · ${escapeHTML(age)}</td></tr>
        <tr><td><strong>Mackolik</strong></td><td><span class="pill ${good(mackolik.status)?'ok':'warn'}">${escapeHTML(mackolik.status || 'bilinmiyor')}</span></td><td><strong>${fmtNum(mackolik.matched)}</strong> takipte</td><td><strong>${mackolik.rejected==null?'—':fmtNum(mackolik.rejected)}</strong></td><td>${mackolik.discovered!=null?fmtNum(mackolik.discovered)+' son liste maçı incelendi':mackolik.audit_total!=null?fmtNum(mackolik.audit_total)+' gelecekteki DB kaydı denetlendi':'İlk kapsam taraması bekleniyor'}</td></tr>
        <tr><td><strong>Flashscore</strong></td><td><span class="pill ${good(flashscore.status)?'ok':'warn'}">${escapeHTML(flashscore.status || 'bilinmiyor')}</span></td><td><strong>${fmtNum(flashscore.matched)}</strong> takipte</td><td><strong>${fmtNum(flashscore.rejected)}</strong></td><td>${escapeHTML(flashscore.last_job || 'bekliyor')}</td></tr>
        </tbody></table></div>
        ${nesine.error?`<div class="alert-box alert-warn">${escapeHTML(nesine.error)}</div>`:''}
        <p class="muted">${escapeHTML(scope.rule || '')} Analiz sistemi değiştirilmedi.</p>`;
    }
    const quality=data.data_quality || {}, sources=quality.sources || {}, closing=quality.closing_capture || {};
    const sourceRows=['mackolik','flashscore','nesine'].map(name=>{
      const row=sources[name] || {};
      const age=row.latest_odds_age_seconds==null?'—':Math.round(row.latest_odds_age_seconds/60)+' dk';
      return `<tr><td><strong>${escapeHTML(name[0].toUpperCase()+name.slice(1))}</strong></td><td><span class="pill ${row.status==='ok'?'ok':'warn'}">${escapeHTML(row.status || 'bekliyor')}</span></td><td>${fmtNum(row.matches)}</td><td>${fmtNum(row.odds_observations)}</td><td>${escapeHTML(age)}</td></tr>`;
    }).join('');
    const watchdog=data.watchdog || {}, backup=data.all_backup || {}, restore=data.restore_test || {};
    box.innerHTML=`<div class="table-responsive"><table class="data-table"><thead><tr><th>Kaynak</th><th>Durum</th><th>Maç</th><th>Oran kaydı</th><th>Son oran yaşı</th></tr></thead><tbody>${sourceRows}</tbody></table></div>
      <p><strong>Son 7 gün kapanış yakalama:</strong> ${fmtNum(closing.matches)} başlamış maç · T-60: ${fmtNum(closing.t60)} · T-15: ${fmtNum(closing.t15)} · T-5: ${fmtNum(closing.t5)} · son maç önü: ${fmtNum(closing.last_prematch)} (%${fmt(closing.last_prematch_pct)}) · maç sonrası yanlış kapanış: <strong>${fmtNum(closing.post_kickoff_snapshot_count)}</strong></p>
      <p><strong>Panel gözetimi:</strong> <span class="pill ${watchdog.status==='healthy'?'ok':'warn'}">${escapeHTML(watchdog.status || 'bekliyor')}</span> · RAM: ${watchdog.panel_working_set_bytes==null?'—':fmtNum(Math.round(watchdog.panel_working_set_bytes/1048576))+' MB'} · Son işlem: ${escapeHTML(watchdog.last_action || 'yeniden başlatma gerekmedi')}</p>
      <p><strong>Beş veritabanı yedeği:</strong> <span class="pill ${backup.status==='ok'?'ok':'warn'}">${escapeHTML(backup.status || 'bekliyor')}</span> · ${fmtNum(backup.database_count)} veritabanı · ${escapeHTML(backup.last_backup_set || backup.message || 'ilk yedek bekleniyor')}</p>
      <p><strong>Geri yükleme tatbikatı:</strong> <span class="pill ${restore.status==='ok'?'ok':'warn'}">${restore.status==='ok'?'Başarılı':escapeHTML(restore.status || 'bekliyor')}</span> · ${fmtNum(Object.keys(restore.databases || {}).length)} veritabanı doğrulandı · ana dosyalara dokunuldu: ${restore.production_files_modified?'evet':'hayır'} · geçici kopyalar silindi: ${restore.temporary_files_removed?'evet':'hayır'}</p>
      <p class="muted">${escapeHTML(closing.rule || '')}</p>`;
  } catch(error) { box.innerHTML=`<div class="alert-box alert-warn">Altyapı raporu alınamadı: ${escapeHTML(error.message)}</div>`; if(scopeBox) scopeBox.innerHTML=`<div class="alert-box alert-warn">Nesine kapsamı alınamadı: ${escapeHTML(error.message)}</div>`; }
}
document.getElementById('infrastructure-refresh')?.addEventListener('click',loadInfrastructureStatus);
document.getElementById('collection-scope-refresh')?.addEventListener('click',loadInfrastructureStatus);

function sourceOddsCell(item) {
  if (!item) return '<span class="pill warn">Eşleşmedi</span>';
  const odds=item.closing;
  const prices=odds ? `1: <strong>${fmt(odds['1'])}</strong> · X: <strong>${fmt(odds['X'])}</strong> · 2: <strong>${fmt(odds['2'])}</strong>` : '<span class="pill warn">MS oranı yok</span>';
  const opening=item.opening ? `<br><small>Açılış: ${fmt(item.opening['1'])} / ${fmt(item.opening['X'])} / ${fmt(item.opening['2'])}</small>` : '';
  const scores=(item.ht_score||item.ft_score) ? `<br><small>İY: ${escapeHTML(item.ht_score||'—')} · MS: ${escapeHTML(item.ft_score||'—')}</small>` : '';
  const at=item.closing_at && !item.closing_at.startsWith('0000-') ? `<br><small>Son kayıt: ${escapeHTML(liveTime(item.closing_at))}</small>` : '';
  return prices+opening+scores+at;
}

async function loadSourceComparison(force=false) {
  const date=document.getElementById('source-comparison-date'), body=document.getElementById('source-comparison-body'), status=document.getElementById('source-comparison-status');
  if (!date || !body || !status) return;
  if (!date.value) date.value=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'});
  status.textContent='Üç kaynak karşılaştırılıyor…';
  try {
    const data=await getJSON('/api/source-comparison?date='+encodeURIComponent(date.value)+(force?'&refresh=1':''));
    const rows=data.rows || [];
    body.innerHTML=rows.length ? rows.map(row=>`<tr><td><strong>${escapeHTML(row.match||'—')}</strong><br><small>${escapeHTML(row.league||'—')} · ${escapeHTML(liveTime(row.kickoff))}</small></td><td>${sourceOddsCell(row.sources?.mackolik)}</td><td>${sourceOddsCell(row.sources?.flashscore)}</td><td>${sourceOddsCell(row.sources?.nesine)}</td><td>${row.warnings?.length?'<span class="pill warn">Kontrol</span><br>'+row.warnings.map(escapeHTML).join('<br>'):'<span class="pill ok">Uyumlu</span>'}</td></tr>`).join('') : '<tr><td colspan="5">Bu tarihte karşılaştırılacak maç bulunamadı.</td></tr>';
    const s=data.summary || {};
    status.textContent=`${data.date} · ${fmtNum(s.rows)} Mackolik maçı · üç kaynakta eşleşen ${fmtNum(s.all_three)} · oran bulunan ${fmtNum(s.with_odds)} · kontrol gerektiren ${fmtNum(s.warnings)} · Mackolik ile eşleşmeyen FS/Nesine: ${fmtNum(s.unmatched_flashscore)} / ${fmtNum(s.unmatched_nesine)}`;
  } catch(error) { status.textContent='Kaynak karşılaştırması alınamadı: '+error.message; body.innerHTML='<tr><td colspan="5">Rapor alınamadı.</td></tr>'; }
}
document.getElementById('source-comparison-refresh')?.addEventListener('click',()=>loadSourceComparison(true));
document.getElementById('source-comparison-date')?.addEventListener('change',()=>loadSourceComparison());

async function loadBackupStatus() {
  const box = document.getElementById("backup-status-box");
  if (!box) return;
  try {
    const data = await getJSON("/api/backup-status");
    if (!data.backup_count) {
      box.innerHTML = `<div class="alert-box alert-info">Henüz oluşturulmuş bir yedek seti bulunmuyor. Yedekleme klasörü: <code>${escapeHTML(data.backup_dir || "—")}</code></div>`;
      return;
    }
    const main = data.main_db || {};
    const journal = data.journal_db || {};
    box.innerHTML = `
      <table class="data-table">
        <tbody>
          <tr><th>Mevcut Yedek Sayısı</th><td><span class="pill ok">${fmtNum(data.backup_count)} / 7 set</span></td></tr>
          <tr><th>Son Yedek / Doğrulama</th><td><strong>${escapeHTML(data.last_backup_set || "—")}</strong> (${escapeHTML(data.last_backup_age_text || "—")}) <span class="pill ${data.verified ? 'ok' : 'bad'}">${data.verified ? 'Dosya ve veritabanı doğrulandı' : 'Doğrulanamadı'}</span> ${escapeHTML(data.last_error || '')}</td></tr>
          <tr><th>Ana Veritabanı Yedeği</th><td>${main.backup_path ? '<code>' + escapeHTML(main.backup_path) + '</code> (' + fmtNum(main.backup_size_bytes) + ' bytes, quick_check: <span class="pill ok">' + escapeHTML(main.quick_check || "ok") + '</span>)' : '—'}</td></tr>
          <tr><th>Prediction Journal Yedeği</th><td>${journal.skipped ? '<span class="pill warn">Atlandı (' + escapeHTML(journal.reason || "") + ')</span>' : journal.backup_path ? '<code>' + escapeHTML(journal.backup_path) + '</code> (' + fmtNum(journal.backup_size_bytes) + ' bytes, quick_check: <span class="pill ok">' + escapeHTML(journal.quick_check || "ok") + '</span>)' : '—'}</td></tr>
          <tr><th>Yedekleme Dizini</th><td><code>${escapeHTML(data.backup_dir || "—")}</code></td></tr>
        </tbody>
      </table>`;
  } catch (err) {
    box.innerHTML = `<div class="alert-box alert-warn">Yedekleme durumu alınamadı: ${escapeHTML(err.message)}</div>`;
  }
}

document.getElementById("btn-refresh-backup")?.addEventListener("click", loadBackupStatus);
document.getElementById("btn-daily-movement")?.addEventListener("click", loadDailyClosingMovements);
document.getElementById("btn-flashscore-movement")?.addEventListener("click", loadFlashscoreMovements);
document.getElementById("btn-reverse-movement")?.addEventListener("click", loadReverseMovements);


// ------------------------------------------------------------------ Init
function initApp() {
  async function refreshRollingStatus() {
    const box = document.getElementById("rolling-status");
    if (!box) return;
    try {
      const response = await fetch("/api/rolling-status", {signal: AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      if (!data.heartbeat_at_utc) { box.textContent = "Sürekli toplama henüz başlamadı."; return; }
      const fresh = Date.now() - Date.parse(data.heartbeat_at_utc) < 180000;
      const state = data.held ? "Sağlayıcı korumasında bekliyor" : fresh ? "Durum sinyali güncel" : "Durum sinyali gecikmiş; kontrol gerekiyor";
      const dates = data.window || [];
      const counts = data.counts || {};
      const last = data.last_success_utc ? new Date(data.last_success_utc).toLocaleString("tr-TR") : "Henüz yok";
      box.textContent = `Sürekli toplama: ${state} | Aralık: ${dates[0]} – ${dates[dates.length-1]} | Son başarılı işlem: ${last} | Yeni/değişen oran kaydı: ${counts.odds_changed || 0} | Değişmeyen: ${counts.odds_unchanged || 0} | Sonuç taraması: ${counts.results_ok || 0}${data.last_error ? " | Son hata: " + data.last_error : ""}`;
    } catch (error) { box.textContent = "Sürekli toplama durumu alınamadı: " + error.message; }
  }
  refreshRollingStatus();
  setInterval(refreshRollingStatus, 30000);
  const hash = window.location.hash.replace("#", "");
  if (hash === "weekly") switchTab("tab-weekly");
  else if (hash === "matches") switchTab("tab-matches");
  else if (hash === "live") switchTab("tab-live");
  else if (hash === "kickoff") switchTab("tab-kickoff");
  else if (hash === "flashscore") switchTab("tab-flashscore");
  else if (hash === "htft-pairs") switchTab("tab-htft-pairs");
  else if (hash === "consensus") switchTab("tab-analysis", "consensus");
  else if (hash === "top3") switchTab("tab-analysis", "top3");
  else if (hash === "research") switchTab("tab-research");
  else if (hash === "overview") switchTab("tab-research");
  else if (hash === "analysis") switchTab("tab-analysis");
  else if (hash === "backfill") switchTab("tab-backfill");
  else if (hash === "health") switchTab("tab-health");
  else switchTab("tab-analysis");

  loadOverview();
  loadMatches(1);
  // Heavy movement reports are loaded only when their analysis tab is opened.
  // Expensive single/pattern history is loaded on demand from its own tab.
}

async function loadScoreHealth() {
  const box=document.getElementById('score-health-box');
  if (!box) return;
  try {
    const data=await getJSON('/api/score-completeness');
    if (!data.available) {box.textContent=data.reason;return;}
    const c=data.counts, w=data.worker;
    const state=w?.last?.state;
    const status=state==='held' ? 'Kaynak korumasında durdu' : data.worker_age_seconds==null ? 'Henüz başlatılmadı' : data.worker_age_seconds>180 ? 'Son durum sinyali eski; kontrol gerekli' : state==='idle' ? 'Mevcut kuyruk işlendi; yeni kayıtlar bekleniyor' : 'Tamamlama çalışıyor';
    const sources=data.sources.map(s=>`<tr><td>${escapeHTML(s.source)}</td><td>${fmtNum(s.matches)}</td><td>${fmtNum(s.halftime)}</td><td>${fmtNum(s.fulltime)}</td></tr>`).join('');
    const recent=data.recent.map(r=>`<tr><td>${escapeHTML(r.match_name)}</td><td>${r.halftime_home_score ?? '—'}-${r.halftime_away_score ?? '—'}</td><td>${r.home_score ?? '—'}-${r.away_score ?? '—'}</td><td>${escapeHTML(r.source)}</td><td>${escapeHTML(liveTime(r.observed_at))}</td></tr>`).join('');
    box.innerHTML=`<p><strong>${escapeHTML(status)}</strong> · Son sinyal: ${escapeHTML(liveTime(w?.updated_at))}</p><p>${fmtNum(c.total)} kayıt · ${fmtNum(c.finished)} bitmiş maç · MS skoru tam: ${fmtNum(c.ft_complete)} · İY ve MS birlikte tam: <strong>${fmtNum(c.complete)}</strong> · Bitmiş maçta eksik İY: <strong>${fmtNum(c.ht_missing)}</strong></p><p>Eşleştirilemeyen geçmiş kayıt: ${fmtNum(w?.unmatched)} · Çatışma kaydı: ${fmtNum(data.conflicts.reduce((n,r)=>n+r.count,0))}. Eşleşmeyen, kaynakta bulunmayan ve çelişen skorlar tahmin edilerek doldurulmaz.</p><div class="table-responsive"><table class="data-table"><thead><tr><th>Tamamlama kaynağı</th><th>Maç</th><th>Eklenen İY</th><th>Tamamlanan MS</th></tr></thead><tbody>${sources || '<tr><td colspan="4">Henüz yeni skor eklenmedi.</td></tr>'}</tbody></table></div><details><summary>Son eklenen 10 skor</summary><div class="table-responsive"><table class="data-table"><thead><tr><th>Maç</th><th>İY</th><th>MS</th><th>Kaynak</th><th>Alınma zamanı</th></tr></thead><tbody>${recent}</tbody></table></div></details><p class="muted">${escapeHTML(data.scope)}</p>`;
  } catch(error) {box.textContent='Skor durumu alınamadı: '+error.message;}
}
document.getElementById('score-health-refresh')?.addEventListener('click',loadScoreHealth);
let scoreHealthTimer=null;
document.addEventListener('companion-tab-change',event=>{
  if(scoreHealthTimer) {clearInterval(scoreHealthTimer);scoreHealthTimer=null;}
  if(event.detail==='tab-health') scoreHealthTimer=setInterval(loadScoreHealth,15000);
});
document.addEventListener("DOMContentLoaded", initApp);
