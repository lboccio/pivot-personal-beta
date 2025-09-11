// Minimal Google Identity Services (GIS) auth helper
// Requires: VITE_GOOGLE_OAUTH_CLIENT_ID

let googleScriptLoading;
function loadGis() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  if (!googleScriptLoading) {
    googleScriptLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
      document.head.appendChild(s);
    });
  }
  return googleScriptLoading;
}

function decodeJwt(t) {
  try { return JSON.parse(atob(t.split('.')[1])); } catch { return null; }
}

const listeners = new Set();
let currentUser = null; // {token, sub, email, name, picture, exp}

function notify() { for (const cb of listeners) { try { cb(currentUser); } catch {} } }

export function onAuthChange(cb) { listeners.add(cb); cb(currentUser); return () => listeners.delete(cb); }

export function getUser() { return currentUser; }

export function signOut() {
  currentUser = null;
  try { localStorage.removeItem('auth:user'); } catch {}
  notify();
}

function handleCredentialResponse(resp) {
  const token = resp && resp.credential;
  const claims = token ? decodeJwt(token) : null;
  if (!claims) return;
  currentUser = {
    token,
    sub: claims.sub,
    email: claims.email,
    name: claims.name || claims.email || 'User',
    picture: claims.picture,
    exp: claims.exp
  };
  try { localStorage.setItem('auth:user', JSON.stringify(currentUser)); } catch {}
  notify();
}

export async function renderGoogleButton(container) {
  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error('Missing VITE_GOOGLE_OAUTH_CLIENT_ID');
  await loadGis();
  window.google.accounts.id.initialize({ client_id: clientId, callback: handleCredentialResponse, auto_select: false });
  window.google.accounts.id.renderButton(container, { theme: 'outline', size: 'medium', type: 'standard', shape: 'pill' });
}

export function tryRestoreUser() {
  try {
    const raw = localStorage.getItem('auth:user');
    if (!raw) return;
    const u = JSON.parse(raw);
    if (u && u.exp && Date.now() < u.exp * 1000) {
      currentUser = u;
    } else {
      localStorage.removeItem('auth:user');
    }
  } catch {}
}

