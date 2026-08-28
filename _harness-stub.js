/* A stand-in for the Google Maps JavaScript API, for driving Measure Roof with
   no key and no network.
 *
 * ⭐ WHY THIS EXISTS (2026-08-28). The tool spent a day untestable because
 * neither of the site's two Google keys can draw a map anywhere except
 * highlightingutah.com - one is referrer-locked, the other has the Maps
 * JavaScript API switched off - and that is a setting in an account, not
 * something the code can fix. Meanwhile a bug that made the tool COMPLETELY
 * UNUSABLE (no first dot could be placed from either picture) sat under 5,346
 * passing checks, because every one of them read the code instead of running
 * it.
 *
 * ⚠ THE GEOMETRY IS REAL AND THAT IS THE WHOLE POINT. A stub that returns
 * plausible-looking rubbish would prove nothing about footage, which is the
 * number this tool exists to produce. So:
 *   - getBounds() is worked out from centre, zoom and the real element size
 *     through the same Web Mercator the page itself uses, so a click at a pixel
 *     lands at the latitude and longitude it would really land at;
 *   - computeDistanceBetween is a real haversine.
 * Everything else - markers, polylines, the panorama - is a shell that records
 * what it was told, because none of it decides a measurement.
 *
 * ⚠ IT IS NOT A SUBSTITUTE FOR LOOKING AT A REAL HOUSE. It cannot tell you
 * whether a line sits on the gutter. It tells you the flow runs, the arithmetic
 * lands, and the buttons are reachable - which is exactly the half that was
 * silently broken. */
