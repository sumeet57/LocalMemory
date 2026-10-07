import L from "leaflet";

// leaflet-rotate (and many older Leaflet plugins) are written expecting a
// global `L`, the way you'd get from a plain <script> tag. Our bundler
// loads Leaflet as an ES module instead, which never touches `window`, so
// we shim it here — once — before the plugin's side-effecting import runs.
if (typeof window !== "undefined" && !window.L) {
  window.L = L;
}

// Side-effect import: patches L.Map with real bearing/rotation support —
// correct pointer-coordinate math while dragging a rotated map, a genuine
// two-finger touch-rotate gesture, and setBearing()/getBearing(). This
// replaces a plain CSS-transform "fake rotation" which cannot get touch
// coordinates right once the view is actually rotated.
import "leaflet-rotate";

export default L;
