/* Ameet Games XP: daily streak + "try a game" rewards.
   Guests: saved in this browser.  Signed in with Google: saved online in Firebase and shown on the leaderboard.
   Every online point is checked by the Firebase security rules in firestore.rules. */

// Paste the config from Firebase console > Project settings > Your apps > Web app here.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDfmOGHTjMqAx26OWY5QOB63I281TNNGTM',
  authDomain: 'ameetgames.firebaseapp.com',
  projectId: 'ameetgames',
  storageBucket: 'ameetgames.firebasestorage.app',
  messagingSenderId: '892130939149',
  appId: '1:892130939149:web:a740f3b42d7f10daabe044',
};

const FIREBASE_VERSION = '13.1.0';
const STREAK_XP = [50, 100, 200, 400];            // day 1, 2, 3, 4+ of a streak
const TRY_REWARDS = {
  minislam:   { name: 'MiniSlam',   xp: 50 },
  minisoccer: { name: 'MiniSoccer', xp: 25 },
};
const LOCAL_KEY = 'ameetgames.xp.v1';
const EMULATOR = location.hostname === 'localhost' && new URLSearchParams(location.search).has('emulator');
const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- helpers ---------- */
function dayKey(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const streakReward = n => STREAK_XP[Math.min(n, STREAK_XP.length) - 1];
const wait = ms => new Promise(r => setTimeout(r, reduceMotion ? 0 : ms));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- guest save (this browser) ---------- */
function loadLocal() {
  try {
    const s = JSON.parse(localStorage.getItem(LOCAL_KEY));
    const g = s && s.profiles && s.profiles.guest;
    if (g) return { xp: g.xp | 0, streak: g.streak | 0, lastDay: g.lastVisit || '', tried: g.tried || {} };
  } catch (e) {}
  return { xp: 0, streak: 0, lastDay: '', tried: {} };
}
function saveLocal(p) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ current: 'guest', profiles: { guest: { xp: p.xp, streak: p.streak, lastVisit: p.lastDay, tried: p.tried } } }));
  } catch (e) {}
}
let local = loadLocal();

/* ---------- online save (Firebase) ---------- */
let readyFlag = false;  // true once we know if the player is signed in
let fb = null;          // loaded Firebase modules + instances
let user = null;        // Firebase user when signed in
let cloud = null;       // this user's /users/{uid} document data
const mode = () => (user && cloud ? 'cloud' : 'local');
const profile = () => (mode() === 'cloud' ? cloud : local);

async function loadFirebase() {
  const cfg = EMULATOR ? { apiKey: 'demo-key', projectId: 'demo-ameetgames', authDomain: 'localhost' } : FIREBASE_CONFIG;
  if (!cfg) return null;
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
  const [app, auth, fs] = await Promise.all([
    import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js'),
  ]);
  const a = app.initializeApp(cfg);
  const out = { auth: auth.getAuth(a), db: fs.getFirestore(a), A: auth, F: fs };
  if (EMULATOR) {
    auth.connectAuthEmulator(out.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    fs.connectFirestoreEmulator(out.db, '127.0.0.1', 8080);
  }
  return out;
}
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }

async function googleClaims(u) {
  const t = await u.getIdTokenResult();
  return { first: String(t.claims.name || '').split(' ')[0], photo: String(t.claims.picture || '') };
}
const userRef = () => fb.F.doc(fb.db, 'users', user.uid);

async function cloudLoad() {
  const { first, photo } = await googleClaims(user);
  const ref = userRef();
  let snap = await fb.F.getDoc(ref);
  if (!snap.exists()) {
    await fb.F.setDoc(ref, { name: first, photo, hidden: false, xp: 0, streak: 0, lastDay: '', tried: {} });
    snap = await fb.F.getDoc(ref);
  }
  let d = snap.data();
  if (!d.hidden && (d.name !== first || d.photo !== photo)) {   // keep name/picture up to date
    await fb.F.updateDoc(ref, { name: first, photo });
    d = { ...d, name: first, photo };
  }
  return d;
}

