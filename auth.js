const AUTH_STORAGE_KEY = 'green-city-ai-auth-v1';
let googleScriptPromise;

export function getStoredUser() {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveUser(user) {
  try {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // Auth still works for the current session if storage is unavailable.
  }
  return user;
}

export function clearStoredUser() {
  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage restrictions.
  }
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(window.atob(padded));
  } catch {
    return null;
  }
}

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error('Google Identity Services could not be loaded'));
    document.head.appendChild(script);
  });
  return googleScriptPromise;
}

export function getGoogleClientId() {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
}

export async function mountGoogleButton(container, onSuccess, onError) {
  const clientId = getGoogleClientId();
  if (!container) return { configured: false };
  if (!clientId) {
    container.innerHTML = '<div class="auth-config-note">Add <code>VITE_GOOGLE_CLIENT_ID</code> to enable Google sign-in.</div>';
    return { configured: false };
  }
  try {
    const google = await loadGoogleScript();
    google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => {
        const claims = decodeJwtPayload(response.credential);
        if (!claims?.sub) {
          onError?.(new Error('Google did not return a readable identity token'));
          return;
        }
        onSuccess?.({
          id: claims.sub,
          name: claims.name || 'Green City learner',
          email: claims.email || '',
          picture: claims.picture || '',
          provider: 'google',
        }, response.credential);
      },
    });
    google.accounts.id.renderButton(container, { theme: 'outline', size: 'large', text: 'continue_with', width: 280 });
    return { configured: true };
  } catch (error) {
    onError?.(error);
    container.innerHTML = '<div class="auth-config-note">Google sign-in could not load. You can use demo access instead.</div>';
    return { configured: false, error };
  }
}

export async function verifyGoogleCredential(credential) {
  if (!credential) throw new Error('Google credential is missing');
  const response = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok || !payload.user) throw new Error(payload.error || 'Google identity could not be verified');
  return payload.user;
}

export function createDemoUser(name = 'Ananya Sharma', email = 'ananya@example.com') {
  return { id: `demo-${Date.now()}`, name, email, picture: '', provider: 'demo' };
}
