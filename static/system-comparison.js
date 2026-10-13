(() => {
  const card=document.getElementById('system-comparison-card'); if(!card)return;
  const from=document.getElementById('system-date-from'),to=document.getElementById('system-date-to');
  const tabs=document.getElementById('system-method-tabs'),panel=document.getElementById('system-method-panel');
  const status=document.getElementById('system-comparison-status'),badge=document.getElementById('system-comparison-default');
  const iso=d=>d.toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'});
  const today=new Date(),yesterday=new Date(today.getTime()-86400000); from.value=iso(yesterday);to.value=iso(today);
  const esc=value=>escapeHTML(value==null?'—':String(value));
  const pct=value=>value==null?'—':'%'+Number(value).toLocaleString('tr-TR',{maximumFractionDigits:1});
  const money=value=>(Number(value)>0?'+':'')+Number(value||0).toLocaleString('tr-TR',{maximumFractionDigits:2})+' TL';
  const score=(half,full)=>'<span class="score-pair">İY: '+esc(half)+'<br>MS: '+esc(full)+'</span>';
  let data=null,selected=null,busy=false,userSelected=false;
  function renderPanel(){
    const system=data.systems.find(row=>row.id===selected); if(!system)return;
    tabs.querySelectorAll('button').forEach(button=>{const active=button.dataset.system===selected;button.setAttribute('aria-selected',String(active));button.classList.toggle('active',active)});
    const summary='<div class="system-summary-grid"><div><span>Sonuçlanan</span><strong>'+system.settled+'</strong></div><div><span>Tuttu / Tutmadı</span><strong>'+system.won+' / '+system.lost+'</strong></div><div><span>Başarı</span><strong>'+pct(system.hit_pct)+'</strong></div><div><span>Net</span><strong>'+money(system.net_profit)+'</strong></div><div><span>ROI</span><strong>'+pct(system.roi_pct)+'</strong></div><div><span>Bekleyen / Eksik</span><strong>'+system.pending+' / '+system.missing+'</strong></div></div>';
    const rows=system.rows.length?system.rows.map(row=>'<tr><td>'+esc(row.day)+'<br><small>'+esc(row.kickoff_at?liveTime(row.kickoff_at):'—')+'</small></td><td><strong>'+esc(row.match)+'</strong></td><td>'+esc(row.selection)+'</td><td>'+esc(row.price)+'</td><td>'+score(row.half_score,row.score)+'</td><td><strong>'+esc(row.outcome==='won'?'Tuttu':row.outcome==='lost'?'Tutmadı':row.outcome==='void'?'İptal':row.outcome==='missing'?'Eksik':'Bekliyor')+'</strong></td><td>'+((row.outcome==='won'||row.outcome==='lost')?money(row.net):'—')+'</td></tr>').join(''):'<tr><td colspan="7">Bu aralıkta kilitli kayıt yok.</td></tr>';
    panel.innerHTML=summary+'<div class="table-responsive"><table class="data-table"><thead><tr><th>Gün / Başlama</th><th>Maç</th><th>Seçim</th><th>Oran</th><th>İY / MS</th><th>Sonuç</th><th>Net</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }
  function render(){
    badge.textContent='Varsayılan: '+data.systems.find(row=>row.id===data.default_system).label;
    status.textContent=data.date_from+' – '+data.date_to+' · '+data.default_reason+' '+data.rules.settlement;
    tabs.innerHTML=data.systems.map(system=>'<button type="button" role="tab" data-system="'+esc(system.id)+'"><span>'+esc(system.label)+'</span><small>'+system.settled+' sonuç · '+pct(system.hit_pct)+'</small></button>').join('');
    tabs.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.system;userSelected=true;renderPanel()}));
    if(!userSelected||!data.systems.some(row=>row.id===selected))selected=data.default_system;
    renderPanel();
  }
  async function load(){
    if(busy)return;busy=true;status.textContent='Son iki günün kilitli kayıtları ölçülüyor…';
    try{data=await getJSON('/api/predictions/system-comparison?date_from='+encodeURIComponent(from.value)+'&date_to='+encodeURIComponent(to.value));render()}
    catch(error){status.textContent='Karşılaştırma yüklenemedi: '+error.message;panel.innerHTML='<p class="alert-box alert-error">Rapor alınamadı.</p>'}
    finally{busy=false}
  }
  document.getElementById('system-comparison-refresh').addEventListener('click',load);
  document.addEventListener('analysis-subtab-change',event=>{if(event.detail==='systems'&&!data)load()});
  getJSON('/api/telegram/status').then(value=>{document.getElementById('telegram-notification-status').textContent='Telegram: '+value.message+(value.chat_id?' · Hedef: '+value.chat_id:'')}).catch(error=>{document.getElementById('telegram-notification-status').textContent='Telegram durumu okunamadı: '+error.message});
  load();
})();
