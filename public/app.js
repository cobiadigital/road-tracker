(() => {
  'use strict';

  const MPS_TO_MPH = 2.2369362920544;
  const INCREMENTS = [5, 10, 15, 20, 25];
  const STORE_KEY = 'road-tracker:v1';

  const $ = (id) => document.getElementById(id);
  const el = {
    speed: $('speed'),
    range: $('speed-range'),
    distance: $('distance'),
    chips: $('chips'),
    gpsBtn: $('gps-btn'),
    liveBadge: $('live-badge'),
    status: $('status'),
    bDist: $('b-dist'),
    bSpeed: $('b-speed'),
    bTime: $('b-time'),
    bEta: $('b-eta'),
    rows: $('rows'),
    foot: $('foot'),
    toast: $('toast'),
    reload: $('reload')
  };

  const state = { speed: 65, distance: 100 };

  /* ---------- formatting ---------- */

  // Trip length: "1h 32m" for long trips, "48m 20s" for short ones.
  function formatDuration(hours) {
    if (!isFinite(hours) || hours <= 0) return '--';
    const total = Math.round(hours * 3600);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
    return `${s}s`;
  }

  // Savings are usually small, so keep seconds until they stop mattering.
  function formatSaved(hours) {
    const total = Math.round(hours * 3600);
    if (total <= 0) return '0s';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function formatEta(hours) {
    if (!isFinite(hours) || hours <= 0) return '';
    const arrive = new Date(Date.now() + hours * 3600 * 1000);
    const time = arrive.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const sameDay = arrive.getDate() === new Date().getDate();
    return sameDay ? `Arrive around ${time}` : `Arrive around ${time} tomorrow`;
  }

  /* ---------- rendering ---------- */

  function render() {
    const v = state.speed;
    const d = state.distance;

    el.bDist.textContent = Number.isInteger(d) ? d : d.toFixed(1);
    el.bSpeed.textContent = v;

    if (!(v > 0) || !(d > 0)) {
      el.bTime.textContent = '--';
      el.bEta.textContent = v > 0 ? '' : 'Not moving yet';
      el.rows.innerHTML = '';
      el.foot.textContent = '';
      return;
    }

    const baseHours = d / v;
    el.bTime.textContent = formatDuration(baseHours);
    el.bEta.textContent = formatEta(baseHours);

    const rows = INCREMENTS.map((inc) => {
      const speed = v + inc;
      const hours = d / speed;
      return { inc, speed, hours, saved: baseHours - hours };
    });

    const maxSaved = rows[rows.length - 1].saved || 1;

    el.rows.innerHTML = rows.map((r) => `
      <li>
        <span class="bar" style="width:${Math.max(4, (r.saved / maxSaved) * 100).toFixed(1)}%"></span>
        <span class="r-speed">${r.speed}<small>+${r.inc} MPH</small></span>
        <span class="r-time">${formatDuration(r.hours)}</span>
        <span class="r-save">${formatSaved(r.saved)}<small>saved</small></span>
      </li>`).join('');

    const first = rows[0].saved;
    const last = rows[rows.length - 1].saved - rows[rows.length - 2].saved;
    el.foot.textContent =
      `The first 5 mph saves ${formatSaved(first)}. Going from ` +
      `${rows[rows.length - 2].speed} to ${rows[rows.length - 1].speed} mph only adds ` +
      `${formatSaved(last)} on top.`;
  }

  /* ---------- state ---------- */

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function setSpeed(mph, { fromInput = false, fromGps = false } = {}) {
    if (!fromGps && gps.active) stopGps('Switched to manual speed.');
    state.speed = clamp(Math.round(mph) || 0, 0, 150);
    if (!fromInput) el.speed.value = state.speed;
    el.range.value = clamp(state.speed, Number(el.range.min), Number(el.range.max));
    save();
    render();
  }

  function setDistance(miles, { fromInput = false } = {}) {
    state.distance = clamp(Math.round(miles * 10) / 10 || 0, 0, 5000);
    if (!fromInput) el.distance.value = state.distance;
    for (const chip of el.chips.querySelectorAll('button')) {
      chip.setAttribute('aria-current', Number(chip.dataset.dist) === state.distance ? 'true' : 'false');
    }
    save();
    render();
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ speed: state.speed, distance: state.distance }));
    } catch (_) { /* private mode, ignore */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.speed > 0) state.speed = saved.speed;
      if (saved.distance > 0) state.distance = saved.distance;
    } catch (_) { /* ignore */ }
  }

  /* ---------- status line ---------- */

  function setStatus(message, isError = false) {
    if (!message) {
      el.status.hidden = true;
      el.status.textContent = '';
      return;
    }
    el.status.hidden = false;
    el.status.textContent = message;
    el.status.classList.toggle('error', isError);
  }

  /* ---------- geolocation ---------- */

  const gps = { active: false, watchId: null, ema: null, last: null, wakeLock: null };

  function haversineMeters(a, b) {
    const R = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      gps.wakeLock = await navigator.wakeLock.request('screen');
      gps.wakeLock.addEventListener('release', () => { gps.wakeLock = null; });
    } catch (_) { /* not fatal, screen may just sleep */ }
  }

  function releaseWakeLock() {
    if (gps.wakeLock) {
      gps.wakeLock.release().catch(() => {});
      gps.wakeLock = null;
    }
  }

  function onPosition(pos) {
    const c = pos.coords;

    // iOS "Precise Location" off returns a fuzzed fix, useless for speed.
    if (c.accuracy > 1000) {
      setStatus('Approximate location only. Turn on Settings › Privacy & Security › Location Services › Safari (or Road Tracker) › Precise Location.', true);
      return;
    }

    const here = { lat: c.latitude, lon: c.longitude, t: pos.timestamp };
    let mps = null;

    if (typeof c.speed === 'number' && !Number.isNaN(c.speed) && c.speed >= 0) {
      mps = c.speed;                 // Doppler speed from the GPS chip, the good case
      gps.last = here;
    } else if (!gps.last) {
      gps.last = here;               // first fix, nothing to compare against yet
    } else {
      // No native speed: derive it, but keep the old reference fix until the two
      // are far enough apart in time that the division is not mostly noise.
      const dt = (here.t - gps.last.t) / 1000;
      if (dt > 15) {
        gps.last = here;             // stale reference after a gap, start over
      } else if (dt >= 0.5) {
        mps = haversineMeters(gps.last, here) / dt;
        gps.last = here;
      }
    }

    if (mps === null) {
      if (gps.ema === null) setStatus('Waiting for a speed reading…');
      return;
    }

    const mph = mps * MPS_TO_MPH;
    gps.ema = gps.ema === null ? mph : gps.ema + 0.35 * (mph - gps.ema);
    setSpeed(gps.ema, { fromGps: true });

    const heading = (typeof c.heading === 'number' && !Number.isNaN(c.heading))
      ? ` · ${compass(c.heading)}` : '';
    setStatus(`GPS speed · ±${Math.round(c.accuracy)} m${heading}`);
  }

  function compass(deg) {
    const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return points[Math.round(deg / 45) % 8];
  }

  function onPositionError(err) {
    const messages = {
      1: 'Location permission denied. Allow it in Settings › Privacy & Security › Location Services.',
      2: 'Location unavailable right now. Try again with a clearer view of the sky.',
      3: 'Timed out waiting for a location fix.'
    };
    stopGps();
    setStatus(messages[err.code] || `Location error: ${err.message}`, true);
  }

  function startGps() {
    if (!('geolocation' in navigator)) {
      setStatus('This browser has no location support.', true);
      return;
    }
    if (!window.isSecureContext) {
      setStatus('Location needs a secure (https) connection.', true);
      return;
    }
    gps.active = true;
    gps.ema = null;
    gps.last = null;
    el.gpsBtn.setAttribute('aria-pressed', 'true');
    el.gpsBtn.textContent = 'Stop GPS';
    el.liveBadge.hidden = false;
    setStatus('Getting a location fix…');
    gps.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000
    });
    requestWakeLock();
  }

  function stopGps(message) {
    if (gps.watchId !== null) navigator.geolocation.clearWatch(gps.watchId);
    gps.watchId = null;
    gps.active = false;
    el.gpsBtn.setAttribute('aria-pressed', 'false');
    el.gpsBtn.textContent = 'Use GPS';
    el.liveBadge.hidden = true;
    releaseWakeLock();
    setStatus(message || '');
  }

  /* ---------- events ---------- */

  el.gpsBtn.addEventListener('click', () => (gps.active ? stopGps() : startGps()));

  el.speed.addEventListener('input', () => {
    const n = Number(el.speed.value);
    if (el.speed.value === '' || Number.isNaN(n)) return;
    setSpeed(n, { fromInput: true });
  });
  el.speed.addEventListener('blur', () => { el.speed.value = state.speed; });

  el.distance.addEventListener('input', () => {
    const n = Number(el.distance.value);
    if (el.distance.value === '' || Number.isNaN(n)) return;
    setDistance(n, { fromInput: true });
  });
  el.distance.addEventListener('blur', () => { el.distance.value = state.distance; });

  el.range.addEventListener('input', () => setSpeed(Number(el.range.value)));

  document.addEventListener('click', (e) => {
    const stepBtn = e.target.closest('[data-step]');
    if (stepBtn) setSpeed(state.speed + Number(stepBtn.dataset.step));
    const distBtn = e.target.closest('[data-dstep]');
    if (distBtn) setDistance(state.distance + Number(distBtn.dataset.dstep));
    const chip = e.target.closest('[data-dist]');
    if (chip) setDistance(Number(chip.dataset.dist));
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && gps.active && !gps.wakeLock) requestWakeLock();
    if (document.visibilityState === 'visible') render(); // refresh the ETA clock
  });

  /* ---------- service worker ---------- */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener('statechange', () => {
            if (next.state === 'installed' && navigator.serviceWorker.controller) {
              el.toast.hidden = false;
            }
          });
        });
      }).catch(() => {});
    });
    el.reload.addEventListener('click', () => location.reload());
  }

  /* ---------- boot ---------- */

  load();
  el.speed.value = state.speed;
  el.distance.value = state.distance;
  setDistance(state.distance);
  setSpeed(state.speed);
})();
