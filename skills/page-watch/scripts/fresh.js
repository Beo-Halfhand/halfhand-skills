/* fresh.js: a live-data page says how fresh its data is, and says "paused" when it's too old. Copy it to your site.
   The page declares, in <head>:
     <meta name="data-sources" content="orders stock">   keys in your /data-status.json (space-separated)
     <meta name="data-max-age" content="60">              minutes
     <script src="/fresh.js" defer></script>
   /data-status.json, written by whatever job refreshes the data:
     { "sources": { "orders": { "checkedAt": "2026-11-13T17:00:00Z" }, "stock": { "checkedAt": "..." } } }
   This sets <meta name="data-updated" content="<oldest checkedAt of the page's sources>">, which page-watch reads, and fills
   any [data-fresh="line"] ("Live data, checked ...") and [data-fresh="banner"] ("Paused since ...") elements for visitors.
   If /data-status.json can't be read, a source is missing, or a time is more than 5 minutes in the future, data-updated stays
   empty and the page says freshness is unknown.
   Times are shown in the visitor's own time zone. Set window.FRESH_STATUS_URL before this script to read another address. */
(function () {
  var mq = function (n) { return document.querySelector('meta[name="' + n + '"]'); };
  var srcs = ((mq('data-sources') || {}).content || '').split(/\s+/).filter(Boolean);
  var maxMin = Number((mq('data-max-age') || {}).content || 0);
  if (!srcs.length || !maxMin) return;
  var meta = mq('data-updated');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'data-updated'; meta.content = ''; document.head.appendChild(meta); }
  var when = function (iso) { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  var put = function (sel, text, show) {
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) { els[i].textContent = text; if (show !== undefined) els[i].hidden = !show; }
  };
  var checked = null;
  function render() {
    if (!checked) { document.documentElement.dataset.fresh = 'unknown'; put('[data-fresh="line"]', 'Data freshness unknown right now.'); put('[data-fresh="banner"]', '', false); return; }
    var stale = (Date.now() - Date.parse(checked)) / 60000 > maxMin;
    document.documentElement.dataset.fresh = stale ? 'paused' : 'fresh';
    put('[data-fresh="line"]', (stale ? 'Paused: data last checked ' : 'Live data, checked ') + when(checked) + '.');
    put('[data-fresh="banner"]', stale ? 'Paused since ' + when(checked) + ': this data hasn’t been refreshed since then, so it may be out of date.' : '', stale);
  }
  fetch(window.FRESH_STATUS_URL || '/data-status.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then(function (d) {
      var times = srcs.map(function (s) { return d.sources && d.sources[s] && d.sources[s].checkedAt; });
      if (times.some(function (t) { return !t || isNaN(Date.parse(t)); })) throw new Error('missing source');
      if (times.some(function (t) { return Date.parse(t) > Date.now() + 5 * 60000; })) throw new Error('a time in the future: a clock is wrong');
      checked = times.sort(function (a, b) { return Date.parse(a) - Date.parse(b); })[0];
      meta.content = checked;
      render(); setInterval(render, 60000);
    })
    .catch(function () { meta.content = ''; render(); });
})();
