(()=>{
const host=document.getElementById('paper-validation');
const esc=x=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=x=>typeof x==='number'?x.toLocaleString('tr-TR',{maximumFractionDigits:2}):'—';
const score=x=>Array.isArray(x)&&x.every(v=>v!==null&&v!==undefined)?x.join('–'):'—';
const table=(heads,rows)=>'<div class="scroll"><table><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
async function load(){try{
const response=await fetch('/api/paper-validation');if(!response.ok)throw new Error('HTTP '+response.status);
const data=await response.json();if(data.status!=='ok'){host.textContent='Takip hazır değil: '+(data.error||data.reason||data.status);return;}
let html='<p>Doğrulama başlangıcı: '+esc(new Date(data.protocol.started_at).toLocaleString('tr-TR'))+' · Son kontrol: '+esc(new Date(data.updated_at).toLocaleString('tr-TR'))+'</p><p>'+esc(data.scope)+'</p>';
html+=table(['Sistem / sürüm','Sonuçlanan / 300','Tuttu / Yattı','Bekleyen','Tutma %','Net TL (1.000 TL/seçim)','Getiri %','Kalan maç','Kalan gün','Sonuçlanan gün / 30','Alt sınır %','Telegram durumu'],data.systems.map(s=>[s.name+' · '+s.version,s.settled+' / 300',s.won+' / '+s.lost,s.pending,num(s.hit_pct),num(s.net_tl),num(s.roi_pct),s.matches_remaining,s.days_remaining,s.active_days+' / 30',num(s.roi_lower_pct),s.review_candidate?'İncelemeye aday · gönderim kapalı':'Sanal test · gönderim kapalı']));
for(const s of data.systems){html+='<details><summary>'+esc(s.name)+' · eksikler ve son 100 sanal kayıt</summary><p>Sürüm: '+esc(s.version)+' · Model: '+esc(s.model||'Günlükte model özeti yok')+'</p>'+table(['Ölçüt','Mevcut','Hedef','Durum'],s.checks.map(c=>[c.label,Array.isArray(c.current)?c.current.map(num).join(' / '):typeof c.current==='number'?num(c.current):c.current,c.target,c.passed?'Tamam':'Bekliyor']))+table(['Maç','Başlangıç','Market','Seçim','Oran','İY','MS','Sonuç','Net TL'],s.records.map(r=>[r.match_name,new Date(r.kickoff_at_utc).toLocaleString('tr-TR'),r.market,r.selection,num(r.price),score(r.ht_score),score(r.ft_score),({won:'Tuttu',lost:'Tutmadı',void:'İade',pending:'Bekliyor',missing:'Sonuç eksik'})[r.outcome],r.outcome==='pending'||r.outcome==='missing'?'—':num(r.net_tl)]))+'</details>';}
html+='<p class="warning">'+esc(data.limitations)+'</p><p>Hesaba alınmayan kayıtlar: '+esc(JSON.stringify(data.excluded))+'</p>';host.innerHTML=html;
}catch(e){host.textContent='Sanal takip alınamadı: '+e.message;}}
load();setInterval(load,60000);
})();
