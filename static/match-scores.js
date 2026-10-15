/* Display only: scores never enter prediction selection or settlement. */
(function (root) {
  const esc = value => String(value ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function html(half, full, status) {
    const hidden = ['scheduled','postponed','cancelled','canceled','unknown'].includes(status);
    const label = ['live','halftime','in_progress'].includes(status) ? 'MS (canlı)' : 'MS';
    return `<span class="score-pair">İY: ${esc(hidden ? null : half)}<br>${label}: ${esc(hidden ? null : full)}</span>`;
  }
  root.MatchScores = {html};
  if (typeof module !== 'undefined') module.exports = root.MatchScores;
})(typeof window !== 'undefined' ? window : globalThis);
