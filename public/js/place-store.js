// Saving places: through the API for a traveler, in the page alone for the demo map.
import { toast } from './ui.js';
import { statusInfo, statusOf } from './status.js';

// Demo places live only in the page, with negative ids like the sample traveler's.
let demoIds = -1000;

export async function savePlace(ctx, place, { quiet = false } = {}) {
    const { state } = ctx;
    const marker = state.demo
        ? { notes: '', photoUrl: '', visits: [], ...place, id: demoIds-- }
        : await ctx.api.addMarker(place);
    state.markers.push(marker);
    ctx.refresh();
    if (!quiet) {
        const verb = statusInfo(statusOf(place)).saved;
        toast(state.demo ? `${verb} ${place.name} on the demo map.` : `${verb} ${place.name}!`, { tone: 'success' });
    }
    return marker;
}

export async function updatePlace(ctx, marker, changes) {
    const next = { ...marker, ...changes };
    if (!ctx.state.demo) await ctx.api.updateMarker(marker.id, next);
    Object.assign(marker, changes);
    ctx.refresh();
    return marker;
}

export async function removePlace(ctx, marker) {
    const { state } = ctx;
    if (!state.demo) await ctx.api.deleteMarker(marker.id);
    state.markers = state.markers.filter(item => item.id !== marker.id);
    ctx.refresh();
    toast(`Removed ${marker.name}.`, {
        action: {
            label: 'Undo',
            run: () => {
                const { id, ...place } = marker;
                savePlace(ctx, place, { quiet: true }).catch(error => toast(error.message, { tone: 'error' }));
            }
        }
    });
}
