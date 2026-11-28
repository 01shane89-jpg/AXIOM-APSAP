/* AXIOM OSAP · Planes in satellite pictures: runs the detector (assets/osap-planes-lib.js) off the page's thread, so the map
   and the window stay usable while a 30 x 30 km area (four 3,000 x 3,000 bands) is searched. One message in, one out:
   in { id, b02, b08, b03, b04, w, h, off }  ->  out { id, res } or { id, error }. */
importScripts("osap-planes-lib.js");
self.onmessage = function (e) {
  var m = e.data || {};
  try { self.postMessage({ id: m.id, res: self.OSAP_PLANES_LIB.detect(m) }); }
  catch (err) { self.postMessage({ id: m.id, error: String(err && err.message || err) }); }
};
