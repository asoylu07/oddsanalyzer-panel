(() => {
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const score=a=>!a||a.some(v=>v==null)?'—':a.join('–');
const time=v=>v?new Date(v).toLocaleString('tr-TR'):'—';
async function load(){try{
 const response=await fetch('/api/v4-price-band',{cache:'no-store'});if(!response.ok)throw Error(response.status);
 const d=await response.json(),s=d.summary||{};
 document.getElementById('status').textContent='Durum: '+d.status+' · Başlangıç: '+time(d.started_at)+' · Son kontrol: '+time(d.updated_at)+(d.error?' · Hata: '+d.error:'');
 document.getElementById('summary').innerHTML='<p>Kalıcı kayıt: '+esc(d.recorded||0)+' · Sonuçlanan: '+esc(s.settled||0)+' · Tuttu: '+esc(s.won||0)+' · Yattı: '+esc(s.lost||0)+' · Bekleyen: '+esc(s.pending||0)+' · İade: '+esc(s.void||0)+' · Sonuç eksik: '+esc(s.missing||0)+' · Tutma: '+esc(s.hit_pct==null?'—':'%'+s.hit_pct)+' · Net: '+esc(s.net_tl||0)+' TL · ROI: '+esc(s.roi_pct==null?'—':'%'+s.roi_pct)+'</p>';
 document.getElementById('records').innerHTML=(d.records||[]).length?'<table><tr><th>Maç / başlangıç</th><th>Yöntem / seçim / oran</th><th>İY / MS</th><th>Sonuç / net TL</th><th>Kayıt saati / model</th></tr>'+(d.records||[]).slice().reverse().map(r=>'<tr>'+[r.match_name+' / '+time(r.kickoff_at_utc),r.method+' / '+r.market+' / '+r.selection+' @'+r.price,score(r.ht_score)+' / '+score(r.score),({won:'Tuttu',lost:'Yattı',pending:'Bekliyor',void:'İade',missing:'Sonuç eksik'}[r.outcome]||r.outcome)+' / '+(r.net_tl??'—'),time(r.observed_at)+' / '+(r.model_version||'—')].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</table>':'Henüz yeni uygun kalıcı kayıt yok. Eski geçmiş testleri buraya aktarılmaz.';
}catch(e){document.getElementById('status').textContent='Güncellenemedi: '+e.message;}}
load();setInterval(load,15000);
})();
