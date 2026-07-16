// Haversine formula: distance in meters between two lat/lng points
export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

export function totalDistance(points = []) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distanceMeters(points[i - 1], points[i]);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Snap-to-trail: project a raw GPS fix onto the nearest point of a recorded
// route. Consumer GPS realistically drifts 5-20m (more under tree cover),
// so re-walking an identical physical path almost never reproduces the same
// coordinates twice. Snapping the displayed dot onto the recorded line (when
// it's plausibly the same spot) is what hiking apps like Strava/Komoot do,
// and is what actually makes "follow this trail" feel precise.
//
// Uses a local equirectangular projection (accurate to sub-meter error at
// trail scale) so we can do simple flat-plane segment projection instead of
// spherical geometry, then converts the result back to lat/lng.
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6371000;

function toLocalXY(refLat, point) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  return {
    x: toRad(point.lng) * EARTH_RADIUS_M * Math.cos(toRad(refLat)),
    y: toRad(point.lat) * EARTH_RADIUS_M,
  };
}

function fromLocalXY(refLat, xy) {
  const toDeg = (rad) => (rad * 180) / Math.PI;
  return {
    lat: toDeg(xy.y / EARTH_RADIUS_M),
    lng: toDeg(xy.x / (EARTH_RADIUS_M * Math.cos((refLat * Math.PI) / 180))),
  };
}

// Closest point on segment [a,b] to point p, all in local XY meters.
function closestPointOnSegmentXY(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;

  if (lengthSq === 0) return { point: a, t: 0 };

  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  return { point: { x: a.x + t * abx, y: a.y + t * aby }, t };
}

/**
 * Finds the closest point on a polyline (array of {lat,lng}) to a given
 * point. Returns { point: {lat,lng}, distance (meters), segmentIndex } or
 * null if the polyline has fewer than 2 points.
 */
export function nearestPointOnPolyline(point, polyline = []) {
  if (!point || polyline.length < 2) return null;

  const refLat = point.lat;
  const p = toLocalXY(refLat, point);

  let best = null;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = toLocalXY(refLat, polyline[i]);
    const b = toLocalXY(refLat, polyline[i + 1]);
    const { point: proj } = closestPointOnSegmentXY(p, a, b);

    const dx = p.x - proj.x;
    const dy = p.y - proj.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (!best || distance < best.distance) {
      best = { point: fromLocalXY(refLat, proj), distance, segmentIndex: i };
    }
  }

  return best;
}

// Initial compass bearing from point a to point b, in degrees (0 = north, 90 = east)
export function bearing(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  const deg = toDeg(Math.atan2(y, x));
  return (deg + 360) % 360;
}
