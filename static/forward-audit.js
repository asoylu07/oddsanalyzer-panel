async function loadForwardAudit() {
  const box=document.getElementById('forward-audit-results');
  const scope=document.getElementById('forward-audit-scope').value;
  const cohort=document.getElementById('forward-audit-cohort').value;
  box.textContent='İleri takip yükleniyor…';
  try {
    const data=await getJSON('/api/predictions/forward-audit?scope='+scope+'&cohort='+cohort);
    if(document.getElementById('forward-audit-scope').value!==scope || document.getElementById('forward-audit-cohort').value!==cohort) return;
    const e=escapeHTML, money=n=>Number(n).toLocaleString('tr-TR')+' TL';
    const table=(title,rows)=>'<h3>'+title+'</h3><div class="table-responsive"><table class="data-table"><thead><tr><th>Grup</th><th>Maç / seçim</th><th>Tuttu</th><th>Tutmadı</th><th>Bekleyen / eksik / iade</th><th>Başarı</th><th>Net</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+e(r.label)+'</td><td>'+r.matches+' / '+r.selections+'</td><td>'+r.won+'</td><td>'+r.lost+'</td><td>'+r.pending+' / '+r.missing+' / '+r.void+'</td><td>'+(r.hit_pct==null?'—':'%'+r.hit_pct)+'</td><td>'+money(r.net)+'</td></tr>').join('')+'</tbody></table></div>';
    const labels={won:'Tuttu',lost:'Tutmadı',pending:'Bekliyor',missing:'Eksik skor',void:'İade'};
    box.innerHTML='<p><strong>'+data.completed_matches+' / '+data.target+' farklı maç tamamlandı</strong> · '+data.remaining_matches+' maç kaldı · '+data.summary.matches+' kayıtlı maç</p><p class="muted">'+e(data.note)+'</p>'+
      table('Yöntemler',data.methods)+
      '<details open><summary>Aynı maçlarda MS favorisi karşılaştırması</summary><p>Favori, tahmin anındaki aynı Mackolik kaydından seçilir; beraberlik de adaydır. Favori oranı eksik maçlar iki taraftan da çıkarılır. İki taraf için seçim başına 1.000 TL.</p>'+data.comparisons.map(r=>table(r.method+' · Eksik favori: '+r.excluded,[{label:'Sistem',...r.system},{label:'Basit MS favorisi',...r.favorite}])).join('')+'</details>'+
      '<details><summary>Kayıp ve başarı kırılımları</summary><p>Bu gruplar kayıpların nedenini kanıtlamaz; henüz yeni filtre uygulanmaz. Aynı maç farklı yöntemlerde bulunabilir.</p>'+Object.entries(data.breakdowns).map(([k,v])=>table(({quote_age:'Oran doğrulama yaşı',price_band:'Oran aralığı',draw_group:'Beraberlik',league:'Lig',signal_direction:'Sinyal yönü'})[k],v)).join('')+'</details>'+
      '<details><summary>Lig bazında sonuçlar</summary>'+table('Ligler',data.leagues)+'</details>'+
      '<details><summary>Market bazında sonuçlar</summary>'+table('Marketler',data.markets)+'</details>'+
      '<details open><summary>Tüm kilitli tahminler ve İY/MS skorları</summary><div class="table-responsive"><table class="data-table"><thead><tr><th>Başlama / Maç / Lig</th><th>Yöntem / seçim</th><th>Oran</th><th>Geçmiş</th><th>İY</th><th>MS</th><th>Sonuç</th><th>Net</th></tr></thead><tbody>'+
      data.rows.map(r=>'<tr><td>'+e(liveTime(r.kickoff_at_utc||r.kickoff_at))+'<br>'+e(r.match_name)+'<br><small>'+e(r.league)+'</small></td><td>'+e(r.method)+' · '+e(r.market)+' · '+e(r.selection)+'</td><td>'+Number(r.price).toFixed(2)+'</td><td>'+r.sample+' maç · %'+r.hit_pct+'</td><td>'+e(r.half_score||'—')+'</td><td>'+e(r.full_score||'—')+'</td><td>'+e(labels[r.outcome]||r.outcome)+'</td><td>'+(r.net_profit==null?'—':money(r.net_profit))+'</td></tr>').join('')+
      '</tbody></table></div></details>';
  } catch(error) { box.textContent='Takip alınamadı: '+error.message; }
}
document.getElementById('forward-audit-scope').addEventListener('change',loadForwardAudit);
document.getElementById('forward-audit-cohort').addEventListener('change',loadForwardAudit);
document.getElementById('forward-audit-refresh').addEventListener('click',loadForwardAudit);
if (!document.getElementById('analysis-panel-forward').hidden) loadForwardAudit();
document.addEventListener('analysis-subtab-change',event=>{if(event.detail==='forward') loadForwardAudit();});
setInterval(()=>{if(document.getElementById('tab-analysis').classList.contains('active') && !document.getElementById('analysis-panel-forward').hidden) loadForwardAudit();},60000);

