/* Replay the published read-only responses using the original panel interface. */
(() => {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  const base = new URL('./', document.currentScript.src);
  let manifest;
  let lastCheck = 0;
  let pending;
  const response = (data, status = 200) => new Response(JSON.stringify(data), {
    status, headers: {'Content-Type': 'application/json; charset=utf-8'}
  });
  const canonical = value => {
    const url = new URL(value, location.href);
    url.searchParams.delete('refresh');
    url.searchParams.delete('_');
    url.searchParams.sort();
    return url.pathname + (url.searchParams.size ? '?' + url.searchParams.toString() : '');
  };
  function note() {
    const element = document.getElementById('web-publication-note');
    if (!element || !manifest) return;
    const age = Date.now() - Date.parse(manifest.generated_at);
    const failed = Object.values(manifest.entries).filter(entry => entry.error).length;
    element.classList.toggle('stale', age > 15 * 60000 || failed > 0);
    element.textContent = 'Web paneli · Son aktarım: ' + new Date(manifest.generated_at).toLocaleString('tr-TR', {timeZone: 'Europe/Istanbul'}) +
      ' · Yaklaşık 5 dakikada bir güncellenir.' +
      (age > 15 * 60000 ? ' Güncelleme gecikti; PC kapalı veya bağlantı kesilmiş olabilir.' : '') +
      (failed ? ' Bazı raporlar PC’den alınamadı; mevcut eski kayıtların zamanı ayrıca gösterilir.' : '') +
      ' · Kayıtlı tarihler: ' + manifest.dates.join(', ') +
      ' · Özel sorgular, maç arşivi ve yerel sistem araçları PC panelinden kullanılabilir.';
  }
  async function getManifest() {
    if (manifest && Date.now() - lastCheck < 60000) return manifest;
    if (!pending) pending = nativeFetch(new URL('snapshot.json?t=' + Date.now(), base), {cache: 'no-store'})
      .then(async result => {
        if (!result.ok) throw new Error('Web verileri henüz yayımlanmadı.');
        manifest = await result.json(); lastCheck = Date.now(); note(); return manifest;
      }).finally(() => {pending = null;});
    return pending;
  }
  function staleLabel(entry) {
    const age = Date.now() - Date.parse(entry.updated_at);
    if (entry.error || age > 15 * 60000) {
      const box = document.getElementById('web-publication-note');
      if (box) {
        box.classList.add('stale');
        const stamp = new Date(entry.updated_at).toLocaleString('tr-TR', {timeZone: 'Europe/Istanbul'});
        const label = ' Görüntülenen raporlardan biri eski: ' + stamp + '.';
        if (!box.textContent.includes(label)) box.textContent += label;
      }
    }
  }
  window.fetch = async (input, options = {}) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, options);
    if ((options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase() !== 'GET') {
      return response({error: 'Web paneli salt okunurdur.'}, 405);
    }
    if (url.pathname === '/api/telegram/status') return response({message: 'Yerel panelden yönetilir.'});
    const current = await getManifest();
    const entries = new Map(Object.entries(current.entries).map(([key, value]) => [canonical(key), value]));
    // The live snapshot contains all leagues; filter the same rows locally for the ten-league view.
    const playable = url.pathname === '/api/live-matches' && url.searchParams.get('playable_only') === '1';
    if (url.pathname === '/api/live-matches') url.searchParams.delete('playable_only');
    const entry = entries.get(canonical(url.href));
    if (!entry || !entry.file) return response({error: entry?.error || 'Bu tarih veya sorgu web kopyasında bulunmuyor. PC panelinden kullanılabilir.'}, 503);
    staleLabel(entry);
    const result = await nativeFetch(new URL(entry.file + '?v=' + encodeURIComponent(entry.updated_at), base), options);
    if (!result.ok || !playable) return result;
    const data = await result.json();
    data.rows = (data.rows || []).filter(row => row.playable);
    data.counts = {};
    for (const row of data.rows) data.counts[row.bucket] = (data.counts[row.bucket] || 0) + 1;
    return response(data);
  };
  document.addEventListener('DOMContentLoaded', () => {
    getManifest().catch(error => {document.getElementById('web-publication-note').textContent = error.message;});
    // These controls require arbitrary queries or local process information.
    for (const id of ['tools-menu', 'telegram-notification-status']) {
      const element = document.getElementById(id); if (element) element.hidden = true;
    }
    setTimeout(() => {
      for (const key of ['preview', 'single', 'patterns', 'query']) {
        const button = document.getElementById('analysis-subtab-' + key);
        if (button) button.hidden = true;
      }
    }, 0);
    setInterval(() => getManifest().catch(() => {
      const box = document.getElementById('web-publication-note');
      if (box) {box.classList.add('stale'); box.textContent = 'Bağlantı kesildi; ekrandaki veriler güncel olmayabilir.';}
    }), 60000);
  });
})();
