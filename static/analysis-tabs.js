// Move existing nodes, preserving their values, IDs and event handlers.
function initAnalysisSubtabs() {
  const root = document.getElementById('tab-analysis');
  if (!root || document.getElementById('analysis-subtabs')) return;
  const overview = document.getElementById('tab-overview');
  const researchOverview = document.getElementById('research-data-overview');
  if (overview && researchOverview) {
    overview.classList.remove('tab-content', 'active');
    overview.removeAttribute('role');
    overview.classList.add('research-data-overview');
    researchOverview.append(overview);
  }
  const definitions = [
    ['ahmet', 'Ahmetin analizleri', '#ahmet-analyses-card', 'Tahminler'],
    ['systems', 'Son 2 Gün · Tüm Sistemler', '#system-comparison-card', 'Karşılaştırma'],
    ['top3', 'Günün En Güvenilir 3 Maçı', '#daily-top3-card', 'Tahminler'],
    ['closing-value', 'Kapanış Değeri', '#closing-value-card', 'Tahminler'],
    ['ten-leagues', '10 Lig Maçları', '#ten-league-matches-card', 'Tahminler'],
    ['consensus', 'Birleşik Konsensüs', '#consensus-card', 'Tahminler'],
    ['recommendations', 'Mackolik Önerileri', '#recommendation-body', 'Tahminler'],
    ['kickoff', 'Başlangıç Analizi', '#tab-kickoff', 'Tahminler'],
    ['flashscore', 'FS / 1xBet', '#tab-flashscore', 'Tahminler'],
    ['htft-pairs', 'İY/MS İki Seçim', '#tab-htft-pairs', 'Tahminler'],
    ['preview', 'Ön İzleme Adayları', '#near-miss-body', 'Tahminler'],
    ['daily', 'Günlük Sonuç Takibi', '#prediction-status', 'İleri takip'],
    ['forward', '100 Maç İleri Test', '#forward-audit-results', 'İleri takip'],
    ['movements', 'Oran Hareketleri', '#daily-closing-movement-card', 'Geçmiş analiz'],
    ['single', 'Tek Oran Geçmişi', '#single-analysis-body', 'Geçmiş analiz'],
    ['patterns', 'İki Oran Kalıpları', '#pattern-analysis-body', 'Geçmiş analiz'],
    ['query', 'Özel Oran Sorgusu', '#pattern-legs', 'Geçmiş analiz'],
  ];
  definitions.forEach(d => { if(d[3] === 'Tahminler' && d[0] !== 'ahmet') d[3] = 'Arşiv'; if(d[0] === 'ahmet') d[1] = 'Yeni Sanal Testler'; });
  const groupMeta = {
    'Arşiv': ['⌛', 'Sanal testleri devam eden araçlar'],
    'Karşılaştırma': ['⇄', 'Sistemleri karşılaştır'],
    'Tahminler': ['🎯', 'Güncel seçimleri incele'],
    'İleri takip': ['↗', 'Sonuç ve test takibi'],
    'Geçmiş analiz': ['⌛', 'Oran geçmişini araştır'],
  };
  const nav = document.createElement('div');
  nav.id = 'analysis-subtabs'; nav.className = 'analysis-subtabs analysis-subtabs-header';
  nav.setAttribute('aria-label', 'Oran analizi bölümleri');
  const headerNav = document.querySelector('.nav-tabs');
  const toolsMenu = document.getElementById('tools-menu');
  if (headerNav) headerNav.insertBefore(nav, toolsMenu || null);
  else root.prepend(nav);
  const menus = new Map();
  const closeMenus = except => {
    menus.forEach(({trigger, popover}, group) => {
      if (group === except) return;
      trigger.setAttribute('aria-expanded', 'false');
      popover.hidden = true;
    });
  };
  definitions.forEach(([key, label, selector, group]) => {
    if (!menus.has(group)) {
      const [icon, description] = groupMeta[group];
      const menu = document.createElement('div');
      menu.className = 'analysis-menu';
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'analysis-menu-trigger';
      trigger.setAttribute('aria-expanded', 'false');
      trigger.innerHTML = `<span class="analysis-menu-icon">${icon}</span><span class="analysis-menu-copy"><strong>${group}</strong><small>${description}</small></span><span class="analysis-menu-chevron" aria-hidden="true">⌄</span>`;
      const popover = document.createElement('div');
      popover.className = 'analysis-menu-popover';
      popover.hidden = true;
      popover.setAttribute('role', 'tablist');
      popover.setAttribute('aria-label', group);
      trigger.addEventListener('click', () => {
        const opening = trigger.getAttribute('aria-expanded') !== 'true';
        closeMenus(opening ? group : null);
        trigger.setAttribute('aria-expanded', String(opening));
        popover.hidden = !opening;
      });
      trigger.addEventListener('keydown', event => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        closeMenus(group);
        trigger.setAttribute('aria-expanded', 'true');
        popover.hidden = false;
        if (!popover.hidden) popover.querySelector('button')?.focus();
      });
      menu.append(trigger, popover);
      nav.append(menu);
      menus.set(group, {menu, trigger, popover, description});
    }
    const button = document.createElement('button');
    button.type = 'button'; button.id = `analysis-subtab-${key}`;
    button.textContent = label; button.dataset.analysisTab = key;
    if (['consensus','htft-pairs'].includes(key)) button.hidden = true;
    button.dataset.analysisGroup = group;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', `analysis-panel-${key}`);
    menus.get(group).popover.append(button);
    const panel = document.createElement('div');
    panel.id = `analysis-panel-${key}`; panel.className = 'analysis-subpanel';
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
    const nested = selector.startsWith('#tab-');
    panel.append(nested ? document.querySelector(selector) : root.querySelector(selector).closest('.card'));
    if (key === 'single') {
      ['analysis-history-metrics','analysis-history-filters','analysis-history-intro'].forEach(id => panel.prepend(document.getElementById(id)));
      panel.append(document.getElementById('single-match-detail'));
    }
    if (key === 'movements') panel.append(document.getElementById('reverse-movement-card'));
    if (key === 'query') panel.append(document.getElementById('pattern-results'));
    root.append(panel);
    button.addEventListener('click', () => {
      closeMenus();
      selectAnalysisSubtab(key);
    });
    button.addEventListener('keydown', event => {
      const buttons = Array.from(button.parentElement.querySelectorAll('[data-analysis-tab]'));
      const i = buttons.indexOf(button);
      const next = event.key === 'ArrowDown' ? (i + 1) % buttons.length :
        event.key === 'ArrowUp' ? (i + buttons.length - 1) % buttons.length :
        event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenus();
        menus.get(group).trigger.focus();
        return;
      }
      if (next === null) return;
      event.preventDefault(); buttons[next].focus();
    });
  });
  document.addEventListener('click', event => {
    if (!nav.contains(event.target)) closeMenus();
  });
  let saved;
  try { saved = sessionStorage.getItem('analysis-subtab'); } catch (_) { /* Storage may be disabled. */ }
  selectAnalysisSubtab(definitions.some(([key]) => key === saved) ? saved : 'ahmet');
}

