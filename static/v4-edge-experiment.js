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
  let studyStamp = '';
  function renderStudy(study) {
    if (!study || !el('v4-filter-study') || studyStamp === study.updated_at + study.frozen_sha256) return;
    const scopeName = id => ({approved:'V4 onay eşiklerini geçen',research:'Geniş araştırma · reddedilen adaylar dahil',sample25:'Araştırma · yalnız örneği ≥ 25 olan adaylar'}[id] || id);
    const familyName = value => { if (!value.includes('|')) return value; const [kind,period,side]=value.split('|'); return ({'1X2':'Maç sonucu','DC':'Çifte şans','ODD_EVEN':'Tek/Çift','OU':'Alt/Üst','TEAM_OU':'Takım Alt/Üst','BTTS':'Karşılıklı gol','HANDICAP_1X2':'Handikap sonucu','RESULT_OU':'Sonuç ve Alt/Üst','MOST_GOALS_HALF':'En çok gol olan yarı'}[kind] || kind) + ' · ' + ({FT:'Tam maç',HT:'İlk yarı',SH:'İkinci yarı'}[period] || period) + (side ? ' · ' + ({HOME:'Ev sahibi',AWAY:'Deplasman'}[side] || side) : ''); };
    const lossTable = rows => table(['Grup','Sonuç','Farklı maç','Tuttu','Tutmadı','Tutma %','Net TL','Getiri %','Örnek durumu'], rows.map(r => [familyName(r.label),r.settled,r.unique_matches,r.won,r.lost,num(r.hit_pct),num(r.net_tl),num(r.roi_pct),r.unique_matches<30?'30 maçtan az':'En az 30 maç']));
    const filterTable = rows => table(['Ayrı filtre','Tüm sonuç','Tüm tutma %','Tüm net TL','Tüm getiri %','İlk bölüm sonuç','İlk getiri %','Son bölüm sonuç','Son farklı maç','Son tutma %','Son net TL','Son getiri %','Son getiri farkı (puan)','Son kapsam %','Elenen son net TL','Değerlendirme'],rows.map(e => {
      const a=e.periods.all.included, f=e.periods.first.included, l=e.periods.later.included, p=e.periods.later;
      return [e.label,a.settled,num(a.hit_pct),num(a.net_tl),num(a.roi_pct),f.settled,num(f.roi_pct),l.settled,l.unique_matches,num(l.hit_pct),num(l.net_tl),num(l.roi_pct),num(p.roi_delta_pp),num(p.coverage_pct),num(p.excluded.net_tl),e.status];
    }));
    const sections = study.scopes.map(s => {
      const trust=s.experiments.find(e=>e.id==='trust70');
      const cap=s.experiments.find(e=>e.id==='odds140180');
      return '<details ' + (s.id==='approved'?'open':'') + '><summary>' + esc(scopeName(s.id)) + ' · ' + num(s.total.settled) + ' sonuç · getiri %' + num(s.total.roi_pct) + '</summary><p>İlk bölüm: ' + num(s.first.settled) + ' sonuç. Son bölüm: ' + num(s.later.settled) + ' sonuç. Aynı seçimi yöntemler arasında tekilleştirince: ' + num(s.deduplicated.settled) + ' sonuç, getiri %' + num(s.deduplicated.roi_pct) + '.</p><p><strong>1,40–1,79 oran filtresi: son bölüm ' + num(cap.periods.later.included.settled) + ' sonuç, getiri %' + num(cap.periods.later.included.roi_pct) + '. Güven ≥70: son bölüm ' + num(trust.periods.later.included.settled) + ' sonuç, getiri %' + num(trust.periods.later.included.roi_pct) + '.</strong></p><h3>Ayrı filtre deneyleri · kontrol satırına göre karşılaştır</h3><div class="scroll">' + filterTable(s.experiments) + '</div><h3>Kaybettiren marketler · tüm dönem, net zarara göre</h3><div class="scroll">' + lossTable(s.losses.market) + '</div><h3>Oran aralıkları · tüm dönem</h3><div class="scroll">' + lossTable(s.losses.odds_band) + '</div><details><summary>Son tarih bölümünün market aileleri ve oranları</summary><div class="scroll">' + lossTable(s.later_losses.family) + lossTable(s.later_losses.odds_band) + '</div></details><details><summary>İlk bölümden öğrenilen filtrelerin eleme grupları</summary><p>Market aileleri: ' + esc(s.learned_exclusions.family.map(familyName).join(', ') || 'Yeterli örnekli zarar grubu yok') + '</p><p>Oran aralıkları: ' + esc(s.learned_exclusions.odds_band.join(', ') || 'Yeterli örnekli zarar grubu yok') + '</p><p>Öğrenmede aynı maç / seçim / oran tekilleştirilir. En az 30 farklı sonuçlanmış maç ve getiri −%10’un altında şartı; sonraki bölüm kurala katılmaz.</p></details><details><summary>Filtrelerin V4 yöntemlerine göre toplam sonucu</summary><div class="scroll">' + table(['Filtre','Yöntem','Sonuç','Tutma %','Net TL','Getiri %'],s.experiments.flatMap(e=>e.by_method.map(m=>[e.label,method(m.source),m.settled,num(m.hit_pct),num(m.net_tl),num(m.roi_pct)]))) + '</div></details></details>';
    }).join('');
    el('v4-filter-study').innerHTML='<h2>V4 · Kaybettiren gruplar ve ayrı filtre deneyleri</h2><p>' + esc(study.note) + '</p><p><strong>İlk bölüm: ' + esc(study.period.start) + ' ≤ tarih < ' + esc(study.cutoff) + '. Son bölüm: ' + esc(study.cutoff) + '–' + esc(study.period.end) + '.</strong> 19 satır: filtresiz kontrol ve 18 ayrı filtre. Her seçim 1.000 TL sanal birim. Rapor: ' + time(study.updated_at) + '.</p><p>Toplam netin daha az eksi olması tek başına iyileşme değildir; kalan farklı maç, getiri yüzdesi ve sonraki dönem birlikte değerlendirilir. Araştırmada iki dönemde yeterli örnekle artıda olmak bile canlı başarı kanıtı değildir.</p>' + sections + '<hr>';
    studyStamp=study.updated_at + study.frozen_sha256;
  }
  function render(data) {
    renderStudy(data.filter_study);
    if (data.replay && el('v4-edge-replay')) {
      const r = data.replay;
      const heads = ['V4 yöntemi','Kol','Kayıt','Sonuçlanan seçim','Farklı maç','Tuttu','Tutmadı','Bekleyen','Eksik sonuç','İade','Tutma %','Sanal net TL','Getiri %'];
      const comparison = groups => table(heads, groups.flatMap(g => [[method(g.source),'Filtresiz',...metrics(g.baseline)],[method(g.source),'Temkinli avantaj > 0',...metrics(g.positive_edge)],[method(g.source),'Elenenler',...metrics(g.excluded)]]));
      const a = r.groups.find(g => g.source === 'all');
      const b = r.research_groups.find(g => g.source === 'all');
      const brief = (label,g) => '<p><strong>' + esc(label) + ': ' + num(g.baseline.settled) + ' sonuç · tutma %' + num(g.baseline.hit_pct) + ' · net ' + num(g.baseline.net_tl) + ' TL · getiri %' + num(g.baseline.roi_pct) + '. Filtreli: ' + num(g.positive_edge.settled) + ' sonuç · tutma %' + num(g.positive_edge.hit_pct) + ' · net ' + num(g.positive_edge.net_tl) + ' TL · getiri %' + num(g.positive_edge.roi_pct) + '.</strong></p>';
      el('v4-edge-replay').innerHTML = '<h2>V4 yeniden çalıştırma · geçmiş maç öncesi veriler</h2><p>' + esc(r.note) + '</p><p>Tarihsel Nesine bülteni üyeliği doğrulanmadı; kapsam, maç öncesi Mackolik oran arşividir.</p><p>Hesap: ' + time(r.updated_at) + ' · Model: ' + esc(r.model_version) + ' · Hedef maç: ' + num(r.counts.target_matches) + ' · İşlenen: ' + num(r.counts.processed) + ' · Oranı 6 saatten eski: ' + num(r.counts.stale_over_6h || 0) + ' · 1.000 TL sanal birim.</p>' + brief('Onay eşiklerini geçen',a) + brief('Geniş araştırma adayları',b) + '<p>Geniş adayların ' + num(r.counts.below_min_sample) + ' tanesinde benzer maç örneği 25’ten az; ' + num(r.counts.zero_sample) + ' tanesinde sıfır. Bu adaylar V4 üretim eşiğini geçmez.</p><p>Geniş araştırma, örneklem / başarı / oran eşikleri yüzünden reddedilen V4 adaylarını da içerir. Canlı onaylı sistem sonucu olarak okunmaz. Her yöntem maç başına ilk adayını seçer; filtre aynı adayın alt kümesidir, yerine başka seçim aranmaz. Aynı maç yöntemler arasında tekrarlanabilir.</p><h3>Onay eşiklerini geçen seçimler</h3><div class="scroll">' + comparison(r.groups) + '</div><h3>Geniş araştırma · reddedilen adaylar dahil</h3><div class="scroll">' + comparison(r.research_groups) + '</div><details><summary>Günlük sonuçlar · onay eşikleri geçen</summary><div class="scroll">' + table(['Gün','Sonuç','Tutma %','Net TL','Getiri %','Filtreli sonuç','Filtreli tutma %','Filtreli net TL','Filtreli getiri %'],r.by_day.map(d => [d.day,d.baseline.settled,num(d.baseline.hit_pct),num(d.baseline.net_tl),num(d.baseline.roi_pct),d.positive_edge.settled,num(d.positive_edge.hit_pct),num(d.positive_edge.net_tl),num(d.positive_edge.roi_pct)])) + '</div></details><details><summary>Yeniden üretilen son 300 araştırma adayı · maç, seçim ve sonuç</summary><div class="scroll">' + table(['Maç','Yöntem','Market','Seçim','Oran','Örnek','V4 onayı','Avantaj','Filtre','Sonuç','Net TL'],[...r.research_records].reverse().map(p => [p.match_name,method(p.source),p.market,p.selection,num(p.price),p.sample,p.approval_status,num(p.conservative_edge_pct),reason(p.filter_reason),outcomes[p.outcome],num(p.net_tl)])) + '</div></details><hr>';
    }
    if (data.historical && el('v4-edge-history')) {
      const h = data.historical;
      const heads = ['V4 yöntemi','Kol','Kayıt','Sonuçlanan seçim','Farklı maç','Tuttu','Tutmadı','Bekleyen','Eksik sonuç','İade','Tutma %','Sanal net TL','Getiri %'];
      const total = h.groups.find(g => g.source === 'all');
      const verdict = total ? '<p><strong>Geçmiş V4: ' + esc(total.baseline.settled) + ' sonuç · tutma %' + num(total.baseline.hit_pct) + ' · net ' + num(total.baseline.net_tl) + ' TL. Pozitif avantaj: ' + esc(total.positive_edge.settled) + ' sonuç · net ' + num(total.positive_edge.net_tl) + ' TL.</strong> Tek veya az sayıda seçim başarı kanıtı sayılmaz.</p>' : '';
      const rows = h.groups.flatMap(g => [[method(g.source),'Geçmiş V4',...metrics(g.baseline)], [method(g.source),'Geçmiş · avantaj > 0',...metrics(g.positive_edge)], [method(g.source),'Filtrenin elediği',...metrics(g.excluded)]]);
      el('v4-edge-history').innerHTML = '<h2>Eski kayıtlı V4 tahminleri · arşiv karşılaştırması</h2><p>' + esc(h.note) + '</p>' + verdict + '<p>Arşiv: ' + esc(h.recorded) + ' kayıt · Zaman / onay koşulunu sağlamayan: ' + esc(h.capture.invalid_or_after_kickoff || 0) + ' · Her seçim 1.000 TL sanal birim. Farklı yöntemlerde aynı maç bulunabilir.</p><div class="scroll">' + table(heads, rows) + '</div><details><summary>Geçmiş seçimler ve sonuçları</summary><div class="scroll">' + table(['Maç','Yöntem','Market','Seçim','Oran','Avantaj','Filtre','Sonuç','Net TL'], [...h.records].reverse().map(r => [r.match_name,method(r.source),r.market,r.selection,num(r.price),num(r.conservative_edge_pct),reason(r.filter_reason),outcomes[r.outcome],num(r.net_tl)])) + '</div></details>';
    }
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
