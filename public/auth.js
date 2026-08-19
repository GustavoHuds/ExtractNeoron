/**
 * Browser auth: the user signs in with their own Neoron account, straight
 * against Google's Firebase Auth (the same login Neoron itself uses).
 * The password NEVER touches our server — only the resulting short-lived
 * idToken is sent as a Bearer header. Session lives in sessionStorage
 * (cleared when the browser tab closes) and refreshes automatically.
 */
(function () {
  const CFG = window.NEORON_CONFIG || {};
  const KEY = 'neoron_session_v2';

  function load() {
    try { return JSON.parse(sessionStorage.getItem(KEY)) || null; }
    catch { return null; }
  }
  function save(s) { sessionStorage.setItem(KEY, JSON.stringify(s)); }
  function clear() { sessionStorage.removeItem(KEY); }

  async function signIn(email, password) {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${CFG.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      });
    const data = await r.json();
    if (!r.ok) {
      const code = data.error?.message || '';
      if (/INVALID_LOGIN|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(code)) throw new Error('E-mail ou senha incorretos.');
      if (/TOO_MANY_ATTEMPTS/.test(code)) throw new Error('Muitas tentativas. Aguarde alguns minutos.');
      throw new Error('Falha no login. Tente novamente.');
    }
    const s = {
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      email: data.email,
      expiresAt: Date.now() + (Number(data.expiresIn || 3600) - 60) * 1000,
    };
    save(s);
    return s;
  }

  async function refresh(s) {
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${CFG.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refreshToken)}`,
    });
    const data = await r.json();
    if (!r.ok) { clear(); throw new Error('Sessão expirada.'); }
    const next = {
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      email: s.email,
      expiresAt: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000,
    };
    save(next);
    return next;
  }

  /** Valid idToken (refreshing when needed) or null if signed out. */
  async function token() {
    let s = load();
    if (!s) return null;
    if (Date.now() >= s.expiresAt) {
      try { s = await refresh(s); }
      catch { return null; }
    }
    return s.idToken;
  }

  window.NeoronAuth = {
    session: load,
    signIn,
    token,
    signOut() { clear(); },
  };
})();
