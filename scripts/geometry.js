'use strict';

// Geometry helpers for the map data builders: coordinates rounded to about 100 m and outlines
// simplified with Ramer-Douglas-Peucker into friendly, cartoon coastlines that still hold at
// street-level zooms.
const PRECISION = 3; // ~100 m
const TOLERANCE = 0.02; // degrees

function round(value) {
    const factor = 10 ** PRECISION;
    return Math.round(value * factor) / factor;
}

function perpendicularDistance([x, y], [x1, y1], [x2, y2]) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
    return Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / Math.hypot(dx, dy);
}

// Ramer-Douglas-Peucker line simplification.
function douglasPeucker(points) {
    if (points.length < 3) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const [start, end] = stack.pop();
        let maxDistance = 0;
        let index = -1;
        for (let i = start + 1; i < end; i += 1) {
            const distance = perpendicularDistance(points[i], points[start], points[end]);
            if (distance > maxDistance) {
                maxDistance = distance;
                index = i;
            }
        }
        if (maxDistance > TOLERANCE) {
            keep[index] = 1;
            stack.push([start, index], [index, end]);
        }
    }
    return points.filter((_, i) => keep[i]);
}

function roundRing(ring) {
    const result = [];
    for (const [lng, lat] of ring) {
        const point = [round(lng), round(lat)];
        const previous = result[result.length - 1];
        if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
            result.push(point);
        }
    }
    return result;
}

// Tiny islands collapse under simplification, so keep their original outline.
function simplifyRing(ring) {
    const simplified = roundRing(douglasPeucker(ring));
    if (simplified.length >= 4) return simplified;
    const rounded = roundRing(ring);
    return rounded.length >= 4 ? rounded : null;
}

function simplifyGeometry(geometry) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const simplified = polygons
        .map(polygon => polygon.map(simplifyRing).filter(Boolean))
        .filter(polygon => polygon.length > 0);
    return simplified.length === 1
        ? { type: 'Polygon', coordinates: simplified[0] }
        : { type: 'MultiPolygon', coordinates: simplified };
}

module.exports = { round, simplifyGeometry };
