(() => {
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function load(){try{const d=await (await fetch('/api/analysis-lifecycle')).json();const archived=document.body.dataset.archive==='yes';
document.getElementById('active').innerHTML=archived?'':d.active.map((name,i)=>'<article><h2>'+esc(name)+'</h2><p><a href="'+(i===0?'/ahmet-council':i<4?'/v4-nesine-paper':'/v4-edge-experiment')+'">Tahminler, tutma oranı ve kâr zarar</a></p></article>').join('');
document.getElementById('archive').innerHTML=archived?'<p><a href="/ahmet-analyses">Arşiv ayrıntıları ve eski raporlar</a> · <a href="/ahmet-balanced-v2">Ahmet Dengeli V2</a></p><table><tr><th>Sistem</th><th>Kayıt türü</th><th>Tuttu / sonuç</th><th>Tutma</th><th>Sanal net TL</th></tr>'+d.archived.map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+esc(r.category)+'</td><td>'+esc(r.won)+' / '+esc(r.settled)+'</td><td>'+esc(r.hit_pct==null?'—':'%'+r.hit_pct)+'</td><td>'+esc(r.net_tl)+'</td></tr>').join('')+'</table>':'';
}catch(e){document.getElementById('active').textContent='Yüklenemedi: '+e.message;}}
load();setInterval(load,30000);
})();