// In-page geolocation mock: smooth fixes with heading and speed along a road polyline.
(() => {
  const start = window.__MOCK_GEO_START || { latitude: 16.86, longitude: 96.116 };
  const watchers = new Map();
  let nextId = 1;
  let cur = { latitude: start.latitude, longitude: start.longitude, heading: null, speed: 0, accuracy: 5 };
  const fix = () => ({ coords: { ...cur, altitude: null, altitudeAccuracy: null }, timestamp: Date.now() });
  const emit = () => watchers.forEach((cb) => { try { cb(fix()); } catch {} });
  const geo = {
    getCurrentPosition(ok) { setTimeout(() => ok(fix()), 50); },
    watchPosition(ok) { const id = nextId++; watchers.set(id, ok); setTimeout(() => ok(fix()), 50); return id; },
    clearWatch(id) { watchers.delete(id); },
  };
  Object.defineProperty(navigator, "geolocation", { get: () => geo, configurable: true });
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dist = (a, b) => { const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const bearing = (a, b) => { const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1])); const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0])); return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360; };
  // Keep emitting while parked so the app sees a live signal.
  setInterval(emit, 1000);
  window.__mockGeo = {
    set(lat, lng) { cur = { ...cur, latitude: lat, longitude: lng, speed: 0 }; emit(); },
    // Drive the polyline ([lng,lat] pairs) in durationMs; displayed speed is a believable city speed.
    drive(coords, durationMs, shownKmh = 28) {
      const seg = []; let total = 0;
      for (let i = 1; i < coords.length; i++) { const d = dist(coords[i - 1], coords[i]); seg.push(d); total += d; }
      const t0 = performance.now();
      let heading = bearing(coords[0], coords[1]);
      return new Promise((done) => {
        const tick = () => {
          const u = Math.min(1, (performance.now() - t0) / durationMs);
          const e = u < 0.08 ? (u / 0.08) ** 2 * 0.04 : u > 0.92 ? 1 - ((1 - u) / 0.08) ** 2 * 0.04 : 0.04 + ((u - 0.08) / 0.84) * 0.92; // ease in/out
          let want = e * total, i = 0;
          while (i < seg.length - 1 && want > seg[i]) { want -= seg[i]; i++; }
          const f = seg[i] ? Math.min(1, want / seg[i]) : 1;
          const a = coords[i], b = coords[i + 1] || coords[i];
          const target = bearing(a, b);
          let delta = ((target - heading + 540) % 360) - 180;
          heading = (heading + delta * 0.18 + 360) % 360;
          const slow = u < 0.08 || u > 0.92 ? 0.5 : 1;
          cur = { latitude: a[1] + (b[1] - a[1]) * f, longitude: a[0] + (b[0] - a[0]) * f, heading, speed: u >= 1 ? 0 : ((shownKmh + Math.sin(u * 20) * 3) / 3.6) * slow, accuracy: 4 };
          emit();
          if (u < 1) setTimeout(tick, 200); else done();
        };
        tick();
      });
    },
  };
})();
