(() => {
  const date = document.getElementById('ten-league-date');
  if (!date) return;
  const body = document.getElementById('ten-league-body');
  const status = document.getElementById('ten-league-status');
  const today = () => new Date().toLocaleDateString('sv-SE', {timeZone: 'Europe/Istanbul'});
  const esc = value => escapeHTML(value == null ? '—' : String(value));
  const odds = value => value == null ? '—' : Number(value).toLocaleString('tr-TR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  let busy = false;

  function predictionLine(prediction) {
    const source = String(prediction.source || '');
    const label = source.startsWith('main-v4-') ? 'V4 onaylı' :
      source.startsWith('preview-v4-') ? 'V4 ön izleme' :
      source.startsWith('main-v3-') ? 'Eski sistem' : 'Kayıt';
    return `<div class="ten-league-odds-line"><strong>${esc(prediction.market)} · ${esc(prediction.selection)} · ${odds(prediction.price)}</strong><br><small>${esc(label)} · ${esc(prediction.method)}</small></div>`;
  }

  function render(data) {
    const rows = (data.rows || []).slice().sort((a, b) => String(a.kickoff_at_utc || '').localeCompare(String(b.kickoff_at_utc || '')));
    body.innerHTML = rows.length ? rows.map((row, index) => {
      const predictions = row.predictions || [];
      const score = MatchScores.html(row.half_score,row.score,row.status);
      return `<tr>
        <td><strong>${index + 1}</strong></td>
        <td><strong>${esc(row.match_name)}</strong><br><small>${esc(row.competition_name)}</small></td>
        <td>${esc(liveTime(row.kickoff_at_utc))}</td>
        <td>${esc(row.phase)}<br><small>${score}${row.minute ? ` · ${esc(row.minute)}` : ''}</small></td>
        <td>${predictions.length ? predictions.map(predictionLine).join('') : '<span class="muted">Henüz kaydedilmiş seçim yok.</span>'}</td>
        <td><button type="button" class="btn btn-action btn-sm ten-league-odds" data-id="${esc(row.match_id)}">Oranları göster</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="6">Bu tarihte seçili 10 lig/turnuvada maç bulunamadı.</td></tr>';
    status.textContent = `${data.date} · ${rows.length} maç · Canlı ${(data.counts || {}).live || 0} · Başlamayan ${(data.counts || {}).scheduled || 0} · Biten ${(data.counts || {}).finished || 0}`;
    body.querySelectorAll('.ten-league-odds').forEach(button => button.addEventListener('click', () => openOddsModal(button.dataset.id)));
  }

  async function load() {
    if (busy) return;
    busy = true;
    const day = date.value || today();
    date.value = day;
    status.textContent = '10 lig maçları yükleniyor…';
    try {
      const data = await getJSON(`/api/live-matches?playable_only=1&date=${encodeURIComponent(day)}`);
      if (date.value === day) render(data);
    } catch (error) {
      status.textContent = `10 lig maçları alınamadı: ${error.message}`;
      body.innerHTML = '<tr><td colspan="6">Rapor alınamadı.</td></tr>';
    } finally {
      busy = false;
    }
  }

  date.value = today();
  date.addEventListener('change', load);
  document.getElementById('ten-league-today').addEventListener('click', () => { date.value = today(); load(); });
  document.getElementById('ten-league-refresh').addEventListener('click', load);
  document.addEventListener('analysis-subtab-change', event => { if (event.detail === 'ten-leagues') load(); });
  setInterval(() => {
    if (document.getElementById('analysis-panel-ten-leagues') && !document.getElementById('analysis-panel-ten-leagues').hidden) load();
  }, 60000);
})();
