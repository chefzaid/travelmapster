// Yearly goals ("three new countries in 2027") and how far the traveler is: new countries on
// their country list, new cities, or visits begun that year. Pure, unit tested in Node.
import { statusOf } from './status.js';
import { countriesByYear } from './travel-stats.js';

export const GOAL_KINDS = {
    countries: { one: 'new country', many: 'new countries', icon: '🌍' },
    cities: { one: 'new city', many: 'new cities', icon: '🏙️' },
    visits: { one: 'trip', many: 'trips', icon: '🧳' }
};

const firstVisitYear = marker => (marker.visits || []).reduce((first, visit) => {
    const year = visit.startDate.slice(0, 4);
    return !first || year < first ? year : first;
}, '');

const beenTo = marker => ['visited', 'lived'].includes(statusOf(marker));

/** How many the traveler has toward a goal's kind in its year. */
export function goalCount(goal, markers, { countryOf, countedIds }) {
    const year = String(goal.year);
    if (goal.kind === 'countries') {
        return countriesByYear(markers, { countryOf, countedIds }).find(row => row.year === year)?.newCount || 0;
    }
    if (goal.kind === 'cities') {
        return markers.filter(marker => marker.category === 'City' && beenTo(marker) && firstVisitYear(marker) === year).length;
    }
    return markers.filter(beenTo)
        .reduce((sum, marker) => sum + (marker.visits || []).filter(visit => visit.startDate.startsWith(`${year}-`)).length, 0);
}

/** Every goal with its count, share done (0–100) and whether it is reached. */
export function goalProgress(goals, markers, lookups) {
    return (goals || []).map(goal => {
        const count = goalCount(goal, markers, lookups);
        return { ...goal, count, percent: Math.min(100, Math.round((count / goal.target) * 100)), reached: count >= goal.target };
    });
}

export const goalKey = goal => `${goal.year}:${goal.kind}`;

/** "3 new countries in 2027". */
export function goalLabel(goal) {
    const words = GOAL_KINDS[goal.kind] || GOAL_KINDS.visits;
    return `${goal.target} ${goal.target === 1 ? words.one : words.many} in ${goal.year}`;
}
