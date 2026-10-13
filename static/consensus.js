(() => {
 const date=document.getElementById('consensus-date');
 if(!date)return;
 const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'});
 date.value=today(); let busy=false,sortDirection='desc',lastData=null,retryTimer=null;
 const esc=value=>escapeHTML(value==null?'—':String(value));
 const clock=value=>value?liveTime(value):'—';
 const money=value=>value==null?'—':Number(value).toLocaleString('tr-TR',{maximumFractionDigits:2})+' TL';
 function render(data){
   lastData=data;
   const body=document.getElementById('consensus-body');
   const picks=data.rows.filter(row=>row.decision==='pick');
   const settled=picks.filter(row=>row.outcome);
   const won=settled.filter(row=>row.outcome==='Tuttu').length;
   const lost=settled.length-won;
   const stake=settled.reduce((sum,row)=>sum+Number(row.stake||0),0);
   const gross=settled.reduce((sum,row)=>sum+Number(row.gross_return||0),0);
   const net=settled.reduce((sum,row)=>sum+Number(row.net||0),0);
   const rate=settled.length?'%'+(100*won/settled.length).toLocaleString('tr-TR',{maximumFractionDigits:1}):'—';
   document.getElementById('consensus-status').textContent=(data.state.running?'Arka planda güncelleniyor · Son hazır hesaplama: '+clock(data.state.last_completed_at):data.state.error?'Hata: '+data.state.error:'Son hesaplama: '+clock(data.state.last_completed_at))+' · '+data.rows.length+' maç · '+picks.length+' tahmin · '+(data.rows.length-picks.length)+' pas · Sonuçlanan: '+settled.length+' · '+won+' tuttu / '+lost+' tutmadı · Başarı: '+rate+' · Bahis: '+money(stake)+' · Geri dönüş: '+money(gross)+' · Net: '+money(net)+' · Kilitli ileri kayıt: '+data.frozen.length;
   const rows=[...data.rows].sort((a,b)=>{const av=a.confidence==null?-1:Number(a.confidence),bv=b.confidence==null?-1:Number(b.confidence);return sortDirection==='desc'?bv-av:av-bv});
   body.innerHTML=rows.length?rows.map(row=>{
    const votes=(row.votes||[]).map(v=>esc(v.system)+': <strong>'+esc(v.side)+'</strong> · ağırlık '+Number(v.weight).toLocaleString('tr-TR',{minimumFractionDigits:3,maximumFractionDigits:3})).join('<br>')||'Yeterli veri yok';
    const decision=row.decision==='pick'?'<strong>MS '+esc(row.side)+'</strong>':'<span class="muted">PAS</span>';
    const mode=row.mode==='prematch'?'Maç öncesi · kilitlenebilir':'Canlı/geçmiş inceleme · başarıya girmez';
    const result='İY: '+esc(row.ht_score)+'<br>MS: '+esc(row.ft_score)+'<br>'+(row.outcome?'<strong>'+esc(row.outcome)+'</strong> · Net: '+esc(money(row.net)):'<span class="muted">Bekliyor</span>');
    return '<tr><td><strong>'+esc(row.match)+'</strong><br>'+esc(clock(row.kickoff_at_utc))+'</td><td>'+decision+'<br><span class="muted">'+esc(row.reason)+'</span></td><td>'+(row.price?Number(row.price).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—')+'</td><td>'+(row.confidence==null?'—':'%'+Number(row.confidence).toLocaleString('tr-TR',{maximumFractionDigits:1}))+'</td><td>'+votes+'</td><td>'+result+'</td><td>'+esc(mode)+'<br><span class="muted">Mackolik: '+esc(clock(row.mackolik_captured_at))+'<br>FS: '+esc(clock(row.fs_captured_at))+'</span></td></tr>';
   }).join(''):'<tr><td colspan="7">Bu tarihte uygun Mackolik/İddaa maçı yok.</td></tr>';
   const sort=document.getElementById('consensus-sort');if(sort)sort.textContent='Konsensüs '+(sortDirection==='desc'?'↓':'↑');
 }
 async function load(force=false){
  if(busy)return; busy=true; const day=date.value;
  const status=document.getElementById('consensus-status'); const body=document.getElementById('consensus-body');
  status.textContent='Birleşik sistem hesaplanıyor…';
  try{
   const data=await getJSON('/api/predictions/consensus?date='+encodeURIComponent(day)+(force?'&refresh=1':''));
   if(date.value!==day)return;
   render(data);
   if(retryTimer){clearTimeout(retryTimer);retryTimer=null}
   if(data.state.running)retryTimer=setTimeout(()=>load(false),1500);
  }catch(error){status.textContent='Birleşik sistem yüklenemedi: '+error.message;body.innerHTML='<tr><td colspan="7">Rapor alınamadı.</td></tr>'}
  finally{busy=false;if(date.value!==day)load()}
 }
 date.addEventListener('change',load);
 document.getElementById('consensus-today').addEventListener('click',()=>{date.value=today();load()});
 document.getElementById('consensus-refresh').addEventListener('click',()=>load(true));
 document.getElementById('consensus-sort').addEventListener('click',()=>{sortDirection=sortDirection==='desc'?'asc':'desc';if(lastData)render(lastData)});
 const isVisible=()=>document.getElementById('tab-analysis')?.classList.contains('active') && !document.getElementById('analysis-panel-consensus')?.hidden;
 document.addEventListener('analysis-subtab-change',event=>{if(event.detail==='consensus')load()});
 setInterval(()=>{if(isVisible())load()},60000);
 if(location.hash==='#consensus')load();
})();
