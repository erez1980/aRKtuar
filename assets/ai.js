/* ==========================================================================
   aRKtuar AI - authentication and secure AI proxy client.
   The browser never holds the Anthropic key. It signs in with Google via
   Supabase Auth and calls the arktuar-ai Edge Function with the user's
   access token; the function checks the allowlist and daily quota.
   ========================================================================== */
(function (root) {
  'use strict';
  const cfg = root.ARK_CONFIG;
  const STASH = 'ark-oauth-stash';
  let client = null;
  let session = null;
  const listeners = new Set();

  function sb() {
    if (!client && available()) {
      client = root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
      });
      client.auth.onAuthStateChange((_e, s) => { session = s; listeners.forEach(fn => fn(s)); });
    }
    return client;
  }

  async function init() {
    const c = sb();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    session = data.session;
    return session;
  }

  // The OAuth redirect reloads the page, so the in-memory case is stashed
  // in sessionStorage (tab-scoped, cleared on restore) and restored after.
  async function signIn(stateToStash) {
    try { if (stateToStash) sessionStorage.setItem(STASH, JSON.stringify(stateToStash)); } catch (e) { /* storage blocked */ }
    const redirectTo = location.origin + location.pathname;
    await sb().auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  }

  function takeStash() {
    try {
      const s = sessionStorage.getItem(STASH);
      if (s) sessionStorage.removeItem(STASH);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }

  async function signOut() { await sb().auth.signOut(); session = null; }

  const user = () => session && session.user ? { email: session.user.email, name: (session.user.user_metadata || {}).full_name || session.user.email } : null;

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  const MEDIA = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

  // payload: { task: 'extract' | 'bankDigest', docType, files: [File], digest, context }
  async function call(payload) {
    if (!session) throw new Error('צריך להתחבר עם Google כדי להשתמש ב־AI');
    const files = [];
    for (const f of payload.files || []) {
      const ext = (f.name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1];
      const mediaType = MEDIA[ext];
      if (!mediaType) throw new Error(`${f.name}: סוג קובץ לא נתמך ל־AI (PDF או תמונה)`);
      if (f.size > cfg.maxFileMB * 1048576) throw new Error(`${f.name}: גדול מ־${cfg.maxFileMB}MB`);
      files.push({ name: f.name, mediaType, data: await fileToBase64(f) });
    }
    const { data, error } = await sb().functions.invoke(cfg.aiFunction, {
      body: { task: payload.task, docType: payload.docType, files, digest: payload.digest || null, context: payload.context || {} }
    });
    if (error) {
      let msg = error.message || 'שגיאה בקריאה ל־AI';
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* not json */ }
      throw new Error(msg);
    }
    if (!data || !data.ok) throw new Error((data && data.error) || 'תשובה לא תקינה מה־AI');
    return data;
  }

  const available = () => !!(root.supabase && cfg && cfg.aiEnabled !== false && cfg.supabaseUrl && cfg.supabaseKey);
  root.ArkAI = {
    init, signIn, signOut, user, call, takeStash,
    onChange: fn => listeners.add(fn),
    available
  };
})(window);
