(() => {
 const date=document.getElementById('htft-pair-date');
 date.value=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'});
 let busy=false;
 const e=escapeHTML;
 async function load(){
  if(busy)return;busy=true;const day=date.value;
  try{
   const d=await getJSON('/api/predictions/htft-pairs?date='+encodeURIComponent(day));
   if(date.value!==day)return;
   document.getElementById('htft-pair-state').textContent=(d.state.error?'Tarama hatası: '+d.state.error:d.state.running?'Tarama çalışıyor…':'Son tarama: '+liveTime(d.scan_at))+' · FS geçmiş: '+(d.history_matches??'—')+' · Kayıt: '+d.rows.length;
   const section=(label,rows)=>{
    const done=rows.filter(r=>r.net!=null),won=done.filter(r=>r.outcome==='Tuttu').length;
    const money=v=>v==null?'—':v.toLocaleString('tr-TR',{maximumFractionDigits:2})+' TL';
    const sum=(rs,key)=>rs.reduce((n,r)=>n+(r[key]??0),0);
    const summary='<p>Sabit bahis simülasyonu: seçim başına 1.000 TL · Toplam bahis: '+money(sum(rows,'stake'))+' · Sonuçlanan bahis: '+money(sum(done,'stake'))+' · Bekleyen bahis: '+money(sum(rows.filter(r=>r.net==null),'stake'))+' · Sonuçlanan geri dönüş: '+money(sum(done,'gross_return'))+'</p>';
    const table='<div class="table-responsive"><table class="data-table"><thead><tr><th>Maç / başlangıç</th><th>Durum / dakika</th><th>FS sinyali / value</th><th>İki seçim</th><th>Oran kayıt zamanları</th><th>İY / MS skoru</th><th>Gerçek İY/MS / tutan seçim</th><th>Sonuç</th><th>Bahis / geri dönüş / net</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+e(r.match)+'<br>'+e(liveTime(r.kickoff_at_utc))+'</td><td>'+e(r.phase)+(r.minute?'<br>'+e(r.minute)+"′":'')+(r.stale?'<br>Güncelliği doğrulanamadı':'')+'<br>Kontrol: '+e(liveTime(r.collected_at))+'</td><td>MS '+e(r.fs_signal?.selection)+' · '+e(r.fs_signal?.value_score)+'</td><td>'+r.picks.map(p=>e(p.selection.replaceAll('0','X'))+' · '+e(p.price)).join('<br>')+'</td><td>FS: '+e(liveTime(r.fs_captured_at))+'<br>Mackolik: '+e(liveTime(r.mackolik_captured_at))+'<br>Kayıt: '+e(liveTime(r.created_at))+'</td><td>İY: '+e(r.ht)+'<br>'+(r.status==='finished'?'MS: ':'Güncel: ')+e(r.ft)+'</td><td>'+e(r.actual?.replaceAll('0','X')??'—')+'<br>Tutan: '+e(r.winning_selection?.replaceAll('0','X')??'—')+'</td><td>'+e(r.outcome)+'</td><td>Bahis: '+money(r.stake)+'<br>Geri dönüş: '+money(r.gross_return)+'<br>Net: '+money(r.net)+'</td></tr>').join('')+'</tbody></table></div>';
    return '<h3>'+label+'</h3><p>'+rows.length+' kayıt · '+won+' tuttu / '+(done.length-won)+' tutmadı · '+(rows.length-done.length)+' bekliyor · '+(done.length?'%'+(100*won/done.length).toLocaleString('tr-TR',{maximumFractionDigits:1}):'Başarı: —')+' · Sonuçlanan net: '+money(sum(done,'net'))+'</p>'+summary+table;
   };
   document.getElementById('htft-pair-content').innerHTML=section('Maç öncesi kilitli — ileri takip',d.rows.filter(r=>r.mode==='prematch'))+section('Canlıyken üretilen inceleme — ileri test değil',d.rows.filter(r=>r.mode==='live_review'))+'<details><summary>Koşulları sağlamayanlar ('+d.rejected.length+')</summary>'+d.rejected.map(r=>'<p>'+e(r.match)+' · '+e(r.reason)+(r.fs_signal?' · value '+e(r.fs_signal.value_score):'')+'</p>').join('')+'</details>';
  }catch(err){document.getElementById('htft-pair-state').textContent='Alınamadı: '+err.message}finally{busy=false;if(date.value!==day)load()}
 }
 date.addEventListener('change',load);document.getElementById('htft-pair-refresh').addEventListener('click',load);
 document.addEventListener('companion-tab-change',ev=>{if(ev.detail==='tab-htft-pairs')load()});
 setInterval(()=>{if(document.getElementById('tab-htft-pairs').classList.contains('active'))load()},15000);
 if(location.hash==='#htft-pairs')load();
})();
