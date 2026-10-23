// The sample traveler on the landing page's demo map: places with dated visits relative to
// today, so the ledger figures always look current. Nothing here is ever saved. Pure, unit
// tested in Node.
import { addDays } from './days.js';

// [type, category, name, lat, lng, visits as [first, last] day offsets from today, or 'now'].
const SAMPLE = [
    ['visited', 'City', 'Lisbon, Portugal', 38.725, -9.15, [[-9, 'now']]],
    ['visited', 'City', 'Porto, Portugal', 41.149, -8.611, [[-30, -26]]],
    ['visited', 'City', 'Barcelona, Spain', 41.389, 2.159, [[-45, -38]]],
    ['visited', 'Country', 'France', 46.696, 2.552, [[-120, -108], [-560, -553]]],
    ['visited', 'City', 'Rome, Italy', 41.892, 12.511, [[-150, -146]]],
    ['visited', 'Country', 'Greece', 39.493, 21.726, [[-210, -197]]],
    ['visited', 'City', 'Marrakesh, Morocco', 31.634, -8, [[-62, -57]]],
    ['visited', 'Country', 'Morocco', 31.634, -8, [[-63, -55]]],
    ['visited', 'City', 'Kyoto, Japan', 35.021, 135.754, [[-695, -691]]],
    ['visited', 'City', 'Tokyo, Japan', 35.69, 139.692, [[-700, -696], [-690, -688]]],
    ['visited', 'Country', 'Mexico', 19.428, -99.128, [[-400, -389]]],
    ['visited', 'Country', 'Canada', 56.5, -98, [[-900, -893]]],
    ['wishlist', 'Country', 'Peru', -9.2, -75, []],
    ['wishlist', 'City', 'Cusco, Peru', -13.532, -71.967, []],
    ['wishlist', 'Country', 'New Zealand', -41.8, 172.8, []],
    ['wishlist', 'City', 'Queenstown, New Zealand', -45.03, 168.663, []],
    ['wishlist', 'Country', 'Iceland', 64.779, -18.674, []]
];

/** The sample traveler's places as the API would return them, with negative ids. */
export function demoMarkers(today) {
    let id = 0;
    return SAMPLE.map(([type, category, name, lat, lng, visits]) => {
        const markerId = --id;
        return {
            id: markerId,
            type,
            category,
            name,
            lat,
            lng,
            notes: '',
            photoUrl: '',
            visits: visits.map(([first, last]) => ({
                id: --id,
                markerId,
                startDate: addDays(today, first),
                endDate: last === 'now' ? '' : addDays(today, last),
                ongoing: last === 'now',
                notes: '',
                photoUrl: ''
            }))
        };
    });
}
