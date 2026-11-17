// fleet-dashboard: "Asks for you". Questions your agents left in the asks folder; your answer becomes a file the
// agent reads. Every answer asks you to confirm first. Mounts on #askList; redraws on 'fd:asks'.
'use strict';
window.fdAsks = (() => {
  const { h, sigil, ago, post, getJSON } = window.fd;
  const list = document.getElementById('askList');
  let agents = [];

  function card(x, max) {
    const a = agents.find((g) => g.key === x.agent);
    const status = h('div', { 'aria-live': 'polite' });
    const box = h('textarea', { maxlength: String(max), 'aria-label': 'Your answer', hidden: true });
    const send = async (verdict, text) => {
      const words = verdict === 'ok' ? `Send the draft to ${a?.name ?? 'the agent'}?` : verdict === 'skip' ? 'Skip this ask?' : `Send your answer to ${a?.name ?? 'the agent'}?`;
      if (!window.confirm(words)) return;
      for (const b of acts.querySelectorAll('button')) b.disabled = true;
      try { await post('/api/ask', { id: x.id, verdict, ...(text ? { text } : {}) }); status.replaceChildren(h('div', { class: 'ask-done' }, verdict === 'skip' ? 'Skipped. The agent will see it on its next check.' : 'Sent. The agent will see it on its next check.')); setTimeout(load, 1500); }
      catch (e) { status.replaceChildren(h('div', { class: 'ask-err' }, 'Not sent: ' + e.message)); for (const b of acts.querySelectorAll('button')) b.disabled = false; }
    };
    const own = h('button', { class: 'btn small', type: 'button', onclick: () => {
      if (box.hidden) { box.hidden = false; box.focus(); own.textContent = 'Send my answer'; return; }
      const t = box.value.trim(); if (!t) { box.focus(); return; } send('own', t);
    } }, 'Write my own');
    const acts = h('div', { class: 'ask-acts' },
      x.draft ? h('button', { class: 'btn small primary', type: 'button', onclick: () => send('ok') }, 'Send the draft') : null,
      own, h('button', { class: 'btn small', type: 'button', onclick: () => send('skip') }, 'Skip'));
    return h('div', { class: 'ask', id: 'ask-' + x.id },
      h('div', { class: 'ask-who' }, a ? sigil(a, 20) : null, h('b', {}, a?.name ?? 'an agent'), x.at ? h('span', { class: 'muted' }, `· ${ago(x.at)}`) : null),
      h('div', { class: 'ask-q' }, x.question || '(no question text)'),
      x.draft ? h('div', { class: 'ask-draft' }, 'Draft: ', x.draft) : null,
      box, acts, status);
  }
  async function load() {
    if (!list) return;
    try {
      const j = await getJSON('/api/asks');
      if (!j.enabled) { list.replaceChildren(h('p', { class: 'muted' }, 'Asks are off. Set "asksDir" in the config to turn them on.')); return; }
      const open = j.asks.filter((x) => x.open), done = j.asks.length - open.length;
      list.replaceChildren(...[...(open.length ? open.map((x) => card(x, j.max)) : [h('p', { class: 'muted' }, 'Nothing waiting on you.')]),
        done ? h('p', { class: 'ask-count' }, `${done} answered, waiting for the agent to tidy up.`) : null].filter(Boolean));
      document.dispatchEvent(new CustomEvent('fd:asks', { detail: { open: open.length } }));
    } catch (e) { list.replaceChildren(h('p', { class: 'muted' }, 'asks unavailable: ' + e.message)); }
  }
  document.addEventListener('fd:fleet', (e) => {
    agents = e.detail.agents;
    const n = e.detail.totals.asksOpen;
    if (list && n !== Number(list.dataset.open ?? -1)) { list.dataset.open = String(n); load(); }
  });
  return { load };
})();
