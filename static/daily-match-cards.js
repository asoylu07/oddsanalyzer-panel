let dailyMatchRows = [];
const matchDayTR = value => new Date(value).toLocaleDateString('sv-SE', {timeZone:'Europe/Istanbul'});

function groupDailyMatches(rows, day = 'today', league = '', now = Date.now()) {
  const target = day === 'today' ? matchDayTR(now) : day === 'tomorrow' ? matchDayTR(now + 86400000) : null;
  const groups = new Map();
  for (const row of rows) {
    const start = Date.parse(row.kickoff_at_utc);
    if (!Number.isFinite(start) || start <= now || (target && matchDayTR(start) !== target) || (league && row.league !== league)) continue;
    if (!groups.has(row.match_id)) groups.set(row.match_id, {id:row.match_id, start, name:row.match_name, league:row.league, rows:[]});
    groups.get(row.match_id).rows.push(row);
  }
  return Array.from(groups.values()).sort((a,b) => a.start-b.start || String(a.id).localeCompare(String(b.id)));
}

function renderDailyMatchCards(rows) {
  dailyMatchRows = rows;
  let panel = document.getElementById('daily-match-cards');
  if (!panel) {
    panel = document.createElement('div'); panel.id = 'daily-match-cards';
    const table = document.getElementById('recommendation-body').closest('.table-responsive');
    table.before(panel);
    const legacy = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Tüm önerileri tablo olarak göster';
    table.before(legacy); legacy.append(summary, table);
    panel.innerHTML = `<div class="daily-match-filters"><label>Gün <select id="daily-match-day"><option value="today">Bugün</option><option value="tomorrow">Yarın</option><option value="all">Tüm yaklaşanlar</option></select></label><label>Lig / Turnuva <select id="daily-match-league"><option value="">Tümü</option></select></label><span id="daily-match-count" role="status"></span></div><p class="muted">Türkiye saatiyle, en yakın maç önce. Tekli/ikili/üçlü ayrı analiz yöntemleridir; kupon değildir. Yalnız resmî önerisi bulunan yaklaşan maçlar listelenir. Bir yöntemin boş olması diğer yöntemleri geçersiz kılmaz.</p><div id="daily-match-list"></div>`;
    const scopeLabel = document.createElement('label');
    scopeLabel.innerHTML = 'Kapsam <select id="daily-match-scope"><option value="all">Tüm İddaa maçları</option><option value="ten">Seçili 10 lig / turnuva</option></select>';
    panel.querySelector('.daily-match-filters').prepend(scopeLabel);
    panel.querySelectorAll('select').forEach(select => select.addEventListener('change', drawDailyMatchCards));
  }
  const select = document.getElementById('daily-match-league');
  const selected = select.value;
  const leagues = [...new Set(rows.map(r => r.league).filter(Boolean))].sort((a,b) => a.localeCompare(b,'tr'));
  if (selected && !leagues.includes(selected)) leagues.push(selected);
  select.innerHTML = '<option value="">Tümü</option>' + leagues.map(league => `<option value="${escapeHTML(league)}">${escapeHTML(league)}</option>`).join('');
  select.value = selected;
  drawDailyMatchCards();
  initRecordedMatchCards(panel);
}

function groupRecordedMatches(rows, day) {
  const groups = new Map();
  for (const row of rows) {
    if (!/^main-v3-(1li|2li|3li)$/.test(row.source || '') || row.day !== day) continue;
    const start = Date.parse(row.kickoff_at_utc || row.kickoff_at);
    const created = Date.parse(row.created_at);
    if (!Number.isFinite(start) || !Number.isFinite(created) || created >= start) continue;
    if (!groups.has(row.match_id)) groups.set(row.match_id, {id:row.match_id,start,name:row.match_name || row.match_id,league:row.league || '',rows:[]});
    groups.get(row.match_id).rows.push({...row, method:row.source.split('-').at(-1)});
  }
  return Array.from(groups.values()).sort((a,b) => a.start-b.start || String(a.id).localeCompare(String(b.id)));
}

let recordedMatchRows = [];
function historicalConsistencyNote(rows) {
  const state=rows.find(row=>row.consistency?.state==='conflict')?.consistency?.state;
  return state ? '<p class="alert-box alert-warn"><strong>Geçmiş yöntem kayıtları birbiriyle çelişiyor.</strong> Resmî ve ön izleme seçimlerinin hepsi birlikte tutamaz. Aşağıdaki kayıtlar değiştirilmedi; eski kayıplar başarı hesabında korunur.</p>' : '';
}
let recordedLoading = false;
function initRecordedMatchCards(panel) {
  if (document.getElementById('recorded-match-cards')) return;
  const section = document.createElement('details'); section.id = 'recorded-match-cards';
  section.innerHTML = `<summary>Bugün ve geçmiş günler — kayıtlı tahminlerin sonuçları</summary><p class="muted">Yalnız maç başlamadan kaydedilmiş resmî tekli/ikili/üçlü tahminler. Seçim ve oran sabittir; her seçim ayrı 1.000 TL simülasyonudur. Bekleyen ve eksik skorlar zarar sayılmaz, iptal/iade neti sıfırdır. Yöntemler aynı maçları içerebilir; bağımsız kazanç gibi toplamayın.</p><label>Maç günü <input type="date" id="recorded-match-day"></label> <button type="button" class="btn btn-secondary" id="recorded-match-refresh">Sonuçları yenile</button><p id="recorded-match-status" role="status"></p><div id="recorded-match-list"></div>`;
  panel.append(section);
  const date = document.getElementById('recorded-match-day');
  date.value = date.max = matchDayTR(Date.now());
  date.addEventListener('change', drawRecordedMatchCards);
  document.getElementById('recorded-match-refresh').addEventListener('click', loadRecordedMatchCards);
  section.addEventListener('toggle', () => { if (section.open) loadRecordedMatchCards(); });
}