/* ---------- rewards (both saves) ---------- */
async function claimStreak() {
  const today = dayKey(0), yesterday = dayKey(-1);
  const calc = p => {
    if (p.lastDay && p.lastDay >= today) return null;
    const kept = p.lastDay === yesterday;
    const streak = kept ? p.streak + 1 : 1;
    return { streak, xp: streakReward(streak), lost: !kept && p.streak > 0, before: p.xp };
  };
  if (mode() === 'local') {
    const r = calc(local); if (!r) return null;
    local = { ...local, streak: r.streak, lastDay: today, xp: local.xp + r.xp };
    saveLocal(local);
    return r;
  }
  const r = await fb.F.runTransaction(fb.db, async tx => {
    const s = await tx.get(userRef()); const p = s.data();
    const res = calc(p); if (!res) return null;
    tx.update(userRef(), { xp: p.xp + res.xp, streak: res.streak, lastDay: today });
    return res;
  });
  if (r) cloud = { ...cloud, xp: r.before + r.xp, streak: r.streak, lastDay: today };
  return r;
}
async function claimTries(ids) {
  const fresh = p => ids.filter(id => TRY_REWARDS[id] && !p.tried[id]);
  if (mode() === 'local') {
    const got = fresh(local); if (!got.length) return [];
    local = { ...local, tried: { ...local.tried }, xp: local.xp };
    got.forEach(id => { local.tried[id] = true; local.xp += TRY_REWARDS[id].xp; });
    saveLocal(local);
    return got;
  }
  const got = await fb.F.runTransaction(fb.db, async tx => {
    const s = await tx.get(userRef()); const p = s.data();
    const g = fresh(p); if (!g.length) return [];
    const tried = { ...p.tried }; let xp = p.xp;
    g.forEach(id => { tried[id] = true; xp += TRY_REWARDS[id].xp; });
    tx.update(userRef(), { tried, xp });
    return g;
  });
  if (got.length) {
    const tried = { ...cloud.tried }; let xp = cloud.xp;
    got.forEach(id => { tried[id] = true; xp += TRY_REWARDS[id].xp; });
    cloud = { ...cloud, tried, xp };
  }
  return got;
}
async function setHidden(hidden) {
  const { first, photo } = await googleClaims(user);
  const upd = hidden ? { hidden: true, name: '', photo: '' } : { hidden: false, name: first, photo };
  await fb.F.updateDoc(userRef(), upd);
  cloud = { ...cloud, ...upd };
  emit();
}
async function deleteOnlineData() {
  await fb.F.deleteDoc(userRef());
  cloud = null;
  try {
    await fb.A.deleteUser(user);                 // also remove the Firebase sign-in record
  } catch (e) {
    if (e && e.code === 'auth/requires-recent-login') {
      try { await fb.A.reauthenticateWithPopup(user, new fb.A.GoogleAuthProvider()); await fb.A.deleteUser(user); }
      catch (e2) { await fb.A.signOut(fb.auth); }
    } else {
      await fb.A.signOut(fb.auth);
    }
  }
}
async function getLeaderboard() {
  const q = fb.F.query(fb.F.collection(fb.db, 'users'), fb.F.orderBy('xp', 'desc'), fb.F.limit(100));
  const snap = await fb.F.getDocs(q);
  return snap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(p => !p.hidden && p.xp > 0).slice(0, 50);
}

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
const CHECK = `
  ......w
  .....ww
  w...ww.
  ww.ww..
  .www...
  ..w....`;
const MEDAL = `
  .rr...bb.
  ..rr.bb..
  ...rbb...
  ..kkkkk..
  .kmmmmmk.
  kmmhmmmmk
  kmhmmmmmk
  kmmmmmmsk
  kmmmmmssk
  .kmmmssk.
  ..kkkkk..`;
const flame = s => pix(FLAME, { k: '#7a2200', o: '#ff7a1a', y: '#ffc83a', w: '#fff3b0' }, s);
const star = s => pix(STAR, { k: '#6b4a00', y: '#ffd84a', w: '#fff6c2' }, s);
const check = s => pix(CHECK, { w: '#ffffff' }, s);
const MEDAL_COLORS = [
  { m: '#ffd84a', h: '#fff6c2', s: '#c79a12' },
  { m: '#cfd8e3', h: '#ffffff', s: '#8d9aab' },
  { m: '#e0955a', h: '#ffd0a8', s: '#a35a26' },
];
const medal = (i, s) => pix(MEDAL, { r: '#e04848', b: '#3a7be0', k: '#1a1200', ...MEDAL_COLORS[i] }, s);