(function () {
  const R = 6378137;                        /* metres, the sphere Google uses */
  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;

  /* The same projection admin.html uses, in 256-pixel world units. */
  function mercator(lat, lng) {
    const s = Math.min(Math.max(Math.sin(rad(lat)), -0.9999), 0.9999);
    return {
      x: 256 * (0.5 + lng / 360),
      y: 256 * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI))
    };
  }
  function unmercator(x, y) {
    const lng = (x / 256 - 0.5) * 360;
    const n = Math.PI - 2 * Math.PI * y / 256;
    return { lat: deg(Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))), lng: lng };
  }

  function LatLng(lat, lng) {
    if (lat && typeof lat === 'object') { lng = lat.lng; lat = lat.lat; }
    if (typeof lat === 'function') lat = lat();
    this._lat = Number(lat); this._lng = Number(lng);
  }
  LatLng.prototype.lat = function () { return this._lat; };
  LatLng.prototype.lng = function () { return this._lng; };
  LatLng.prototype.toString = function () { return '(' + this._lat + ', ' + this._lng + ')'; };
  LatLng.prototype.equals = function (o) { return !!o && o.lat() === this._lat && o.lng() === this._lng; };
  const toLL = p => (p instanceof LatLng) ? p : new LatLng(p);

  /* ---- listeners, shared by everything --------------------------------- */
  const bag = new WeakMap();
  function on(obj, ev, fn, once) {
    if (!bag.has(obj)) bag.set(obj, {});
    const m = bag.get(obj);
    (m[ev] = m[ev] || []).push({ fn: fn, once: !!once });
    return { obj: obj, ev: ev, fn: fn };
  }
  function fire(obj, ev, arg) {
    const m = bag.get(obj); if (!m || !m[ev]) return;
    m[ev].slice().forEach(function (h) {
      if (h.once) m[ev].splice(m[ev].indexOf(h), 1);
      try { h.fn(arg); } catch (e) { console.error('stub listener threw on ' + ev, e); }
    });
  }

  function Map(el, opts) {
    opts = opts || {};
    this._el = el;
    this._c = toLL(opts.center || { lat: 0, lng: 0 });
    this._z = opts.zoom == null ? 20 : opts.zoom;
    this._tilt = 0;
    const self = this;
    /* Real maps settle asynchronously and the page clears its "finding the
       house" cover on that event; firing it synchronously would hide a handler
       that only works because it was attached before the event. */
    setTimeout(function () { fire(self, 'idle'); fire(self, 'tilesloaded'); }, 0);
  }
  Map.prototype.getCenter = function () { return this._c; };
  Map.prototype.setCenter = function (c) { this._c = toLL(c); fire(this, 'center_changed'); fire(this, 'idle'); };
  Map.prototype.panTo = Map.prototype.setCenter;
  Map.prototype.getZoom = function () { return this._z; };
  Map.prototype.setZoom = function (z) { this._z = z; fire(this, 'zoom_changed'); fire(this, 'idle'); };
  Map.prototype.setTilt = function (t) { this._tilt = t; };
  Map.prototype.getTilt = function () { return this._tilt; };
  Map.prototype.setOptions = function (o) { if (o && o.center) this.setCenter(o.center); if (o && o.zoom != null) this.setZoom(o.zoom); };
  Map.prototype.setMapTypeId = function () {};
  Map.prototype.addListener = function (ev, fn) { return on(this, ev, fn); };
  Map.prototype.getDiv = function () { return this._el; };
  /* ⚠ THE ONE METHOD THAT HAS TO BE HONEST. rmMapPixelToWorld turns a click
     into a place through these bounds, so every dot, every length and every
     price in a stubbed run comes out of this function. */
  Map.prototype.getBounds = function () {
    const r = this._el ? this._el.getBoundingClientRect() : { width: 640, height: 460 };
    const W = r.width || 640, H = r.height || 460;
    const scale = Math.pow(2, this._z);
    const c = mercator(this._c.lat(), this._c.lng());
    const halfX = (W / 2) / scale, halfY = (H / 2) / scale;
    const nw = unmercator(c.x - halfX, c.y - halfY);
    const se = unmercator(c.x + halfX, c.y + halfY);
    return {
      getNorthEast: function () { return new LatLng(nw.lat, se.lng); },
      getSouthWest: function () { return new LatLng(se.lat, nw.lng); }
    };
  };
  Map.prototype.fitBounds = function () {};

  function Marker(opts) { this.setOptions(opts || {}); }
  Marker.prototype.setOptions = function (o) { Object.assign(this, o || {}); if (o && o.position) this._p = toLL(o.position); };
  Marker.prototype.setMap = function (m) { this.map = m; };
  Marker.prototype.getMap = function () { return this.map; };
  Marker.prototype.setPosition = function (p) { this._p = toLL(p); };
  Marker.prototype.getPosition = function () { return this._p; };
  Marker.prototype.setIcon = function (i) { this.icon = i; };
  Marker.prototype.setLabel = function (l) { this.label = l; };
  Marker.prototype.setZIndex = function () {};
  Marker.prototype.setDraggable = function (d) { this.draggable = d; };
  Marker.prototype.addListener = function (ev, fn) { return on(this, ev, fn); };

  function Polyline(opts) { this.setOptions(opts || {}); }
  Polyline.prototype.setOptions = function (o) { Object.assign(this, o || {}); };
  Polyline.prototype.setMap = function (m) { this.map = m; };
  Polyline.prototype.setPath = function (p) { this.path = p; };
  Polyline.prototype.getPath = function () { return this.path || []; };
  Polyline.prototype.addListener = function (ev, fn) { return on(this, ev, fn); };

  function StreetViewPanorama(el, opts) {
    opts = opts || {};
    this._el = el;
    this._pos = opts.position ? toLL(opts.position) : new LatLng(0, 0);
    this._pov = opts.pov || { heading: 0, pitch: 0 };
    this._zoom = opts.zoom == null ? 1 : opts.zoom;
    this._pano = 'STUB_PANO';
    const self = this;
    setTimeout(function () { fire(self, 'pano_changed'); fire(self, 'position_changed'); fire(self, 'status_changed'); }, 0);
  }
  StreetViewPanorama.prototype.getPosition = function () { return this._pos; };
  StreetViewPanorama.prototype.setPosition = function (p) { this._pos = toLL(p); fire(this, 'position_changed'); };
  StreetViewPanorama.prototype.getPano = function () { return this._pano; };
  StreetViewPanorama.prototype.setPano = function (id) { this._pano = id; fire(this, 'pano_changed'); };
  StreetViewPanorama.prototype.getPov = function () { return this._pov; };
  StreetViewPanorama.prototype.setPov = function (p) { this._pov = p; fire(this, 'pov_changed'); };
  StreetViewPanorama.prototype.getZoom = function () { return this._zoom; };
  StreetViewPanorama.prototype.setZoom = function (z) { this._zoom = z; fire(this, 'zoom_changed'); };
  StreetViewPanorama.prototype.setOptions = function (o) { Object.assign(this, o || {}); };
  StreetViewPanorama.prototype.setVisible = function () {};
  StreetViewPanorama.prototype.addListener = function (ev, fn) { return on(this, ev, fn); };
  StreetViewPanorama.prototype.getPhotographerPov = function () { return { heading: 0, pitch: 0 }; };

  function StreetViewService() {}
  StreetViewService.prototype.getPanorama = function (req, cb) {
    const at = toLL(req.location || { lat: 0, lng: 0 });
    setTimeout(function () {
      cb({ location: { pano: 'STUB_PANO', latLng: at, description: 'stub' },
           tiles: { centerHeading: 0 } }, 'OK');
    }, 0);
  };

  function Geocoder() {}
  Geocoder.prototype.geocode = function (req, cb) {
    /* One known house, so a stubbed run is always the same house. */
    const at = new LatLng(40.4307168, -111.8629147);
    setTimeout(function () { cb([{ geometry: { location: at }, formatted_address: String(req.address || '') }], 'OK'); }, 0);
  };

  function ElevationService() {}
  ElevationService.prototype.getElevationForLocations = function (req, cb) {
    setTimeout(function () { cb((req.locations || []).map(function () { return { elevation: 1370 }; }), 'OK'); }, 0);
  };
  function DirectionsService() {}
  DirectionsService.prototype.route = function (req, cb) { setTimeout(function () { cb(null, 'ZERO_RESULTS'); }, 0); };

  function LatLngBounds() { this._pts = []; }
  LatLngBounds.prototype.extend = function (p) { this._pts.push(toLL(p)); return this; };
  LatLngBounds.prototype.isEmpty = function () { return !this._pts.length; };
  LatLngBounds.prototype.getNorthEast = function () {
    return new LatLng(Math.max.apply(null, this._pts.map(p => p.lat())), Math.max.apply(null, this._pts.map(p => p.lng())));
  };
  LatLngBounds.prototype.getSouthWest = function () {
    return new LatLng(Math.min.apply(null, this._pts.map(p => p.lat())), Math.min.apply(null, this._pts.map(p => p.lng())));
  };

  window.google = {
    maps: {
      Map: Map, Marker: Marker, Polyline: Polyline,
      StreetViewPanorama: StreetViewPanorama, StreetViewService: StreetViewService,
      Geocoder: Geocoder, ElevationService: ElevationService, DirectionsService: DirectionsService,
      LatLng: LatLng, LatLngBounds: LatLngBounds,
      Point: function (x, y) { this.x = x; this.y = y; },
      Size: function (w, h) { this.width = w; this.height = h; },
      SymbolPath: { CIRCLE: 0, BACKWARD_CLOSED_ARROW: 3 },
      TravelMode: { DRIVING: 'DRIVING' },
      MapTypeId: { SATELLITE: 'satellite', ROADMAP: 'roadmap' },
      event: {
        addListener: function (o, e, f) { return on(o, e, f); },
        addListenerOnce: function (o, e, f) { return on(o, e, f, true); },
        removeListener: function (h) {
          if (!h || !bag.has(h.obj)) return;
          const a = bag.get(h.obj)[h.ev] || [];
          const i = a.findIndex(x => x.fn === h.fn); if (i >= 0) a.splice(i, 1);
        },
        clearInstanceListeners: function (o) { bag.delete(o); },
        trigger: function (o, e, a) { fire(o, e, a); }
      },
      /* ⚠ REAL HAVERSINE. Every foot the tool reports comes through here. */
      geometry: {
        spherical: {
          computeDistanceBetween: function (a, b) {
            a = toLL(a); b = toLL(b);
            const dLat = rad(b.lat() - a.lat()), dLng = rad(b.lng() - a.lng());
            const s = Math.sin(dLat / 2) ** 2 +
                      Math.cos(rad(a.lat())) * Math.cos(rad(b.lat())) * Math.sin(dLng / 2) ** 2;
            return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
          },
          computeHeading: function (a, b) {
            a = toLL(a); b = toLL(b);
            const y = Math.sin(rad(b.lng() - a.lng())) * Math.cos(rad(b.lat()));
            const x = Math.cos(rad(a.lat())) * Math.sin(rad(b.lat())) -
                      Math.sin(rad(a.lat())) * Math.cos(rad(b.lat())) * Math.cos(rad(b.lng() - a.lng()));
            return (deg(Math.atan2(y, x)) + 540) % 360 - 180;
          }
        }
      }
    }
  };
  window.__RM_STUBBED__ = true;
})();