async function loadRecordedMatchCards() {
  if (recordedLoading) return;
  recordedLoading = true;
  const status = document.getElementById('recorded-match-status');
  status.textContent = 'Kayıtlı sonuçlar güncelleniyor…';
  try {
    const data = await getJSON('/api/predictions/history');
    recordedMatchRows = data.daily_predictions || [];
    document.getElementById('recorded-match-day').max = matchDayTR(Date.now());
    drawRecordedMatchCards();
    status.textContent = `Son kontrol: ${liveTime(data.generated_at)} · Sonuçlar sağlayıcıya ulaşınca güncellenir; bu ekran yeni tahmin üretmez.`;
  } catch (error) {
    status.textContent = 'Sonuçlar yenilenemedi; varsa önceki görünüm korunuyor: ' + error.message;
  } finally { recordedLoading = false; }
}

function drawRecordedMatchCards() {
  const groups = groupRecordedMatches(recordedMatchRows, document.getElementById('recorded-match-day').value);
  const list = document.getElementById('recorded-match-list');
  const money = value => value == null ? '—' : Number(value).toLocaleString('tr-TR', {maximumFractionDigits:2}) + ' TL';
  const labels = {won:'Tuttu',lost:'Tutmadı',pending:'Bekliyor',missing:'Eksik skor',void:'İptal / iade'};
  const outcomeLabel = row => String(row.settled_phase || '').startsWith('Çakışma:') ? 'Çelişki nedeniyle kaldırıldı' : (labels[row.outcome] || 'Bilinmeyen durum');
  list.innerHTML = groups.map(group => `<article class="daily-match-card"><header><div><h3>${escapeHTML(group.name)}</h3><span>${escapeHTML(group.league)} · ${escapeHTML(liveTime(new Date(group.start).toISOString()))}</span></div></header>${historicalConsistencyNote(group.rows)}<div class="daily-method-grid">${[['1li','Tekli'],['2li','İkili'],['3li','Üçlü']].map(([method,label]) => {
    const picks = group.rows.filter(r => r.method === method);
    return `<section class="daily-method"><h4>${label} — kayıtlı tahmin</h4>${picks.map(r => `<p><strong>${escapeHTML(r.market || r.market_key)} · ${escapeHTML(r.selection)}</strong></p><p>Sabit oran: <span class="odds-value">${Number(r.price).toFixed(2)}</span><br>Kayıt: ${escapeHTML(liveTime(r.created_at))}</p><p><strong>${outcomeLabel(r)}</strong><br>İY: ${escapeHTML(r.half_score || '—')} · MS: ${escapeHTML(r.score || '—')}</p><p>Bahis: ${money(r.stake)}<br>Geri dönüş: ${money(r.gross_return)}<br><strong>Net sonuç: ${money(r.net_profit)}</strong></p>`).join('') || '<p class="muted">Bu yöntem için maç öncesi resmî kayıt yok. Geriye dönük tahmin üretilmez.</p>'}</section>`;
  }).join('')}</div></article>`).join('') || '<p class="empty-state">Bu güne ait doğrulanmış resmî tahmin kaydı yok. Geçmiş tahminler sonradan oluşturulmaz.</p>';
}

function recommendationValueCheck(row) {
  const valid = x => typeof x === 'number' && Number.isFinite(x);
  if (!valid(row.price) || row.price <= 1 || !valid(row.hit_pct) || row.hit_pct < 0 || row.hit_pct > 100 || !valid(row.sample) || row.sample < 1) {
    return {breakEvenPct:null, status:'unknown', message:'Kârlılık karşılaştırması için yeterli veri yok.'};
  }
  const breakEvenPct = 100 / row.price;
  if (row.hit_pct < breakEvenPct) return {breakEvenPct, status:'below_break_even', message:'Geçmiş gerçekleşme başa baş eşiğinin altında. Bu sıklık sürerse bu oran zarar getirir.'};
  if (!valid(row.confidence) || row.confidence < 0 || row.confidence > 100) return {breakEvenPct, status:'unknown', message:'Belirsizlik sınırı yok; kârlılık desteği değerlendirilemiyor.'};
  if (row.confidence <= breakEvenPct) return {breakEvenPct, status:'uncertain', message:'Geçmiş yüzde yeterli görünse de güven alt sınırı başa başı karşılamıyor.'};
  return {breakEvenPct, status:'unconfirmed', message:'Geçmiş veride kârlılık payı görünüyor; ileriye dönük kârlılık henüz doğrulanmış değil.'};
}

