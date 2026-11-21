/* Ameet Games XP: daily streak + "try a game" rewards, saved in this browser.
   Optional Google sign-in keeps a separate save per Google account (still in this browser). */
(() => {
  // Paste your Google OAuth "Web application" client ID here to turn on the Sign in button.
  const GOOGLE_CLIENT_ID = '892130939149-gjr6cia4pvrrktgsl6r784p4jscelm0o.apps.googleusercontent.com';

  const STREAK_XP = [50, 100, 200, 400];            // day 1, 2, 3, 4+ of a streak
  const TRY_REWARDS = {
    minislam:   { name: 'MiniSlam',   xp: 50 },
    minisoccer: { name: 'MiniSoccer', xp: 25 },
  };
  const KEY = 'ameetgames.xp.v1';
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- storage ---------- */
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.profiles && s.current) return s;
    } catch (e) {}
    return { current: 'guest', profiles: {} };
  }
  let state = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function profile() {
    if (!state.profiles[state.current]) state.profiles[state.current] = { xp: 0, streak: 0, lastVisit: null, tried: {} };
    return state.profiles[state.current];
  }
  function dayKey(offset = 0) {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  const streakReward = n => STREAK_XP[Math.min(n, STREAK_XP.length) - 1];

  /* ---------- pixel icons ---------- */
  function pix(map, pal, scale) {
    const rows = map.trim().split('\n').map(r => r.trim());
    const h = rows.length, w = rows[0].length;
    let rects = '';
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (pal[ch]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${pal[ch]}"/>`;
    }));
    return `<svg viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  }
  const FLAME = `
    .....k......
    ....kok.....
    ....kook....
    ...kooook.k.
    ..kooyook.ok
    ..koyyooookk
    .kooyyyyook.
    .koyyyyyyok.
    kooyywwyyook
    koyywwwwyyok
    koyywwwwyyok
    .koyyyyyyok.
    ..kkoooookk.
    ....kkkkk...`;
  const FLAME_PAL = { k: '#7a2200', o: '#ff7a1a', y: '#ffc83a', w: '#fff3b0' };
  const STAR = `
    .....k.....
    ....kyk....
    ....kyk....
    kkkkywykkkk
    kyyyywyyyyk
    .kyyywyyyk.
    ..kyyyyyk..
    ..kyykyyk..
    .kyyk.kyyk.
    .kkk...kkk.`;
  const STAR_PAL = { k: '#6b4a00', y: '#ffd84a', w: '#fff6c2' };
  const CHECK = `
    ......w
    .....ww
    w...ww.
    ww.ww..
    .www...
    ..w....`;
  const flame = s => pix(FLAME, FLAME_PAL, s);
  const star = s => pix(STAR, STAR_PAL, s);
  const check = s => pix(CHECK, { w: '#ffffff' }, s);

  /* ---------- HUD in the nav bar ---------- */
  const nav = document.querySelector('nav');
  const hud = document.createElement('div');
  hud.className = 'xp-hud';
  hud.innerHTML = `
    <span class="xp-pill xp-pill-streak" title="Day streak">${flame(2)}<b data-streak>0</b></span>
    <span class="xp-pill xp-pill-xp" title="Your XP">${star(2)}<b data-xp>0</b><small>XP</small></span>
    <button type="button" class="px-btn px-btn-sm xp-signin" hidden>Sign in</button>
    <span class="xp-user" hidden>
      <button type="button" class="xp-avatar" aria-haspopup="true" aria-expanded="false" title="Account"></button>
      <span class="xp-menu px-panel" hidden>
        <span class="xp-menu-name"></span>
        <button type="button" class="px-btn px-btn-sm px-btn-dark xp-signout">Sign out</button>
      </span>
    </span>`;
  if (nav) nav.appendChild(hud);
  const elXp = hud.querySelector('[data-xp]');
  const elStreak = hud.querySelector('[data-streak]');
  const pillXp = hud.querySelector('.xp-pill-xp');
  let shownXp = 0;

  function renderHud(xpValue) {
    const p = profile();
    shownXp = xpValue == null ? p.xp : xpValue;
    elXp.textContent = shownXp.toLocaleString();
    elStreak.textContent = p.streak;
    renderUser();
  }
  function bump(el) {
    el.classList.remove('xp-bump'); void el.offsetWidth; el.classList.add('xp-bump');
  }
  function countTo(el, from, to, ms, fmt = v => v.toLocaleString()) {
    return new Promise(res => {
      if (reduceMotion || from === to) { el.textContent = fmt(to); return res(); }
      const steps = 12; let i = 0;
      const t = setInterval(() => {
        i++;
        el.textContent = fmt(Math.round(from + (to - from) * (i / steps)));
        if (i >= steps) { clearInterval(t); res(); }
      }, ms / steps);
    });
  }
  async function addToHud(amount) {
    const from = shownXp, to = shownXp + amount;
    shownXp = to;
    bump(pillXp);
    await countTo(elXp, from, to, 500);
  }

  /* ---------- celebration queue (waits until the tab is visible) ---------- */
  const queue = []; let playing = false;
  function enqueue(fn) { queue.push(fn); pump(); }
  function pump() {
    if (playing || !queue.length || document.hidden) return;
    playing = true;
    queue.shift()().finally(() => { playing = false; pump(); });
  }
  document.addEventListener('visibilitychange', pump);

  const wait = ms => new Promise(r => setTimeout(r, reduceMotion ? 0 : ms));
  const CONFETTI = ['#ffd84a', '#ff6a5a', '#4ade80', '#60a5fa', '#c084fc', '#ff9a3c', '#ffffff'];
  function confetti(host, x, y, n = 36) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('i');
      c.className = 'xp-confetti';
      const ang = Math.random() * Math.PI * 2, dist = 80 + Math.random() * 170;
      c.style.left = x + 'px'; c.style.top = y + 'px';
      c.style.background = CONFETTI[i % CONFETTI.length];
      const size = (Math.random() < 0.5 ? 6 : 9);
      c.style.width = c.style.height = size + 'px';
      c.style.setProperty('--dx', Math.round(Math.cos(ang) * dist) + 'px');
      c.style.setProperty('--dy', Math.round(Math.sin(ang) * dist - 60) + 'px');
      c.style.animationDelay = Math.round(Math.random() * 120) + 'ms';
      host.appendChild(c);
      setTimeout(() => c.remove(), 1600);
    }
  }
  function flyStars(fromEl, n = 6) {
    if (reduceMotion || !fromEl) return Promise.resolve();
    const a = fromEl.getBoundingClientRect(), b = pillXp.getBoundingClientRect();
    const jobs = [];
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'xp-fly';
      s.innerHTML = star(3);
      const sx = a.left + a.width / 2 + (Math.random() * 60 - 30), sy = a.top + a.height / 2 + (Math.random() * 30 - 15);
      s.style.left = sx + 'px'; s.style.top = sy + 'px';
      document.body.appendChild(s);
      const anim = s.animate([
        { transform: 'translate(-50%,-50%) scale(1)' },
        { transform: `translate(calc(-50% + ${(b.left + 14 - sx) * 0.5}px), calc(-50% + ${(b.top + 12 - sy) * 0.5 - 60}px)) scale(1.2)`, offset: 0.5 },
        { transform: `translate(calc(-50% + ${b.left + 14 - sx}px), calc(-50% + ${b.top + 12 - sy}px)) scale(.6)` },
      ], { duration: 650, delay: i * 70, easing: 'steps(10, end)', fill: 'forwards' });
      jobs.push(anim.finished.then(() => s.remove()));
    }
    return Promise.all(jobs);
  }

  /* ---------- daily streak ---------- */
  function checkStreak() {
    const p = profile(), today = dayKey(0), yesterday = dayKey(-1);
    if (p.lastVisit === today) return;
    const kept = p.lastVisit === yesterday;
    const lost = !kept && p.streak > 0;
    p.streak = kept ? p.streak + 1 : 1;
    p.lastVisit = today;
    const xp = streakReward(p.streak);
    const before = p.xp;
    p.xp += xp;
    save();
    renderHud(before);
    enqueue(() => streakPopup(p.streak, xp, lost));
  }

  function streakPopup(streak, xp, lost) {
    return new Promise(resolve => {
      const cur = Math.min(streak, STREAK_XP.length);
      const days = STREAK_XP.map((v, i) => {
        const n = i + 1;
        const done = n < cur, now = n === cur;
        return `<li class="xp-day${done ? ' is-done' : ''}${now ? ' is-now' : ''}">
          <span class="xp-day-box">${done || now ? check(3) : ''}</span>
          <span class="xp-day-label">${n === STREAK_XP.length ? 'DAY ' + n + '+' : 'DAY ' + n}</span>
          <span class="xp-day-xp">+${v}</span></li>`;
      }).join('');
      const next = streakReward(streak + 1);
      const ov = document.createElement('div');
      ov.className = 'xp-overlay';
      ov.innerHTML = `
        <div class="xp-modal px-panel" role="dialog" aria-modal="true" aria-labelledby="xp-title">
          <div class="xp-flame-big">${flame(7)}</div>
          <div class="xp-streak-num" data-n>0</div>
          <h2 id="xp-title">day streak!</h2>
          <p class="xp-sub">${lost ? 'Your streak restarted. Keep it going!' : streak === 1 ? 'Welcome! Come back every day.' : 'You came back. Nice!'}</p>
          <ol class="xp-days">${days}</ol>
          <div class="xp-gain">${star(4)}<span>+<b data-gain>0</b> XP</span></div>
          <p class="xp-next">Come back tomorrow for <b>+${next} XP</b></p>
          <button type="button" class="px-btn xp-continue">Continue</button>
        </div>`;
      document.body.appendChild(ov);
      const modal = ov.querySelector('.xp-modal');
      const btn = ov.querySelector('.xp-continue');
      const gainBox = ov.querySelector('.xp-gain');
      (async () => {
        await wait(260);
        await countTo(ov.querySelector('[data-n]'), 0, streak, 400);
        const r = modal.getBoundingClientRect();
        confetti(ov, r.left + r.width / 2, r.top + 120);
        await wait(250);
        ov.querySelector('.is-now')?.classList.add('xp-fill');
        await wait(350);
        gainBox.classList.add('xp-show');
        await countTo(ov.querySelector('[data-gain]'), 0, xp, 600);
        btn.focus({ focusVisible: false });
      })();
      let closed = false;
      async function close() {
        if (closed) return; closed = true;
        ov.classList.add('xp-out');
        const fly = flyStars(gainBox, 7);
        await wait(220);
        ov.remove();
        await fly;
        await addToHud(xp);
        resolve();
      }
      btn.addEventListener('click', close);
      ov.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    });
  }

  /* ---------- try-a-game rewards ---------- */
  function decorateCards() {
    document.querySelectorAll('[data-try]').forEach(card => {
      const id = card.dataset.try, r = TRY_REWARDS[id];
      card.querySelector('.xp-tag-wrap')?.remove();
      if (!r || profile().tried[id]) return;
      const tag = document.createElement('i');
      tag.className = 'xp-tag';
      tag.innerHTML = `${star(2)}+${r.xp} XP`;
      tag.title = `Play ${r.name} for the first time to earn ${r.xp} XP`;
      const wrap = document.createElement('i');
      wrap.className = 'xp-tag-wrap';
      wrap.appendChild(tag);
      card.appendChild(wrap);
    });
  }
  function claimTry(id) {
    const r = TRY_REWARDS[id], p = profile();
    if (!r || p.tried[id]) return;
    p.tried[id] = true;
    p.xp += r.xp;
    save();
    decorateCards();
    enqueue(() => tryToast(r));
  }
  function tryToast(r) {
    return new Promise(async resolve => {
      const t = document.createElement('div');
      t.className = 'xp-toast px-panel';
      t.setAttribute('role', 'status');
      t.innerHTML = `<span class="xp-toast-icon">${star(4)}</span>
        <span class="xp-toast-text"><b>+${r.xp} XP</b><span>You tried ${r.name}!</span></span>`;
      document.body.appendChild(t);
      await wait(320);
      const rc = t.getBoundingClientRect();
      confetti(document.body, rc.left + 40, rc.top + rc.height / 2, 24);
      await wait(1300);
      const fly = flyStars(t.querySelector('.xp-toast-icon'), 5);
      t.classList.add('xp-out');
      await wait(250);
      t.remove();
      await fly;
      await addToHud(r.xp);
      resolve();
    });
  }
  document.addEventListener('click', e => {
    const card = e.target.closest && e.target.closest('[data-try]');
    if (card) claimTry(card.dataset.try);
  });
  document.addEventListener('auxclick', e => {
    const card = e.button === 1 && e.target.closest && e.target.closest('[data-try]');
    if (card) claimTry(card.dataset.try);
  });

  /* ---------- Google sign-in (saves stay in this browser) ---------- */
  const btnIn = hud.querySelector('.xp-signin');
  const userBox = hud.querySelector('.xp-user');
  const avatarBtn = hud.querySelector('.xp-avatar');
  const menu = hud.querySelector('.xp-menu');

  function renderUser() {
    const signedIn = state.current !== 'guest';
    btnIn.hidden = signedIn || !GOOGLE_CLIENT_ID;
    userBox.hidden = !signedIn;
    if (!signedIn) return;
    const p = profile();
    hud.querySelector('.xp-menu-name').textContent = p.name || 'Signed in';
    avatarBtn.textContent = '';
    avatarBtn.setAttribute('aria-label', 'Account: ' + (p.name || 'signed in'));
    const letter = document.createElement('span');
    letter.className = 'xp-avatar-letter';
    letter.textContent = (p.name || '?').trim().charAt(0).toUpperCase();
    avatarBtn.appendChild(letter);
    if (p.picture) {
      // draw the Google photo at 12x12 and blow it up for a pixel-art avatar
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = 12;
        c.getContext('2d').drawImage(img, 0, 0, 12, 12);
        avatarBtn.textContent = ''; avatarBtn.appendChild(c);
      };
      img.src = p.picture;
    }
  }

  function signIn(info) {
    const id = 'g:' + info.sub;
    if (!state.profiles[id]) {
      // first sign-in on this browser: bring the guest progress along
      state.profiles[id] = state.profiles.guest || { xp: 0, streak: 0, lastVisit: null, tried: {} };
      delete state.profiles.guest;
    }
    state.current = id;
    Object.assign(state.profiles[id], { name: info.name || info.given_name || '', picture: info.picture || '' });
    save();
    renderHud();
    decorateCards();
    checkStreak();
  }
  function signOut() {
    state.current = 'guest';
    save();
    menu.hidden = true; avatarBtn.setAttribute('aria-expanded', 'false');
    renderHud();
    decorateCards();
  }

  let tokenClient = null;
  function loadGoogle() {
    if (!GOOGLE_CLIENT_ID) return;
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'openid profile',
        callback: async resp => {
          if (!resp || !resp.access_token) return;
          try {
            const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + resp.access_token } });
            if (r.ok) signIn(await r.json());
          } catch (e) {}
        },
      });
    };
    document.head.appendChild(s);
  }
  btnIn.addEventListener('click', () => { if (tokenClient) tokenClient.requestAccessToken({ prompt: 'select_account' }); });
  avatarBtn.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    avatarBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', e => {
    if (!menu.hidden && !userBox.contains(e.target)) { menu.hidden = true; avatarBtn.setAttribute('aria-expanded', 'false'); }
  });
  hud.querySelector('.xp-signout').addEventListener('click', signOut);

  // Sync if another tab changes the save.
  window.addEventListener('storage', e => { if (e.key === KEY) { state = load(); renderHud(); decorateCards(); } });

  /* ---------- start ---------- */
  renderHud();
  decorateCards();
  loadGoogle();
  checkStreak();
})();
