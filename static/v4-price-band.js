(() => {
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const score=a=>!a||a.some(v=>v==null)?'—':a.join('–');
const time=v=>v?new Date(v).toLocaleString('tr-TR'):'—';
async function load(){try{
 const response=await fetch('/api/v4-price-band',{cache:'no-store'});if(!response.ok)throw Error(response.status);
 const d=await response.json(),s=d.summary||{};
 document.getElementById('status').textContent='Durum: '+d.status+' · Başlangıç: '+time(d.started_at)+' · Son kontrol: '+time(d.updated_at)+(d.error?' · Hata: '+d.error:'');
 document.getElementById('summary').innerHTML='<p>Kalıcı kayıt: '+esc(d.recorded||0)+' · Sonuçlanan: '+esc(s.settled||0)+' · Tuttu: '+esc(s.won||0)+' · Yattı: '+esc(s.lost||0)+' · Bekleyen: '+esc(s.pending||0)+' · İade: '+esc(s.void||0)+' · Sonuç eksik: '+esc(s.missing||0)+' · Tutma: '+esc(s.hit_pct==null?'—':'%'+s.hit_pct)+' · Net: '+esc(s.net_tl||0)+' TL · ROI: '+esc(s.roi_pct==null?'—':'%'+s.roi_pct)+'</p>';
 const pr=d.preview||{},diag=pr.source_diagnostics||{},collector=d.collector||{};
 document.getElementById('preview-status').textContent='Ana tarama: '+(pr.status||'hazırlanıyor')+' · Son tarama: '+time(pr.source_updated_at)+' · Sonraki tarama: '+time(pr.worker?.next_check_at)+' · Kayıt hatası: '+(pr.worker?.record_errors?.length||0)+' · Maç: '+(diag.total_matches??'—')+' · Veri uygun: '+(diag.eligible_matches??'—')+' · Eski oran: '+(diag.stale_quotes??'—')+' · Zaman nedeniyle elenen: '+(diag.invalid_time??'—')+(pr.error?' · Hata: '+pr.error:'')+' · Toplayıcı son bildirim: '+time(collector.heartbeat_at_utc)+' · Hız durumu: '+(collector.CURRENT_RATE_MODE||'—')+' · Son yeni oran: '+time(collector.odds?.last_data_update_utc)+' · Son HTTP: '+(collector.LAST_HTTP_STATUS||'—')+' · Yeniden deneme: '+time(collector.NEXT_RETRY_AT);
 const previewTable=(rows,excluded)=>rows.length?'<table><tr><th>Maç / başlangıç</th><th>Yöntem / seçim / oran</th><th>Güven / oran yaşı</th><th>Durum</th></tr>'+rows.map(r=>'<tr>'+[r.match_name+' / '+time(r.kickoff_at_utc),r.method+' / '+r.market+' / '+r.selection+' @'+r.price,r.trust_score+' / '+(r.quote_age_minutes??'—')+' dk',(excluded?r.reasons:r.pending_reasons).join('; ')||(r.approval_status==='approved'?'Onaylı ana aday; kalıcı kayıt ayrıca doğrulanır':'Kapanış onayı bekleyen önizleme')].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</table>':excluded?'Bu aralıkta elenen güncel aday yok.':'Şu an tüm filtre koşullarını sağlayan güncel yaklaşan aday yok.';
 document.getElementById('preview').innerHTML=previewTable(pr.rows||[],false);
 document.getElementById('preview-excluded').innerHTML=previewTable(pr.excluded||[],true);
 document.getElementById('records').innerHTML=(d.records||[]).length?'<table><tr><th>Maç / başlangıç</th><th>Yöntem / seçim / oran</th><th>İY / MS</th><th>Sonuç / net TL</th><th>Kayıt saati / model</th></tr>'+(d.records||[]).slice().reverse().map(r=>'<tr>'+[r.match_name+' / '+time(r.kickoff_at_utc),r.method+' / '+r.market+' / '+r.selection+' @'+r.price,score(r.ht_score)+' / '+score(r.score),({won:'Tuttu',lost:'Yattı',pending:'Bekliyor',void:'İade',missing:'Sonuç eksik'}[r.outcome]||r.outcome)+' / '+(r.net_tl??'—'),time(r.observed_at)+' / '+(r.model_version||'—')].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</table>':'Henüz yeni uygun kalıcı kayıt yok. Eski geçmiş testleri buraya aktarılmaz.';
}catch(e){document.getElementById('status').textContent='Güncellenemedi: '+e.message;}}
load();setInterval(load,15000);
})();
