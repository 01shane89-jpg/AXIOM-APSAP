/* AXIOM OSAP · Heat map for dense points when zoomed out. A layer drawn from the true position of every point (no grid, no
   snapping): each point adds a small soft spot where it happened, overlapping spots add up, and the colour runs from pale
   yellow (a few) to deep red (the most in view). Zoom in and the spots pull apart until the layers that use it switch back
   to one symbol per point. Tapping a hot area zooms in there.
   window.OSAP_HEAT: on() and set(v) for the "Heat map when zoomed out" switch in Layers (on by default, remembered in this
   browser), onChange(fn), layer({ pane, onTap }) -> a Leaflet layer with setData([[lat, lon, weight], ...]), and legend(title,
   note) for the key. The layer is a view of the points it is given; it keeps no data of its own. */
(function () {
  "use strict";
  var W = window, D = document, KEY = "osap-heat", subs = [];
  var on = true; try { on = localStorage.getItem(KEY) !== "0"; } catch (e) {}
  // pale yellow (a few) to deep red (the most in view): the same ramp the old density circles used
  var STOPS = [[0, [255, 224, 130]], [0.25, [251, 192, 45]], [0.45, [255, 160, 0]], [0.65, [245, 124, 0]], [0.82, [230, 74, 25]], [1, [183, 28, 28]]];
  var PAL = (function () {
    var p = new Uint8ClampedArray(256 * 3);
    for (var i = 0; i < 256; i++) {
      var t = i / 255, k = 1; while (k < STOPS.length - 1 && STOPS[k][0] < t) k++;
      var a = STOPS[k - 1], b = STOPS[k], f = (t - a[0]) / (b[0] - a[0] || 1);
      for (var c = 0; c < 3; c++) p[i * 3 + c] = a[1][c] + (b[1][c] - a[1][c]) * f;
    }
    return p;
  })();
  var SCALE = 0.5;   // drawn at half the screen's resolution and stretched; a heat map is soft anyway, and it is 4x less work
  function radius(z) { return z <= 4 ? 10 : z <= 6 ? 12 : 14; }   // CSS pixels
  var kern = {};
  function kernel(r) {
    if (kern[r]) return kern[r];
    var n = 2 * r + 1, k = new Float32Array(n * n);
    for (var y = -r; y <= r; y++) for (var x = -r; x <= r; x++) { var d = (x * x + y * y) / (r * r); k[(y + r) * n + x + r] = d < 1 ? (1 - d) * (1 - d) : 0; }
    return (kern[r] = k);
  }
  function busy() { return !!(D.querySelector("#map .areahint") || (D.getElementById("meas-card") && !D.getElementById("meas-card").hidden)); }

  function make(L) {
    return L.Layer.extend({
      initialize: function (o) { this._o = o || {}; this._pts = []; },
      onAdd: function (map) {
        var c = this._c = L.DomUtil.create("canvas", "osap-heat");
        c.setAttribute("aria-hidden", "true");
        map.getPane(this._o.pane || "overlayPane").appendChild(c);
        map.on("moveend resize viewreset", this._draw, this);
        map.on("zoomstart", this._hide, this);
        map.on("click", this._click, this);
        map.on("popupopen", this._pop, this);
        this._draw();
      },
      onRemove: function (map) {
        if (this._c) this._c.remove(); this._c = null; this._acc = null;
        map.off("moveend resize viewreset", this._draw, this); map.off("zoomstart", this._hide, this);
        map.off("click", this._click, this); map.off("popupopen", this._pop, this);
      },
      setData: function (pts) { this._pts = pts || []; if (this._map) this._draw(); return this; },
      _hide: function () { if (this._c) this._c.style.opacity = "0"; },
      _pop: function () { this._popT = Date.now(); },
      _draw: function () {
        var map = this._map, c = this._c; if (!map || !c) return;
        var size = map.getSize(), w = Math.ceil(size.x * SCALE), h = Math.ceil(size.y * SCALE);
        if (!w || !h) return;
        c.width = w; c.height = h; c.style.width = size.x + "px"; c.style.height = size.y + "px";
        L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
        var r = Math.round(radius(map.getZoom()) * SCALE), k = kernel(r), n = 2 * r + 1, acc = new Float32Array(w * h), pts = this._pts, peak = 0;
        for (var i = 0; i < pts.length; i++) {
          var q = pts[i], p = map.latLngToContainerPoint([q[0], q[1]]), px = Math.round(p.x * SCALE), py = Math.round(p.y * SCALE), wt = q[2] || 1;
          if (px < -r || py < -r || px > w + r || py > h + r) continue;
          for (var y = -r; y <= r; y++) {
            var yy = py + y; if (yy < 0 || yy >= h) continue;
            var row = yy * w, kr = (y + r) * n + r;
            for (var x = -r; x <= r; x++) { var xx = px + x; if (xx < 0 || xx >= w) continue; var kv = k[kr + x]; if (kv) { var v = acc[row + xx] += kv * wt; if (v > peak) peak = v; } }
          }
        }
        // the top of the scale: the 99.5th percentile of what is in view (so one extreme spot does not wash out the rest),
        // and never less than about four events on one spot, so a lone event reads as "a few", not as the worst place
        var vmax = 4;
        if (peak > 4) {
          var nz = []; for (var j = 0; j < acc.length; j += 3) if (acc[j] > 0.05) nz.push(acc[j]);
          nz.sort(function (a, b) { return a - b; });
          vmax = Math.max(4, nz.length ? nz[Math.floor(nz.length * 0.995)] : peak);
        }
        var ctx = c.getContext("2d"), img = ctx.createImageData(w, h), d = img.data;
        for (var m = 0; m < acc.length; m++) {
          var val = acc[m]; if (val < 0.02) continue;
          // faint where little happened (so the map and borders stay readable), solid where most did
          var t = Math.min(1, val / vmax), pi = Math.round(Math.pow(t, 0.7) * 255) * 3, o = m * 4, a = Math.min(1, t / 0.3);
          d[o] = PAL[pi]; d[o + 1] = PAL[pi + 1]; d[o + 2] = PAL[pi + 2]; d[o + 3] = (a * a * (3 - 2 * a)) * 205;
        }
        ctx.putImageData(img, 0, 0);
        this._acc = acc; this._vmax = vmax; this._w = w; this._h = h;
        var cv = c; requestAnimationFrame(function () { cv.style.opacity = "1"; });
      },
      // how hot the map is at a point on screen, 0 (nothing) to 1 (the hottest in view)
      heatAt: function (cp) {
        if (!this._acc) return 0;
        var x = Math.round(cp.x * SCALE), y = Math.round(cp.y * SCALE);
        if (x < 0 || y < 0 || x >= this._w || y >= this._h) return 0;
        return Math.min(1, this._acc[y * this._w + x] / this._vmax);
      },
      _click: function (e) {
        var self = this, t0 = Date.now(), v = this.heatAt(e.containerPoint);
        if (!this._o.onTap || v < 0.05 || busy()) return;
        // a tap on a symbol drawn over the heat opens its pop-up; that tap is not also a zoom
        setTimeout(function () { if (self._map && !(self._popT >= t0)) self._o.onTap(e.latlng, v); }, 30);
      }
    });
  }
  var Heat = null;
  function layer(o) { if (!W.L) return null; Heat = Heat || make(W.L); return new Heat(o); }

  /* ---------- the switch, in Layers (and so in Overlays) ---------- */
  function set(v) {
    on = !!v; try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {}
    var b = D.querySelector("#ml-heat input"); if (b) b.checked = on;
    subs.forEach(function (f) { try { f(on); } catch (e) {} });
  }
  function row() {
    var ex = D.getElementById("ml-extra"); if (!ex) return false;
    if (D.getElementById("ml-heat")) return true;
    var d = D.createElement("div"); d.id = "ml-heat";
    d.innerHTML = '<div class="mlh">Dense points</div><label class="mlrow"><input type="checkbox"' + (on ? " checked" : "") + '><span><b>Heat map when zoomed out</b>' +
      "<i>Where points crowd together, show where they happened as a heat map drawn from each point’s own position; zoom in for one symbol each. Tap a hot area to zoom in.</i></span></label>";
    ex.parentNode.insertBefore(d, ex);
    d.querySelector("input").addEventListener("change", function (e) { set(e.target.checked); });
    return true;
  }
  if (!row()) { var tries = 0, t = setInterval(function () { if (row() || ++tries > 40) clearInterval(t); }, 250); }
  var css = D.createElement("style");
  css.textContent = "canvas.osap-heat{position:absolute;left:0;top:0;pointer-events:none;opacity:0;transition:opacity .35s ease}" +
    ".lg .sw.heat{width:46px;border-radius:3px;background:linear-gradient(90deg,rgba(255,224,130,.5),#FBC02D,#FFA000,#F57C00,#E64A19,#B71C1C)}";
  D.head.appendChild(css);

  function legend(title, note) {
    return "<h3>" + title + '</h3><div class="lg"><span class="sw heat"></span><div>Few to most in view<span class="d">' + note + "</span></div></div>";
  }
  W.OSAP_HEAT = { on: function () { return on; }, set: set, onChange: function (f) { subs.push(f); }, layer: layer, legend: legend };
})();
