// Browser-side Firebase auth: login, auto-login via refresh token, authFetch.
const API_KEY = 'AIzaSyDS65vzbj3_zGMFHypPaRG76DFEfAxuB50'; // public Firebase web key
const LS_KEY = 'neoron_auth';
let idToken = null;

export function loadStored() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } }
function store(a) { localStorage.setItem(LS_KEY, JSON.stringify(a)); }
export function clearAuth() { localStorage.removeItem(LS_KEY); idToken = null; }
export function currentUser() { return loadStored()?.email || null; }

export async function login(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const d = await res.json();
  if (!res.ok) {
    const code = d.error?.message || '';
    const msg = /INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|INVALID_PASSWORD/.test(code)
      ? 'E-mail ou senha inválidos.' : 'Falha no login. Tente novamente.';
    throw new Error(msg);
  }
  idToken = d.idToken;
  store({ email: d.email, refreshToken: d.refreshToken });
  return { email: d.email };
}

export async function refresh() {
  const s = loadStored();
  if (!s?.refreshToken) throw new Error('no refresh token');
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refreshToken)}`,
  });
  const d = await res.json();
  if (!res.ok) { clearAuth(); throw new Error('refresh failed'); }
  idToken = d.id_token;
  store({ email: s.email, refreshToken: d.refresh_token });
  return idToken;
}

async function ensureToken() { return idToken || refresh(); }

export async function authFetch(url, opts = {}) {
  let tok = await ensureToken();
  const go = (t) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` } });
  let res = await go(tok);
  if (res.status === 401) { tok = await refresh(); res = await go(tok); }
  return res;
}
