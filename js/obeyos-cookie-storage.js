/* ════════════════════════════════════════════════════════════════════════
   OBEYOS — cookie-backed Supabase storage adapter  (public/js/obeyos-cookie-storage.js)
   ────────────────────────────────────────────────────────────────────────
   WHY: Safari/iOS ITP evicts script-written localStorage on browser close, which
   killed both the Supabase session (obeyos-auth → re-OTP every visit) and the
   brand-tour-seen flag (obeyos_tour_seen → tour re-shown). Cookies are NOT evicted
   on close. This moves both off localStorage onto cookies, transparently.

   The Supabase storageKey stays 'obeyos-auth' — only the MEDIUM changes. Wired into
   all session surfaces via  storage: window.obeyosCookieStorage  in createClient(),
   with window.obeyosMigrateStorage() called once just before init.

   Exposes:
     window.obeyosCookieStorage  → { getItem, setItem, removeItem }  (Supabase storage)
     window.obeyosTour           → { getTourSeen, setTourSeen }       (tour-seen flag)
     window.obeyosMigrateStorage → ()  one-time localStorage→cookie migration

   Notes:
   - Session JSON (URL-encoded) can exceed the ~4 KB single-cookie cap, so values are
     SPLIT into 3180-byte chunks (matching @supabase/ssr): sb-obeyos-auth.0, .1, …
     reassembled-then-decoded on read (a split %XX escape is safe — joined before decode).
   - Host-aware attributes: Secure ⟺ https, Domain=.obeyos.com ⟺ *.obeyos.com host.
     Localhost gets a host-only, non-Secure cookie so local testing isn't broken.
   ════════════════════════════════════════════════════════════════════════ */
(function (w) {
  'use strict';

  var PREFIX  = 'sb-';            /* cookie name = 'sb-' + storageKey  → sb-obeyos-auth      */
  var MAX     = 3180;             /* bytes per chunk — matches @supabase/ssr (under 4 KB cap) */
  var MAXAGE  = 34560000;        /* 400 days — the browser max-age cap                       */
  var TOUR    = 'obeyos_tour_seen';

  function isHttps() { return w.location.protocol === 'https:'; }
  function onObeyos() { return /(^|\.)obeyos\.com$/.test(w.location.hostname); }

  /* Shared attribute suffix for every write. Secure & Domain are INDEPENDENT toggles:
     Secure keys off protocol (https), Domain keys off host (*.obeyos.com). A preview on
     https://*.netlify.app keeps Secure but drops Domain; http://localhost drops both. */
  function attrs(maxAge) {
    var s = '; Path=/; SameSite=Lax; Max-Age=' + maxAge;
    if (onObeyos()) s += '; Domain=.obeyos.com';
    if (isHttps())  s += '; Secure';
    return s;
  }

  function readRaw(name) {
    var target = name + '=';
    var jar = w.document.cookie ? w.document.cookie.split('; ') : [];
    for (var i = 0; i < jar.length; i++) {
      var c = jar[i];
      while (c.charAt(0) === ' ') c = c.substring(1);
      if (c.indexOf(target) === 0) return c.substring(target.length);
    }
    return null;
  }

  function writeRaw(name, encVal) { w.document.cookie = name + '=' + encVal + attrs(MAXAGE); }

  /* Deletion must repeat the SAME Path + Domain it was written with, or the browser no-ops. */
  function delRaw(name) { w.document.cookie = name + '=' + attrs(0); }

  /* Delete the base cookie AND every numbered chunk (loop until the first gap). */
  function delAll(key) {
    var base = PREFIX + key;
    delRaw(base);
    for (var i = 0; ; i++) {
      if (readRaw(base + '.' + i) === null) break;
      delRaw(base + '.' + i);
    }
  }

  var cookieStorage = {
    getItem: function (key) {
      var base = PREFIX + key;
      var single = readRaw(base);
      if (single !== null) { try { return decodeURIComponent(single); } catch (e) { return single; } }
      var parts = [];
      for (var i = 0; ; i++) {
        var p = readRaw(base + '.' + i);
        if (p === null) break;
        parts.push(p);
      }
      if (!parts.length) return null;
      var joined = parts.join('');
      try { return decodeURIComponent(joined); } catch (e) { return joined; }
    },
    setItem: function (key, value) {
      delAll(key);                                  /* purge old rep first — no stale tail-chunk on shrink */
      var enc  = encodeURIComponent(String(value));
      var base = PREFIX + key;
      if (enc.length <= MAX) { writeRaw(base, enc); return; }
      var idx = 0;
      for (var off = 0; off < enc.length; off += MAX) {
        writeRaw(base + '.' + idx, enc.substring(off, off + MAX));
        idx++;
      }
    },
    removeItem: function (key) { delAll(key); }
  };

  /* ── tour-seen flag: plain cookie (tiny → no chunking), with localStorage read-through ── */
  var tour = {
    getTourSeen: function () {
      if (readRaw(TOUR) !== null) return true;
      var ls = null;
      try { ls = w.localStorage.getItem(TOUR); } catch (e) {}
      if (ls) { writeRaw(TOUR, '1'); return true; }   /* migrate LS→cookie on first read */
      return false;
    },
    setTourSeen: function () { writeRaw(TOUR, '1'); }
  };

  /* ── one-time migration: copy an existing localStorage session + tour flag into cookies
        if the cookie is empty. Prevents a mass force-logout of current users on deploy day.
        Idempotent — a no-op once the cookie exists. Call once before createClient(). ── */
  function migrate() {
    try {
      if (cookieStorage.getItem('obeyos-auth') === null) {
        var s = null;
        try { s = w.localStorage.getItem('obeyos-auth'); } catch (e) {}
        if (s) cookieStorage.setItem('obeyos-auth', s);
      }
    } catch (e) {}
    try {
      if (readRaw(TOUR) === null) {
        var t = null;
        try { t = w.localStorage.getItem(TOUR); } catch (e) {}
        if (t) writeRaw(TOUR, '1');
      }
    } catch (e) {}
  }

  w.obeyosCookieStorage  = cookieStorage;
  w.obeyosTour           = tour;
  w.obeyosMigrateStorage = migrate;
})(window);
