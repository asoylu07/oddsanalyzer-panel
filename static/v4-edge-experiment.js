(() => {
  'use strict';
  const el = id => document.getElementById(id);
  if (!el('v4-edge-status')) return;
  const esc = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('tr-TR', {maximumFractionDigits: 2}) : '—';
  const time = value => value ? new Date(value).toLocaleString('tr-TR', {timeZone: 'Europe/Istanbul'}) : '—';
  const method = value => ({all:'Tüm V4 kayıtları', 'main-v4-1li':'Tek koşullu', 'main-v4-2li':'İki koşullu', 'main-v4-3li':'Üç koşullu'}[value] || value);
  const reason = value => ({positive:'Deneye alındı · avantaj > 0',nonpositive:'Elendi · avantaj ≤ 0',missing_edge:'Elendi · avantaj eksik / geçersiz'}[value] || value);
  const outcomes = {won:'Tuttu',lost:'Tutmadı',pending:'Bekliyor',missing:'Sonuç verisi eksik',void:'İptal / iade'};
  const table = (heads, rows) => '<table><thead><tr>' + heads.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(cell => '<td>' + esc(cell) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const metrics = s => [s.total,s.settled,s.unique_matches,s.won,s.lost,s.pending,s.missing,s.void,num(s.hit_pct),num(s.net_tl),num(s.roi_pct)];
  function render(data) {
    el('v4-edge-status').textContent = 'Başlangıç: ' + time(data.started_at) + ' · Son kontrol: ' + time(data.updated_at) + ' · Durum: ' + (data.status || 'starting') + (data.error ? ' · ' + data.error : '');
    if (!data.groups?.length) {
      el('v4-edge-comparison').textContent = 'Deney hazırlanıyor; sonuçlanmamış gruplara başarı yüzdesi yazılmaz.';
      return;
    }
    const heads = ['V4 yöntemi','Kol','Kayıt','Sonuçlanan seçim','Farklı maç','Tuttu','Tutmadı','Bekleyen','Eksik sonuç','İade','Tutma %','Sanal net TL','Getiri %'];
    const rows = data.groups.flatMap(group => [[method(group.source),'Mevcut V4 · aynı dönem',...metrics(group.baseline)], [method(group.source),'Deney · temkinli avantaj > 0',...metrics(group.positive_edge)]]);
    el('v4-edge-comparison').innerHTML = table(heads, rows);
    el('v4-edge-excluded').innerHTML = table(['V4 yöntemi',...heads.slice(2)], data.groups.map(group => [method(group.source),...metrics(group.excluded)]));
    const all = data.groups.find(group => group.source === 'all');
    const capture = data.capture || {};
    el('v4-edge-capture').textContent = (data.recorded ? 'Gözlenen kayıt: ' + data.recorded : 'Henüz yeni uygun V4 kaydı gözlenmedi.') + ' · Deney kapsamı: ' + num(all?.coverage_pct) + '%' + ' · Başlamış / zaman koşulu sağlanmamış yeni kaynak kaydı: ' + (capture.missed_or_not_prospective || 0) + ' · Geçersiz / onaysız: ' + (capture.invalid_or_unapproved || 0) + ' · Web aktarımı yaklaşık 6 dakika; kaynak kontrol zamanı yukarıda gösterilir.';
    el('v4-edge-records').innerHTML = data.records?.length ? table(['Maç','V4 yöntemi','Başlangıç (TR)','Market','Seçim','Oran','Temkinli avantaj (puan)','Filtre kararı','Sonuç','Sanal net TL'], [...data.records].reverse().map(row => [row.match_name,method(row.source),time(row.kickoff_at_utc),row.market,row.selection,num(row.price),num(row.conservative_edge_pct),reason(row.filter_reason),outcomes[row.outcome] || row.outcome,num(row.net_tl)])) : '<p>İlk yeni kayıt bekleniyor.</p>';
  }
  let busy = false;
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch('/api/v4-edge-experiment', {cache:'no-store'});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      render(await response.json());
    } catch (error) {
      el('v4-edge-status').textContent = 'Deney güncellenemedi: ' + error.message + '. Önceki tablonun kontrol zamanını dikkate alın.';
    } finally { busy = false; }
  }
  refresh();
  setInterval(refresh, 15000);
})();
