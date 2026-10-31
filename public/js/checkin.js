// "I'm here": one tap reads the browser's location once, finds the town and country in the
// map data, and records today as a visit there (or extends yesterday's). The position itself is
// never sent or kept: only the town, at the map data's own coordinates.
import { toast } from './ui.js';
import { localToday } from './days.js';
import { checkInPlan, lastVisitDate, sortVisits } from './visits.js';
import { statusFields, statusOf } from './status.js';
import { findTowns } from './import-apps.js';
import { savedOrNew } from './trip-visits.js';
import { t } from './i18n.js';

function currentPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error(t('This browser cannot tell where you are.')));
            return;
        }
        navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error(t('Your location is not available. Allow it for this site to check in.'))),
            { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 });
    });
}

// The town and country at a point: `where` as trips use it, or null away from any country.
async function placeAt(ctx, lat, lng) {
    const { index } = ctx.state;
    const { townNear } = await findTowns(ctx);
    const town = await townNear(lat, lng);
    const country = town ? index.byId.get(town.countryId) : index.findAt(lat, lng);
    if (!country) return null;
    return town
        ? { city: { name: town.name, country: country.name, countryId: country.id, lat: town.lat, lng: town.lng }, countryId: country.id }
        : { country, countryId: country.id };
}

export async function checkIn(ctx) {
    const closeToast = toast(t('Finding where you are…'), { duration: 15_000 });
    try {
        const { coords } = await currentPosition();
        const where = await placeAt(ctx, coords.latitude, coords.longitude);
        closeToast();
        if (!where) {
            toast(t('We could not tell which country you are in.'), { tone: 'error' });
            return;
        }
        const { existing, place } = savedOrNew(ctx, where);
        const confirmed = await ctx.confirmDialog({
            title: t('You are in {place}', { place: place.name }),
            message: t('Record today as a visit there? Only the town is saved, never your exact position.'),
            confirmLabel: t('Record today')
        });
        if (!confirmed) return;
        const marker = existing || await ctx.savePlace({ ...place, ...statusFields('visited') }, { quiet: true });
        if (statusOf(marker) === 'wishlist') await ctx.updatePlace(marker, statusFields('visited'));
        const today = localToday();
        const plan = checkInPlan(marker.visits, today);
        if (plan.action === 'add') {
            marker.visits = sortVisits([...(marker.visits || []), await ctx.api.addVisit(marker.id, plan.visit)]);
        } else if (plan.action === 'extend') {
            const updated = await ctx.api.updateVisit(plan.visit.id, plan.visit);
            marker.visits = sortVisits(marker.visits.map(visit => (visit.id === updated.id ? updated : visit)));
        }
        marker.travelDate = lastVisitDate(marker);
        ctx.refresh();
        toast(plan.action === 'none' ? t('Today is already recorded in {place}.', { place: place.name }) : t('Checked in: {place}, today. 📍', { place: place.name }), { tone: 'success' });
    } catch (error) {
        closeToast();
        toast(error.message || t('Your location is not available. Allow it for this site to check in.'), { tone: 'error' });
    }
}