/* Google photo drawn at 12x12 and blown up: a pixel-art avatar. */
function pixelAvatar(photo, letter, cls) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = (letter || '?').charAt(0).toUpperCase();
  if (photo) {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 12;
      c.getContext('2d').drawImage(img, 0, 0, 12, 12);
      el.textContent = ''; el.appendChild(c);
    };
    img.src = photo;
  }
  return el;
}

/* ---------- nav: Leaderboard link + HUD ---------- */
const nav = document.querySelector('nav');
if (nav && !nav.querySelector('a[href="leaderboard.html"]')) {
  const a = document.createElement('a'); a.href = 'leaderboard.html'; a.textContent = 'Leaderboard';
  nav.appendChild(a);
}
const hud = document.createElement('div');
hud.className = 'xp-hud xp-wait';
hud.innerHTML = `
  <span class="xp-pill xp-pill-streak" title="Day streak">${flame(2)}<b data-streak>0</b></span>
  <span class="xp-pill xp-pill-xp" title="Your XP">${star(2)}<b data-xp>0</b><small>XP</small></span>
  <button type="button" class="px-btn px-btn-sm xp-signin" hidden>Sign in</button>
  <span class="xp-user" hidden>
    <button type="button" class="xp-avatar" aria-haspopup="true" aria-expanded="false" title="Account"></button>
    <span class="xp-menu px-panel" hidden>
      <span class="xp-menu-name"></span>
      <span class="xp-menu-note"></span>
      <a class="px-btn px-btn-sm" href="leaderboard.html">Leaderboard</a>
      <button type="button" class="px-btn px-btn-sm px-btn-dark xp-hide"></button>
      <button type="button" class="px-btn px-btn-sm px-btn-dark xp-signout">Sign out</button>
    </span>
  </span>`;
if (nav) nav.appendChild(hud);
const elXp = hud.querySelector('[data-xp]');
const elStreak = hud.querySelector('[data-streak]');
const pillXp = hud.querySelector('.xp-pill-xp');
const btnIn = hud.querySelector('.xp-signin');
const userBox = hud.querySelector('.xp-user');
const avatarBtn = hud.querySelector('.xp-avatar');
const menu = hud.querySelector('.xp-menu');
const btnHide = hud.querySelector('.xp-hide');
let shownXp = 0;
let pendingXp = 0;   // rewards already saved but not yet animated into the counter

function renderHud() {
  if (readyFlag) hud.classList.remove('xp-wait');
  const p = profile();
  shownXp = Math.max(0, p.xp - pendingXp);
  elXp.textContent = shownXp.toLocaleString();
  elStreak.textContent = p.streak;
  btnIn.hidden = !!user || !fb;
  userBox.hidden = !user;
  if (user) {
    const name = String(user.displayName || '').split(' ')[0] || 'Player';
    hud.querySelector('.xp-menu-name').textContent = name;
    avatarBtn.replaceChildren(pixelAvatar(user.photoURL, name, 'xp-avatar-img'));
    avatarBtn.setAttribute('aria-label', 'Account: ' + name);
    const hidden = cloud && cloud.hidden;
    hud.querySelector('.xp-menu-note').textContent = cloud ? (hidden ? 'Hidden from leaderboard' : 'Shown on leaderboard') : 'Offline: saving in this browser';
    btnHide.hidden = !cloud;
    btnHide.textContent = hidden ? 'Show me' : 'Hide me';
  }
}
function bump(el) { el.classList.remove('xp-bump'); void el.offsetWidth; el.classList.add('xp-bump'); }
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
  pendingXp = Math.max(0, pendingXp - amount);
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