function drawDailyMatchCards() {
  const list = document.getElementById('daily-match-list');
  const opened = new Set(Array.from(list.querySelectorAll('details[open]')).map(d => d.dataset.key));
  const scopedRows = document.getElementById('daily-match-scope').value === 'ten' ? dailyMatchRows.filter(r => r.selected_ten) : dailyMatchRows;
  const groups = groupDailyMatches(scopedRows, document.getElementById('daily-match-day').value, document.getElementById('daily-match-league').value);
  document.getElementById('daily-match-count').textContent = `${groups.length} maç · ${groups.reduce((n,g) => n+g.rows.length,0)} öneri`;
  list.replaceChildren();
  if (!groups.length) {
    list.innerHTML = '<p class="empty-state">Bu filtrede yaklaşan resmî öneri yok. Yarın veya Tüm yaklaşanlar seçeneğini deneyebilirsin.</p>';
    return;
  }
  for (const group of groups) {
    const card = document.createElement('article'); card.className = 'daily-match-card';
    card.innerHTML = `<header><div><h3>${escapeHTML(group.name)}</h3><span>${escapeHTML(group.league)} · ${escapeHTML(liveTime(new Date(group.start).toISOString()))}</span></div><button type="button" class="btn btn-secondary">Tüm oranları gör</button></header><div class="daily-method-grid"></div>`;
    card.querySelector('button').addEventListener('click', () => openOddsModal(group.id));
    const grid = card.querySelector('.daily-method-grid');
    for (const [method,label] of [['1li','Tekli'],['2li','İkili'],['3li','Üçlü']]) {
      const cell = document.createElement('section'); cell.className = 'daily-method';
      const picks = group.rows.filter(r => r.method === method);
      cell.innerHTML = `<h4>${label} oran analizi</h4>`;
      if (!picks.length) cell.innerHTML += '<p class="muted">Bu yöntemde resmî öneri yok.</p>';
      for (const row of picks) {
        const quoteAt = row.verified_at || row.captured_at;
        const age = Date.now()-Date.parse(quoteAt);
        const fresh = Number.isFinite(age) && age >= 0 && age <= 6*3600000;
        const block = document.createElement('div');
        block.innerHTML = `<p><strong>${escapeHTML(row.market)} · ${escapeHTML(row.selection)}</strong> <span class="odds-value">${Number(row.price).toFixed(2)}</span></p><p>${Number(row.sample)} geçmiş maç · Geçmiş gerçekleşme %${fmt(row.hit_pct)}<br>Güven alt sınırı %${fmt(row.confidence)} · ${escapeHTML(row.risk_level || 'Belirsiz')} risk</p><p class="muted">${fresh ? 'Son kontrol' : 'Güncellik uyarısı'}: ${escapeHTML(liveTime(quoteAt))}</p>`;
        const value = recommendationValueCheck(row);
        const valueNote = document.createElement('p');
        valueNote.className = 'muted';
        valueNote.dataset.valueStatus = value.status;
        valueNote.textContent = (value.breakEvenPct == null ? '' : `Bu oranın başa baş tutma oranı: %${value.breakEvenPct.toLocaleString('tr-TR',{maximumFractionDigits:2})}. `) + value.message + ' Geçmiş yüzde, kalibre edilmiş kazanma olasılığı değildir.';
        block.append(valueNote);
        const details = document.createElement('details');
        details.dataset.key = JSON.stringify([group.id,method,row.market_key,row.selection]);
        const title = document.createElement('summary'); title.textContent = 'Gerekçe ve geçmiş maçlar';
        const content = document.createElement('div'); details.append(title,content);
        let loaded = false;
        const fill = () => {
          if (details.open && !loaded) {
            content.innerHTML = (row.explanation || []).map(t => `<p>${escapeHTML(t)}</p>`).join('') + recommendationHistoryHTML(row);
            loaded = true;
          }
        };
        details.addEventListener('toggle', fill);
        if (opened.has(details.dataset.key)) { details.open = true; fill(); }
        block.append(details); cell.append(block);
      }
      grid.append(cell);
    }
    list.append(card);
  }
}

if (typeof document !== 'undefined') setInterval(() => {
  if (document.getElementById('recorded-match-cards')?.open &&
      document.getElementById('tab-analysis')?.classList.contains('active') &&
      !document.getElementById('analysis-panel-recommendations')?.hidden) loadRecordedMatchCards();
}, 60000);
if (typeof module !== 'undefined') module.exports = {groupDailyMatches, groupRecordedMatches, matchDayTR, recommendationValueCheck};
