// States and provinces on the map: once the map is zoomed in far enough, the outlines of the
// largest countries' regions load, and those with a town been to are tinted (regions.js). The
// outlines are the passport's, loaded once for both.
import { REGIONS_MIN_ZOOM, toMapZoom } from './map-style.js';
import { loadRegions } from './regions-data.js';
import { regionProgress } from './regions.js';

let watching = false;
let data = null;

// The outlines, each marked visited or not, for the map's regions source.
function features(ctx, { geojson, index }) {
    const { stats, markers } = ctx.state;
    const visited = new Set(regionProgress(index, markers, marker => stats.markerCountry.get(marker.id)?.id)
        .flatMap(country => country.visited.map(({ region }) => region.id)));
    return { type: 'FeatureCollection', features: geojson.features.map(feature => ({ ...feature, properties: { ...feature.properties, visited: visited.has(feature.properties.id) } })) };
}

/** Redraws the regions after the places changed; the first zoom in that far loads them. */
export function updateRegionsOnMap(ctx) {
    const map = ctx.map?.map;
    if (!map || !ctx.state.stats) return;
    const draw = () => {
        if (data) ctx.map.setRegions(features(ctx, data));
    };
    if (!watching) {
        watching = true;
        const load = () => {
            if (data || map.getZoom() < toMapZoom(REGIONS_MIN_ZOOM)) return;
            loadRegions().then(loaded => {
                data = loaded;
                draw();
            }).catch(() => {});
        };
        map.on('zoomend', load);
        load();
    }
    draw();
}