/* ---------- daily streak popup ---------- */
async function checkStreak() {
  let r = null;
  try { r = await claimStreak(); } catch (e) { return; }
  if (!r) return;
  pendingXp += r.xp;
  renderHud();
  enqueue(() => streakPopup(r.streak, r.xp, r.lost));
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
      emit();
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
async function claimTry(ids) {
  let got = [];
  try { got = await claimTries(ids); } catch (e) { return; }
  got.forEach(id => { pendingXp += TRY_REWARDS[id].xp; });
  decorateCards();
  renderHud();
  got.forEach(id => enqueue(() => tryToast(TRY_REWARDS[id])));
}
function tryToast(r) {
  return new Promise(async resolve => {
    const t = document.createElement('div');
    t.className = 'xp-toast px-panel';
    t.setAttribute('role', 'status');
    t.innerHTML = `<span class="xp-toast-icon">${star(4)}</span>
      <span class="xp-toast-text"><b>+${r.xp} XP</b><span>You tried ${esc(r.name)}!</span></span>`;
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
    emit();
    resolve();
  });
}
function onCardClick(e) {
  const card = e.target.closest && e.target.closest('[data-try]');
  if (card && (e.type === 'click' || e.button === 1)) claimTry([card.dataset.try]);
}
document.addEventListener('click', onCardClick);
document.addEventListener('auxclick', onCardClick);

/* ---------- sign in / out ---------- */
btnIn.addEventListener('click', async () => {
  if (!fb) return;
  const provider = new fb.A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try { await fb.A.signInWithPopup(fb.auth, provider); } catch (e) {}
});
avatarBtn.addEventListener('click', () => {
  menu.hidden = !menu.hidden;
  avatarBtn.setAttribute('aria-expanded', String(!menu.hidden));
});
document.addEventListener('click', e => {
  if (!menu.hidden && !userBox.contains(e.target)) { menu.hidden = true; avatarBtn.setAttribute('aria-expanded', 'false'); }
});
hud.querySelector('.xp-signout').addEventListener('click', async () => {
  menu.hidden = true;
  if (fb) await fb.A.signOut(fb.auth);
});
btnHide.addEventListener('click', async () => {
  if (!cloud) return;
  btnHide.disabled = true;
  try { await setHidden(!cloud.hidden); } catch (e) {}
  btnHide.disabled = false;
  renderHud();
});

// Another tab changed the guest save.
window.addEventListener('storage', e => {
  if (e.key === LOCAL_KEY && mode() === 'local') { local = loadLocal(); renderHud(); decorateCards(); }
});

/* ---------- shared API for the leaderboard page ---------- */
const listeners = new Set();
function emit() { listeners.forEach(fn => { try { fn(); } catch (e) {} }); }
window.AmeetXP = {
  get ready() { return readyFlag; },
  get online() { return !!fb; },
  get user() { return user; },
  get profile() { return profile(); },
  get mode() { return mode(); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  signIn() { btnIn.click(); },
  setHidden: h => setHidden(h),
  deleteOnlineData,
  getLeaderboard,
  pixelAvatar, medal, star,
  // test hook, only on a local emulator
  _testSignIn: EMULATOR ? (sub, name, picture) => fb.A.signInWithCredential(fb.auth,
    fb.A.GoogleAuthProvider.credential(JSON.stringify({ sub, name, picture, email: sub + '@example.com', email_verified: true }))) : undefined,
};
/* ---------- start ---------- */
renderHud();
decorateCards();
(async () => {
  try { fb = await withTimeout(loadFirebase(), 8000); } catch (e) { fb = null; }
  if (!fb) {
    readyFlag = true; renderHud(); emit();
    checkStreak();
    return;
  }
  let first = true;
  fb.A.onAuthStateChanged(fb.auth, async u => {
    user = u; cloud = null; pendingXp = 0;
    if (u) {
      try { cloud = await cloudLoad(); } catch (e) { cloud = null; }
    }
    readyFlag = true;
    renderHud(); decorateCards(); emit();
    if (cloud) {
      // games tried before signing in on this browser count for the account too
      const triedHere = Object.keys(local.tried).filter(id => local.tried[id] && !cloud.tried[id]);
      if (triedHere.length) await claimTry(triedHere);
    }
    if (first || cloud) checkStreak();
    first = false;
  });
})();
