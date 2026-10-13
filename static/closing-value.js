(() => {
  const date = document.getElementById('closing-value-date');
  if (!date) return;
  const today = () => new Date().toLocaleDateString('sv-SE', {timeZone: 'Europe/Istanbul'});
  const esc = value => escapeHTML(value == null ? '—' : String(value));
  const pct = value => value == null ? '—' : '%' + Number(value).toLocaleString('tr-TR', {maximumFractionDigits: 1});
  const metric = (label, value) => {
    const sample = Number(value?.sample || 0);
    return sample ? `${label}: ${sample} maç · ${pct(value.pct)}` : `${label}: veri yok`;
  };
  date.value = today();
  let busy = false;

  async function getReport(day) {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await getJSON('/api/predictions/closing-value?date=' + encodeURIComponent(day));
      } catch (error) {
        lastError = error;
        const transient = /503|meşgul|kilitli/i.test(String(error?.message || ''));
        if (!transient || attempt === 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
    }
    throw lastError;
  }

  function details(row) {
    const context = row.context_evidence || {};
    const reasons = row.value_reasons?.length
      ? row.value_reasons.map(reason => `<li>${esc(reason)}</li>`).join('')
      : '<li>Tüm kapanış değeri kontrolleri olumlu.</li>';
    return `<details class="candidate-explanation"><summary>Hesabı göster</summary>
      <ul>${reasons}</ul>
      <p>${esc(metric('Aynı lig', context.same_league))}<br>${esc(metric('Ev sahibi profili', context.home_profile))}<br>${esc(metric('Deplasman profili', context.away_profile))}</p>
      <p>İlk oran: ${esc(row.first_price)} · Son maç önü oranı: ${esc(row.last_price || row.price)} · Hareket katkısı: ${pct(row.movement_adjustment_pct)}</p>
      <p>İleri test: ${esc(row.forward_settled)} sonuç · ROI ${pct(row.forward_roi_pct)} · Kalibrasyon katkısı ${pct(row.forward_adjustment_pct)}</p>
    </details>`;
  }

  function renderRow(row, index) {
    const movement = row.movement || 'Hareket ölçülmedi';
    const phase = row.phase === 'live' ? `Canlı${row.match_minute == null ? '' : ' · ' + esc(row.match_minute) + "'"}` :
      row.phase === 'finished' ? 'Bitti' : 'Başlamadı';
    const statusClass = row.value_status === 'approved' ? 'ok' : ['cautious', 'provisional'].includes(row.value_status) ? 'warn' : 'bad';
    return `<tr>
      <td><strong>${index + 1}</strong></td>
      <td><strong>${esc(row.match_name)}</strong><br><small>${esc(row.league)} · ${esc(liveTime(row.kickoff_at_utc))}</small><br><small>${phase}${row.display_score ? ' · ' + esc(row.display_score) : ''}</small></td>
      <td><strong>${esc(row.market)} · ${esc(row.selection)}</strong><br><span class="price-current">${Number(row.price || 0).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span><br><small>${esc(movement)}${row.absolute_change == null ? '' : ' · ' + (Number(row.absolute_change) > 0 ? '+' : '') + Number(row.absolute_change).toLocaleString('tr-TR')}</small></td>
      <td>Kalibre: <strong>${pct(row.calibrated_probability_pct)}</strong><br><small>Başabaş ${pct(row.breakeven_pct)} · avantaj ${pct(row.calibrated_edge_pct)}</small><br><small>Alt sınır ${pct(row.confidence)} · temkinli avantaj ${pct(row.conservative_edge_pct)}</small></td>
      <td>${esc(row.sample)} maç · ${pct(row.hit_pct)}<br><small>Güven puanı ${pct(row.trust_score)} · Değer puanı ${pct(row.value_score)}</small><br><small>${esc(metric('Aynı lig', row.context_evidence?.same_league))}</small></td>
      <td><span class="pill ${statusClass}">${esc(row.value_label)}</span>${details(row)}</td>
    </tr>`;
  }

  async function load() {
    if (busy) return;
    busy = true;
    const day = date.value;
    const status = document.getElementById('closing-value-status');
    const body = document.getElementById('closing-value-body');
    status.textContent = 'Kapanış değeri adayları hesaplanıyor…';
    try {
      const data = await getReport(day);
      if (date.value !== day) return;
      body.innerHTML = data.rows.length ? data.rows.map(renderRow).join('') : '<tr><td colspan="6">Bu tarihte değerlendirilebilecek aday bulunamadı.</td></tr>';
      const s = data.summary;
      const coverage = s.coverage_rate_pct == null ? '—' : pct(s.coverage_rate_pct);
      status.textContent = `${data.date} · ${s.evaluated ?? s.shown} maç adayı incelendi · en iyi ${s.shown} gösteriliyor · ${s.approved_total ?? s.approved} onaylı · ${s.cautious_total ?? s.cautious ?? 0} temkinli · kapsama ${coverage}`;
    } catch (error) {
      status.textContent = 'Kapanış değeri yüklenemedi: ' + error.message;
      body.innerHTML = '<tr><td colspan="6">Rapor alınamadı.</td></tr>';
    } finally {
      busy = false;
      if (date.value !== day) load();
    }
  }

  date.addEventListener('change', load);
  document.getElementById('closing-value-today').addEventListener('click', () => { date.value = today(); load(); });
  document.getElementById('closing-value-refresh').addEventListener('click', load);
  document.addEventListener('analysis-subtab-change', event => { if (event.detail === 'closing-value') load(); });
})();
