/* Ameet Games leaderboard page. Uses window.AmeetXP from xp.js. */
const box = document.getElementById('lb');
const me = document.getElementById('lb-me');
let rows = null, loading = false, failed = false, pending = false;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function load() {
  const X = window.AmeetXP;
  if (!X || !X.ready) return;
  if (loading) { pending = true; return; }
  if (!X.online) { rows = null; render(); return; }
  loading = true; failed = false; render();
  try { rows = await X.getLeaderboard(); } catch (e) { failed = true; rows = null; }
  loading = false;
  render();
  if (pending) { pending = false; load(); }
}

function render() {
  const X = window.AmeetXP;
  renderMe(X);
  if (!X || !X.ready || loading) { box.innerHTML = '<p class="lb-msg">Loading&hellip;</p>'; return; }
  if (!X.online) { box.innerHTML = '<p class="lb-msg">The leaderboard couldn&rsquo;t connect. Check your internet connection and refresh.</p>'; return; }
  if (failed) { box.innerHTML = '<p class="lb-msg">Couldn&rsquo;t load the leaderboard. Try refreshing.</p>'; return; }
  if (!rows || !rows.length) { box.innerHTML = '<p class="lb-msg">No players yet. Sign in and be the first!</p>'; return; }
  const myUid = X.user && X.user.uid;
  const ol = document.createElement('ol');
  ol.className = 'lb-list';
  rows.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'lb-row' + (i < 3 ? ' lb-top lb-top' + (i + 1) : '') + (p.uid === myUid ? ' lb-you' : '');
    const rank = document.createElement('span');
    rank.className = 'lb-rank';
    rank.innerHTML = i < 3 ? `${X.medal(i, 3)}<b>${i + 1}</b>` : `<b>${i + 1}</b>`;
    rank.setAttribute('aria-label', 'Rank ' + (i + 1));
    const name = document.createElement('span');
    name.className = 'lb-name';
    name.innerHTML = esc(p.name || 'Player') + (p.uid === myUid ? ' <em>YOU</em>' : '');
    const xp = document.createElement('span');
    xp.className = 'lb-xp';
    xp.innerHTML = `${X.star(2)}<b>${p.xp.toLocaleString()}</b><small>XP</small>`;
    li.append(rank, X.pixelAvatar(p.photo, p.name || 'P', 'lb-avatar'), name, xp);
    ol.appendChild(li);
  });
  box.replaceChildren(ol);
}

function renderMe(X) {
  if (!X || !X.ready) { me.hidden = true; return; }
  me.hidden = false;
  if (!X.online) { me.hidden = true; return; }
  if (!X.user) {
    me.innerHTML = `<p>Sign in with Google to save your XP online and join the leaderboard.</p>
      <button type="button" class="px-btn" data-act="signin">Sign in</button>`;
    return;
  }
  if (X.mode !== 'cloud') {
    me.innerHTML = '<p>You&rsquo;re signed in, but your online save couldn&rsquo;t load. Try refreshing.</p>';
    return;
  }
  const p = X.profile;
  const pos = rows ? rows.findIndex(r => r.uid === X.user.uid) : -1;
  me.innerHTML = `
    <p class="lb-me-line">${p.hidden
      ? 'You are <b>hidden</b> from the leaderboard. Your XP still saves.'
      : pos >= 0 ? `You are <b>#${pos + 1}</b> with <b>${p.xp.toLocaleString()} XP</b>.`
      : `You have <b>${p.xp.toLocaleString()} XP</b>.${p.xp === 0 ? ' Earn XP to show up here!' : ''}`}</p>
    <div class="lb-me-actions">
      <button type="button" class="px-btn px-btn-sm" data-act="toggle">${p.hidden ? 'Show me on the leaderboard' : 'Hide me from the leaderboard'}</button>
      <button type="button" class="px-btn px-btn-sm px-btn-dark" data-act="delete">Delete my online data</button>
    </div>`;
}

me.addEventListener('click', async e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const X = window.AmeetXP;
  if (!act || !X) return;
  if (act === 'signin') X.signIn();
  if (act === 'toggle') {
    e.target.disabled = true;
    try { await X.setHidden(!X.profile.hidden); } catch (err) {}
    load();
  }
  if (act === 'delete') {
    if (!confirm('Delete your online XP, streak and leaderboard entry? This can\'t be undone.')) return;
    try { await X.deleteOnlineData(); } catch (err) { alert('Something went wrong. Please try again.'); }
    load();
  }
});

function hook() {
  if (!window.AmeetXP) return setTimeout(hook, 50);
  window.AmeetXP.onChange(load);
  if (window.AmeetXP.ready) load(); else render();
}
hook();