function selectAnalysisSubtab(key, navigate = true) {
  if(['consensus','htft-pairs'].includes(key)) key='ahmet';
  const buttons = Array.from(document.querySelectorAll('[data-analysis-tab]'));
  if (!buttons.some(button => button.dataset.analysisTab === key)) return;
  if (navigate && typeof switchTab === 'function') {
    switchTab(['kickoff','flashscore','htft-pairs'].includes(key) ? 'tab-'+key : 'tab-analysis',key);
    return;
  }
  buttons.forEach(button => {
    const active = button.dataset.analysisTab === key;
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    document.getElementById(button.getAttribute('aria-controls')).hidden = !active;
  });
  const activeButton = buttons.find(button => button.dataset.analysisTab === key);
  const activeGroup = activeButton?.dataset.analysisGroup;
  document.querySelectorAll('.analysis-menu').forEach(menu => {
    const trigger = menu.querySelector('.analysis-menu-trigger');
    const selected = trigger && menu.contains(activeButton);
    trigger?.classList.toggle('active', Boolean(selected));
    const detail = trigger?.querySelector('small');
    if (detail && selected) detail.textContent = activeButton.textContent;
    else if (detail) {
      const descriptions = {
        'Karşılaştırma': 'Sistemleri karşılaştır',
        'Tahminler': 'Güncel seçimleri incele',
        'İleri takip': 'Sonuç ve test takibi',
        'Geçmiş analiz': 'Oran geçmişini araştır',
      };
      detail.textContent = descriptions[trigger.querySelector('strong')?.textContent] || '';
    }
  });
  try { sessionStorage.setItem('analysis-subtab', key); } catch (_) { /* Nonessential preference. */ }
  document.dispatchEvent(new CustomEvent('analysis-subtab-change', {detail: key}));
}

initAnalysisSubtabs();
