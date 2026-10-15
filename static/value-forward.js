(() => {
 const el=id=>document.getElementById(id);
 const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={pending:'Bekliyor',won:'Kazandı',lost:'Kaybetti',void:'İptal'};
 const metric=m=>m?`${esc(m.settled)} sonuç · ${esc(m.won)} kazandı / ${esc(m.lost)} kaybetti · tutma ${m.hit_pct==null?'—':'%'+esc(m.hit_pct)} · net ${esc(m.net_tl)} TL · ROI ${m.roi_pct==null?'—':'%'+esc(m.roi_pct)}`:'Veri yok';
 const table=(rows,preview)=>rows.length?'<div class="scroll"><table><thead><tr><th>Sistem / maç</th><th>Başlama</th><th>Seçim</th><th>Oran / model EV</th><th>İY / MS</th><th>Sonuç / sanal net</th></tr></thead><tbody>'+rows.map(p=>'<tr><td>'+esc(p.system_name)+'<br>'+esc(p.match_name)+'</td><td>'+esc(new Date(p.kickoff_at_utc).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'}))+'</td><td>'+esc(p.market||p.market_key)+' / '+esc(p.selection)+'</td><td>'+esc(p.price)+' / %'+esc((100*p.estimated_ev).toFixed(1))+'</td><td>İY '+esc(p.ht_score)+' / MS '+esc(p.ft_score)+(p.status==='live'?' (canlı)':'')+'</td><td>'+esc(preview?'Önizleme':labels[p.outcome])+'<br>'+esc(p.net_tl)+' TL</td></tr>').join('')+'</tbody></table></div>':'<p>Henüz seçim yok. Bu, %0 tutma veya doğrulanmış kâr anlamına gelmez.</p>';
 async function load(){try{const response=await fetch('/api/weekly-systems');if(!response.ok)throw Error('HTTP '+response.status);const all=await response.json(),d=all.value_forward;if(!d)throw Error('İleri test servisi henüz hazır değil');
 el('status').textContent=`Durum: ${d.status} · Başlangıç: ${d.started_at?new Date(d.started_at).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'}):'—'} · Kontrol edilen gelecek maç: ${d.fixtures_checked??0} · Son kontrol: ${d.updated_at?new Date(d.updated_at).toLocaleTimeString('tr-TR'):'—'}${d.error?' · '+d.error:''}`;
 el('note').textContent=d.note||'';
 el('cards').innerHTML=(d.systems||[]).map(s=>'<article><h2>'+esc(s.name)+'</h2><p>Geçmiş zaman sıralı kontrol: '+metric(s.historical)+'</p><p><strong>Gerçek ileri test:</strong> '+metric(s.forward)+'</p><p>'+esc(s.forward.days)+' farklı sonuç günü · %95 gün bazlı ROI aralığı: '+esc(s.forward.roi_ci95_day_bootstrap?.join(' / '))+'</p><p>'+esc(s.forward_gate_pass?'İnceleme eşiğine ulaştı; otomatik yayına alınmaz.':'Doğrulama bekleniyor; kârlı olduğu kanıtlanmadı.')+'</p></article>').join('');
 el('records').innerHTML=table([...(d.records||[])].reverse(),false);el('preview').innerHTML=table(d.preview||[],true);
 }catch(e){el('status').textContent='Kontrol hatası: '+e.message;}}
 load();setInterval(load,30000);
})();
