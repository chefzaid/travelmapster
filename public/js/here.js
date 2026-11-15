// Where the traveler is, read once from the browser with low accuracy when they ask: never
// watched, stored or sent as such (checking in sends only the town it finds).
import { t } from './i18n.js';

/** The browser's position once, or an error with `unavailable` when it cannot be had. */
export function currentPosition(unavailable) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error(t('This browser cannot tell where you are.')));
            return;
        }
        navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error(unavailable)),
            { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 });
    });
}
