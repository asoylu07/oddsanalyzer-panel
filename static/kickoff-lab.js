(() => {
  'use strict';
  const date = document.getElementById('kickoff-date');
  let interval = null, sequence = 0;
  const localDay = offset => {
    const now = new Date();
    now.setUTCDate(now.getUTCDate() + offset);
    return now.toLocaleDateString('sv-SE', {timeZone:'Europe/Istanbul'});
  };
  const requestedDay = new URLSearchParams(window.location.search).get('kickoff_date');
  date.value = requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) ? requestedDay : localDay(0);
  if (!date.value) date.value = localDay(0);
  const num = v => v == null ? '—' : Number(v).toLocaleString('tr-TR', {minimumFractionDigits:2,maximumFractionDigits:2});
  const money = v => v == null ? '—' : Number(v).toLocaleString('tr-TR', {style:'currency',currency:'TRY',maximumFractionDigits:0});
  const outcome = v => ({won:'Tuttu',lost:'Tutmadı',missing:'Skor eksik',pending:'Sonuç bekleniyor'}[v] || 'Henüz değerlendirilmedi');
  const evidence = p => {
    if (!p) return '';
    return `<strong>${escapeHTML(p.method)} · Puan ${num(p.score)}</strong><br><small>${p.sample} benzer geçmiş maç<br>Kendi oranı: ${p.direct.sample} maç<br>Benzer hareket: ${p.movement_evidence.sample} maç · ${p.movement_used ? 'Hesaba katıldı' : 'Yetersiz, ek ağırlık yok'}<br>Son 15 dk: ${p.last15_evidence.sample} maç · ${p.last15_used ? 'Hesaba katıldı' : 'Ek ağırlık yok'}</small>`;
  };
  async function refresh() {
    const requestId = ++sequence;
    const requestedDate = date.value;
    const status = document.getElementById('kickoff-status');
    status.textContent = 'Başlangıç kayıtları yükleniyor…';
    try {
      const response = await fetch(`/api/kickoff-lab?date=${encodeURIComponent(requestedDate)}`, {signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (requestId !== sequence || date.value !== requestedDate) return;
      status.textContent = `${data.rows.length} maç · Son kontrol: ${liveTime(data.worker.last_completed_at)}${data.worker.error ? ' · Deney işçisi: '+data.worker.error : ''}`;
      document.getElementById('kickoff-summary').innerHTML = ['forward','replay'].map(mode => {
        const s = data.summary[mode];
        return `<div class="daily-method"><strong>${mode === 'forward' ? 'Başlangıçta kaydedilen yeni maçlar' : 'Geriye dönük deney'}</strong><p>${s.picks} seçim · ${s.won} tuttu / ${s.lost} tutmadı · ${s.hit_pct == null ? 'Başarı henüz yok' : '%'+num(s.hit_pct)}<br>1.000 TL / seçim net: ${money(s.net_tl)}</p></div>`;
      }).join('');
      document.getElementById('kickoff-body').innerHTML = data.rows.length ? data.rows.map(row => {
        const p = row.primary, e = row.evaluation;
        const label = row.mode === 'replay' ? 'Geriye dönük deney' : row.mode === 'forward' ? 'Başlangıç kaydı' : 'Bekleme / kayıt yok';
        const detail = p ? `<details><summary>Diğer yöntemler ve kayıt</summary><p>Hazırlık: ${escapeHTML(liveTime(row.prepared_at || row.decision_at))}<br>Sabit kayıt: ${escapeHTML(liveTime(row.frozen_at))}<br>Son fiyat: ${escapeHTML(liveTime(p.captured_at))} · Başlangıçtan ${num(p.age_minutes)} dk önce</p>${row.methods.map(m => `<p><strong>${escapeHTML(m.method)}: ${escapeHTML(m.market)} · ${escapeHTML(m.selection)} @${num(m.price)}</strong><br>${evidence(m)}<br>${escapeHTML(outcome(e?.methods?.[m.method]?.outcome))}</p>`).join('')}</details>` : '';
        return `<tr><td><strong>${escapeHTML(row.match_name)}</strong><br>${escapeHTML(liveTime(row.kickoff_at_utc))}<br><span class="selection-tag">${label}</span></td><td>${p ? `<strong>${escapeHTML(p.market)} · ${escapeHTML(p.selection)}</strong>${detail}` : escapeHTML(row.reason || 'Seçim yok')}</td><td>${p ? `${num(p.first_price)} → <strong>${num(p.price)}</strong>` : '—'}</td><td>${p ? `${p.delta == null ? 'Karşılaştırma yok' : (p.delta>0 ? '+' : '')+num(p.delta)}<br><small>Son 15 dk: ${p.last15_delta == null ? 'Yeterli ölçüm yok' : (p.last15_delta>0 ? '+' : '')+num(p.last15_delta)}</small>` : '—'}</td><td>${evidence(p) || '—'}</td><td>${escapeHTML(e?.ht_score || '—')}</td><td>${escapeHTML(e?.ft_score || '—')}${e?.status === 'live' ? '<br><small>Canlı skor</small>' : ''}</td><td>${p ? `<strong>${escapeHTML(outcome(e?.primary?.outcome))}</strong><br>${money(e?.primary?.net_tl)}` : '—'}</td></tr>`;
      }).join('') : '<tr><td colspan="8">Bu tarihte kapsam dahilinde maç yok.</td></tr>';
    } catch (error) {
      if (requestId === sequence) status.textContent = `Kayıtlar alınamadı: ${error.message}`;
    }
  }
  document.addEventListener('companion-tab-change', event => {
    if (interval) {clearInterval(interval);interval=null;}
    if (event.detail === 'tab-kickoff') {refresh();interval=setInterval(refresh,15000);}
  });
  date.addEventListener('change', refresh);
  document.getElementById('kickoff-refresh').addEventListener('click',refresh);
  document.getElementById('kickoff-today').addEventListener('click',() => {date.value=localDay(0);refresh();});
  document.getElementById('kickoff-yesterday').addEventListener('click',() => {date.value=localDay(-1);refresh();});
})();
