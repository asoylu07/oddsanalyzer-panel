(() => {
  const date = document.getElementById('daily-top3-date');
  if (!date) return;
  const today = () => new Date().toLocaleDateString('sv-SE', {timeZone: 'Europe/Istanbul'});
  const esc = value => escapeHTML(value == null || value === '' ? '—' : String(value));
  const money = value => (Number(value) > 0 ? '+' : '') + Number(value || 0).toLocaleString('tr-TR') + ' TL';
  const pct = value => value == null ? '—' : '%' + Number(value).toLocaleString('tr-TR', {maximumFractionDigits: 1});
  const odds = value => value == null ? '—' : Number(value).toLocaleString('tr-TR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const oddsTiming = row => {
    const usedAt = row.odds_quote_state === 'final'
      ? (row.final_odds_checked_at || row.verified_at || row.captured_at)
      : row.captured_at;
    const kickoff = Date.parse(row.kickoff_at_utc || '');
    const captured = Date.parse(usedAt || '');
    if (!Number.isFinite(kickoff) || !Number.isFinite(captured) || captured >= kickoff) return '';
    const minutes = Math.max(0, Math.round((kickoff - captured) / 60000));
    return `Maçın başlamasına ${minutes} dk kala son oran çekildi.`;
  };
  const evidence = value => value && value.sample
    ? `${value.sample} maç · ${pct(value.pct)}` : 'Yeterli örnek yok';

  const mainBody = document.getElementById('daily-top3-body');
  const mainTable = mainBody.closest('.table-responsive');
  let tabs = document.getElementById('daily-top3-method-tabs');
  if (!tabs) {
    tabs = document.createElement('div');
    tabs.id = 'daily-top3-method-tabs';
    tabs.className = 'system-method-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.innerHTML = [
      ['1li', 'Tek koşullu'], ['2li', 'İki koşullu'], ['3li', 'Üç koşullu']
    ].map(([key, label]) => `<button type="button" data-method="${key}" class="system-method-tab">${label}</button>`).join('');
    mainTable.insertAdjacentElement('beforebegin', tabs);
  }

  let otherSection = document.getElementById('daily-top3-other-section');
  if (!otherSection) {
    otherSection = document.createElement('div');
    otherSection.id = 'daily-top3-other-section';
    otherSection.style.marginTop = '28px';
    otherSection.innerHTML = `
      <h3>Diğer Ligler · Aynı Yöntemin 3 Adayı</h3>
      <p class="muted">Seçili 10 lig dışında kalan adaylar aynı onay kurallarıyla değerlendirilir.</p>
      <p id="daily-top3-other-status">Henüz yüklenmedi.</p>
      <div class="table-responsive"><table class="data-table">
        <thead><tr><th>#</th><th>Maç / Lig</th><th>Seçim</th><th>Oran / Hareket</th><th>Kanıt / Değer</th><th>Durum / Skor</th><th>Karar</th></tr></thead>
        <tbody id="daily-top3-other-body"><tr><td colspan="7">Henüz yüklenmedi.</td></tr></tbody>
      </table></div>`;
    mainTable.insertAdjacentElement('afterend', otherSection);
  }

  const otherBody = document.getElementById('daily-top3-other-body');
  const otherStatus = document.getElementById('daily-top3-other-status');
  date.value = today();
  let busy = false;
  let activeMethod = '1li';
  let lastData = null;

  function statusClass(row) {
    return row.approval_status === 'approved' ? 'success' : row.approval_status === 'provisional' ? 'warning' : 'danger';
  }

  function phaseText(row) {
    if (row.phase === 'live') {
      const minute = row.match_minute == null ? 'Canlı' : `${row.minute_estimated ? '≈' : ''}${row.match_minute}'`;
      return `${minute} · Canlı skor: ${esc(row.display_score)}`;
    }
    if (row.phase === 'finished') {
      return `İY: ${esc(row.ht_score)}<br>Maç sonu: ${esc(row.display_score)}`;
    }
    return 'Başlamadı';
  }

  function detail(row) {
    const ev = row.evidence || {};
    const risks = (row.rejection_reasons || []).length
      ? row.rejection_reasons.join(' ') : 'Kapanış doğrulamasındaki koşullar korunursa ek engel yok.';
    const rejected = (row.why_others_rejected || []).map(value => `<li>${esc(value)}</li>`).join('');
    return `
      <div class="prediction-audit-detail">
        <p><strong>Neden bu market seçildi?</strong> ${esc(row.why_selected || 'Eski kayıtta ayrıntılı seçim gerekçesi saklanmamış.')}</p>
        <p><strong>Diğer marketler neden elendi?</strong></p><ul>${rejected || '<li>Karşılaştırma bilgisi yok.</li>'}</ul>
        <p><strong>İlk oran ve son maç önü oranı:</strong> ${odds(row.first_price)} → ${odds(row.last_price || row.price)}
          · <strong>Oran hareketi:</strong> ${esc(row.movement)} ${row.absolute_change == null ? '' : `(${Number(row.absolute_change) > 0 ? '+' : ''}${odds(row.absolute_change)})`}</p>
        <p><strong>Oranın ima ettiği başabaş ihtimali:</strong> ${pct(row.breakeven_pct)}
          · <strong>Geçmiş gerçekleşme:</strong> ${pct(row.hit_pct)}
          · <strong>Güven yüzdesi:</strong> ${pct(row.trust_score)} (${esc(row.trust_label)})
          · <strong>Piyasa avantajı:</strong> ${pct(row.observed_edge_pct)}</p>
        <p><strong>Aynı market/seçim/oran grubu:</strong> ${esc(row.sample)} maç
          · <strong>Aynı lig:</strong> ${esc(evidence(ev.same_league))}</p>
        <p><strong>${esc(row.home_team)} iç saha profili:</strong> ${esc(evidence(ev.home_profile))}
          · <strong>${esc(row.away_team)} deplasman profili:</strong> ${esc(evidence(ev.away_profile))}</p>
        <p><strong>Kullanılan oran:</strong> ${esc(row.odds_notice || 'Kapanış oranı bilgisi eski kayıtta tutulmamış.')}${oddsTiming(row) ? `<br>${esc(oddsTiming(row))}` : ''}</p>
        <p><strong>Tahmin zamanı:</strong> ${esc(row.captured_at)}
          · <strong>Son doğrulama:</strong> ${esc(row.verified_at)}</p>
        <p><strong>Riskler / geçersiz kılabilecek koşullar:</strong> ${esc(risks)}</p>
        <p class="muted">Gösterilen yüzde maç önü tarihsel kanıttır; canlı kazanma ihtimali değildir.</p>
      </div>`;
  }

  function renderRows(body, rows, emptyText) {
    const rendered = rows.map((row, index) => {
      const outcome = row.outcome === 'won' ? 'Tuttu' : row.outcome === 'lost' ? 'Tutmadı' : 'Bekliyor';
      const result = row.outcome === 'won' || row.outcome === 'lost' ? `<br>${money(row.net_profit)}` : '';
      const movement = row.movement ? `${esc(row.movement)}${row.absolute_change == null ? '' : ` · ${odds(row.absolute_change)}`}` : 'Hareket ölçülemedi';
      const oddsNotice = row.odds_fallback_used
        ? `<br><small class="danger">⚠ Son oran çekilemedi; eldeki son kayıt kullanıldı.${oddsTiming(row) ? ` ${esc(oddsTiming(row))}` : ''}</small>`
        : row.odds_quote_state === 'final'
          ? `<br><small class="success">Son oran kontrol edildi.${oddsTiming(row) ? ` ${esc(oddsTiming(row))}` : ''}</small>` : '';
      const detailId = `${body.id}-detail-${index}`;
      return `
        <tr>
          <td><strong>${index + 1}</strong></td>
          <td><strong>${esc(row.match_name)}</strong><br><small>${esc(row.league)} · ${esc(liveTime(row.kickoff_at_utc))}</small></td>
          <td>${esc(row.market)} · <strong>${esc(row.selection)}</strong></td>
          <td><strong>${odds(row.price)}</strong><br><small>${movement}</small>${oddsNotice}</td>
          <td>${esc(row.sample)} maç · ${pct(row.hit_pct)}<br><small>Güven ${pct(row.trust_score)} (${esc(row.trust_label)}) · başabaş ${pct(row.breakeven_pct)} · avantaj ${pct(row.observed_edge_pct)}</small></td>
          <td>${phaseText(row)}<br><small>${outcome}${result}</small></td>
          <td><strong class="${statusClass(row)}">${esc(row.approval_label)}</strong><br><button type="button" class="btn btn-secondary btn-sm daily-detail-toggle" data-target="${detailId}">Açıklamaları göster</button></td>
        </tr>
        <tr id="${detailId}" class="prediction-detail-row" hidden><td colspan="7">${detail(row)}</td></tr>`;
    }).join('');
    const missing = rows.length < 3
      ? `<tr><td colspan="7"><strong>${3 - rows.length} aday kaydı eksik:</strong> Bu yöntem için maç başlamadan önce kaydedilmiş başka aday bulunamadı. Bu boşluk başarı yüzdesini yüksek göstermek için oluşturulmadı.</td></tr>`
      : '';
    body.innerHTML = rendered || missing || `<tr><td colspan="7">${esc(emptyText)}</td></tr>`;
    if (rendered && missing) body.insertAdjacentHTML('beforeend', missing);
    body.querySelectorAll('.daily-detail-toggle').forEach(button => button.addEventListener('click', () => {
      const detailRow = document.getElementById(button.dataset.target);
      if (!detailRow) return;
      detailRow.hidden = !detailRow.hidden;
      button.textContent = detailRow.hidden ? 'Açıklamaları göster' : 'Açıklamaları gizle';
    }));
  }

  function summaryText(day, summary) {
    summary = summary || {};
    return `${day} · ${summary.shown || 0} aday · ${summary.approved || 0} onaylı · ${summary.provisional || 0} kapanış bekliyor · ${summary.rejected || 0} onaysız`;
  }

  function render() {
    if (!lastData) return;
    const group = (lastData.methods || {})[activeMethod] || {rows: [], other_rows: [], summary: {}, other_summary: {}};
    document.querySelectorAll('#daily-top3-method-tabs [data-method]').forEach(button => {
      button.classList.toggle('active', button.dataset.method === activeMethod);
      button.setAttribute('aria-selected', button.dataset.method === activeMethod ? 'true' : 'false');
    });
    renderRows(mainBody, group.rows || [], 'Bu yöntemde seçili 10 lig için aday bulunamadı.');
    renderRows(otherBody, group.other_rows || [], 'Bu yöntemde diğer ligler için aday bulunamadı.');
    document.getElementById('daily-top3-status').textContent = `${group.label || activeMethod} · ${summaryText(lastData.date, group.summary)}`;
    otherStatus.textContent = `${group.label || activeMethod} · ${summaryText(lastData.date, group.other_summary)}`;
  }

  async function load() {
    if (busy) return;
    busy = true;
    const day = date.value;
    document.getElementById('daily-top3-status').textContent = 'Adaylar kendi oran gruplarıyla yeniden ölçülüyor…';
    otherStatus.textContent = 'Diğer lig adayları ölçülüyor…';
    try {
      const data = await getJSON('/api/predictions/daily-top3?date=' + encodeURIComponent(day));
      if (date.value !== day) return;
      lastData = data;
      const activeRows = ((data.methods || {})[activeMethod] || {}).rows || [];
      if (!activeRows.length) {
        const methodWithRows = ['1li', '2li', '3li'].find(key =>
          ((((data.methods || {})[key] || {}).rows) || []).length
        );
        if (methodWithRows) activeMethod = methodWithRows;
      }
      render();
    } catch (error) {
      document.getElementById('daily-top3-status').textContent = 'Rapor yüklenemedi: ' + error.message;
      otherStatus.textContent = 'Rapor yüklenemedi: ' + error.message;
      mainBody.innerHTML = '<tr><td colspan="7">Rapor alınamadı.</td></tr>';
      otherBody.innerHTML = '<tr><td colspan="7">Rapor alınamadı.</td></tr>';
    } finally {
      busy = false;
      if (date.value !== day) load();
    }
  }

  tabs.addEventListener('click', event => {
    const button = event.target.closest('[data-method]');
    if (!button) return;
    activeMethod = button.dataset.method;
    render();
  });
  date.addEventListener('change', load);
  document.getElementById('daily-top3-today').addEventListener('click', () => { date.value = today(); load(); });
  document.getElementById('daily-top3-refresh').addEventListener('click', load);
  document.addEventListener('analysis-subtab-change', event => { if (event.detail === 'top3') load(); });
  setInterval(() => {
    if (document.getElementById('tab-analysis')?.classList.contains('active')
        && !document.getElementById('analysis-panel-top3')?.hidden) load();
  }, 60000);
})();
