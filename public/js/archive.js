// Places in open map formats (GeoJSON and KML) and the full account archive: the export from
// /api/export as JSON, with the places as CSV, GeoJSON and KML beside it, in one ZIP file.
// Pure, unit tested in Node.
import { buildCsv } from './io.js';
import { sortVisits } from './visits.js';
import { statusInfo, statusOf } from './status.js';
import { zip } from './zip.js';

const visitDates = visit => (visit.endDate && visit.endDate !== visit.startDate
    ? `${visit.startDate} – ${visit.endDate}`
    : `${visit.startDate}${visit.ongoing ? ' – still there' : ''}`);

/** A GeoJSON FeatureCollection with a point for each place and its details as properties. */
export function buildGeoJson(markers) {
    return JSON.stringify({
        type: 'FeatureCollection',
        features: markers.map(marker => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [Number(marker.lng), Number(marker.lat)] },
            properties: {
                name: marker.name,
                category: marker.category,
                status: statusOf(marker),
                rating: marker.rating || null,
                tags: marker.tags || [],
                emoji: marker.emoji || '',
                notes: marker.notes || '',
                photoUrl: marker.photoUrl || '',
                visits: sortVisits(marker.visits).map(visit => ({
                    startDate: visit.startDate, endDate: visit.endDate || '', ongoing: Boolean(visit.ongoing), notes: visit.notes || ''
                }))
            }
        }))
    }, null, 2);
}

const escapeXml = value => String(value ?? '').replace(/[<>&"']/g, character =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]);

/** A KML document with a placemark for each place, described by its status, visits and notes. */
export function buildKml(markers, title = 'TravelMapster places') {
    const placemarks = markers.map(marker => {
        const visits = sortVisits(marker.visits).map(visitDates);
        const description = [
            statusInfo(statusOf(marker)).label,
            visits.length ? `Visits: ${visits.join('; ')}` : '',
            marker.notes || ''
        ].filter(Boolean).join('\n');
        return [
            '    <Placemark>',
            `      <name>${escapeXml(marker.name)}</name>`,
            `      <description>${escapeXml(description)}</description>`,
            `      <Point><coordinates>${Number(marker.lng)},${Number(marker.lat)},0</coordinates></Point>`,
            '    </Placemark>'
        ].join('\n');
    });
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2">',
        '  <Document>',
        `    <name>${escapeXml(title)}</name>`,
        ...placemarks,
        '  </Document>',
        '</kml>',
        ''
    ].join('\n');
}

const README = `TravelMapster account archive

account.json   Everything in the account: profile and settings, places with their visits,
               trips, day-ledger settings and the whole history of visit dates.
places.csv     The places, one row per visit; TravelMapster imports it back.
places.geojson The places as points, for GIS tools and other map apps.
places.kml     The places for Google Earth and other KML readers.
`;

/** The account archive as ZIP bytes, from the /api/export document. */
export function accountArchive(data, now = new Date()) {
    const places = data.places || [];
    return zip([
        { name: 'README.txt', content: README },
        { name: 'account.json', content: JSON.stringify(data, null, 2) },
        { name: 'places.csv', content: buildCsv(places) },
        { name: 'places.geojson', content: buildGeoJson(places) },
        { name: 'places.kml', content: buildKml(places, `${data.profile?.username || 'TravelMapster'}'s places`) }
    ], now);
}
