(() => {
  'use strict';
  const date = document.getElementById('fs-pred-date');
  const today = () => new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'});
  const num = n => n == null ? '—' : Number(n).toLocaleString('tr-TR',{maximumFractionDigits:2});
  const money = n => n == null ? '—' : Number(n).toLocaleString('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:0});
  const label = value => ({won:'Tuttu',lost:'Tutmadı',pending:'Sonuç bekleniyor'}[value] || '—');
  date.value=today();
  let timer=null, sequence=0, busy=false;
  async function refresh() {
    if (busy) return;
    busy=true;
    const request=++sequence, day=date.value;
    const status=document.getElementById('fs-pred-status');
    status.textContent='Flashscore tahmin günlüğü yükleniyor…';
    try {
      const response=await fetch(`/api/predictions/flashscore?date=${encodeURIComponent(day)}`,{signal:AbortSignal.timeout(60000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data=await response.json();
      if (request!==sequence || date.value!==day) return;
      const w=data.worker, s=data.summary;
      status.textContent=`Yalnız Flashscore / 1xBet · Uygun maç öncesi geçmiş: ${w.history_matches} maç / ${w.history_days} gün · Son kontrol: ${liveTime(w.last_completed_at)}${w.error ? ' · Hata: '+w.error : ''}`;
      const note=w.history_matches<data.rules.min_sample ? 'Flashscore geçmişi henüz yetersiz; Mackolik verisiyle doldurulmaz.' : 'En az 25 benzer maç aranır; farklı gün sayısı şartı uygulanmaz. Son 6 gün mevcut veritabanından geriye dönük hesaplanır.';
      document.getElementById('fs-pred-summary').innerHTML=`<div class="daily-method"><strong>Flashscore · İleriye dönük başarı</strong><p>${s.picks} resmî tahmin · ${s.approved_candidates || 0} ölçütleri geçen hesaplanmış aday · ${s.nearest_candidates || 0} toplam hesaplanmış aday · ${s.won} tuttu / ${s.lost} tutmadı · ${s.hit_pct==null ? 'Başarı henüz hesaplanamaz' : '%'+num(s.hit_pct)}<br>1.000 TL / yalnız resmî seçim net: ${money(s.net_tl)}</p><p>${escapeHTML(note)}</p></div>`;
      document.getElementById('fs-pred-body').innerHTML=data.rows.length ? data.rows.map(row => {
        const official=row.pick, p=official || row.candidate, e=row.evaluation;
        const decision=official ? '<strong class="success">Resmî ileri tahmin · Sistem onayladı</strong>' : p ? `<strong class="${p.approved ? 'success' : 'danger'}">${escapeHTML(p.approval_label)}</strong>${p.rejection_reasons?.length ? `<br><small>${escapeHTML(p.rejection_reasons.join(' · '))}</small>` : '<br><small>25+ benzer maç ve temkinli avantaj koşulu sağlandı.</small>'}` : escapeHTML(row.reason);
        return `<tr><td><strong>${escapeHTML(row.match_name)}</strong><br>${escapeHTML(row.league)}<br>${escapeHTML(liveTime(row.kickoff_at_utc))}</td><td>${p ? `<strong>MS ${escapeHTML(p.selection)}</strong><br><small>Flashscore / 1xBet${official ? `<br>Sabit kayıt: ${escapeHTML(liveTime(row.created_at))}` : ''}</small><br>${decision}` : decision}</td><td>${p ? `${num(p.opening)} → <strong>${num(p.price)}</strong>` : '—'}</td><td>${p ? `${p.delta>0 ? '+' : ''}${num(p.delta)}<br>${p.sample} geçmiş maç / ${p.days} gün<br>Geçmiş gerçekleşme: %${num(p.historical_hit_pct)}<br><small>Güven alt sınırı: %${num(p.confidence_low)} · Başabaş: %${num(p.breakeven_pct)} · Fark: ${p.confidence_gap_pct>0?'+':''}%${num(p.confidence_gap_pct)}</small>` : '—'}</td><td>${MatchScores.html(row.ht_score ?? e?.ht_score,row.display_score ?? e?.score,row.match_status)}</td><td>${official ? `${label(e?.outcome)}<br>${money(e?.net_tl)}` : p ? 'Onaysız aday' : '—'}</td></tr>`;
      }).join('') : '<tr><td colspan="6">Bu tarihte Flashscore kapsamında oynanabilir maç veya kayıtlı tahmin yok.</td></tr>';
      await refreshHybrid(day,request);
    } catch(error) {
      if (request===sequence) {
        status.textContent=`Flashscore kayıtları alınamadı: ${error.message}`;
        document.getElementById('fs-pred-summary').textContent='Güncel durum doğrulanamadı.';
        document.getElementById('fs-pred-body').innerHTML='<tr><td colspan="6">Güncel veri alınamadı; önceki tablo temizlendi.</td></tr>';
      }
    } finally {
      busy=false;
    }
  }
  async function refreshHybrid(day,request) {
    const status=document.getElementById('fs-hybrid-status'),body=document.getElementById('fs-hybrid-body');
    try {
      const response=await fetch(`/api/predictions/fs-mackolik-hybrid?date=${encodeURIComponent(day)}`,{signal:AbortSignal.timeout(60000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data=await response.json();if(request!==sequence||date.value!==day)return;
      status.textContent=`${data.history_matches} tamamlanmış FS maçıyla ham sinyal · ${data.warning}`;
      body.innerHTML=data.rows.length?data.rows.map(row=>`<tr><td><strong>${escapeHTML(row.match_name)}</strong><br>${escapeHTML(liveTime(row.kickoff_at_utc))}<br>${MatchScores.html(null,null,"scheduled")}</td><td>${row.signal?`<strong>FS MS ${escapeHTML(row.signal.selection)}</strong><br>${num(row.signal.opening)} → ${num(row.signal.price)} (${row.signal.delta>0?'+':''}${num(row.signal.delta)})<br><small>${row.signal.sample} benzer seçim · değer puanı ${num(row.signal.value_score)}</small>`:escapeHTML(row.reason||'Sinyal yok')}</td><td>${row.candidates?.length?row.candidates.map(c=>`<p><strong>${escapeHTML(c.market)} · ${num(c.price)}</strong><br><small>${escapeHTML(c.role)} · ${escapeHTML(c.status)}</small></p>`).join(''):escapeHTML(row.reason||'Mackolik adayı yok')}</td><td><strong>Sinyal:</strong> FS / 1xBet<br><strong>Oran:</strong> Mackolik / İddaa${row.candidates?.[0]?`<br><small>Mackolik kayıt: ${escapeHTML(liveTime(row.candidates[0].mackolik_captured_at))}</small>`:''}</td></tr>`).join(''):'<tr><td colspan="4">Bu tarihte maç öncesi FS ham sinyali üretilebilen karşılaşma yok.</td></tr>';
    } catch(error) {if(request===sequence){status.textContent='Hibrit araştırma alınamadı: '+error.message;body.innerHTML='<tr><td colspan="4">Güncel veri alınamadı.</td></tr>';}}
  }
  document.addEventListener('companion-tab-change',event => {
    if (timer) {clearInterval(timer);timer=null;}
    if (event.detail==='tab-flashscore') {refresh();timer=setInterval(refresh,60000);}
  });
  date.addEventListener('change',refresh);
  document.getElementById('fs-pred-refresh').addEventListener('click',refresh);
  document.getElementById('fs-pred-today').addEventListener('click',()=>{date.value=today();refresh();});
})();
