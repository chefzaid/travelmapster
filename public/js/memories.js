// "On this day": visits that began on today's calendar day in an earlier year, shown on the
// Explore tab. Pure, unit tested in Node.
import { statusOf } from './status.js';

const isLeapYear = year => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * Visits and stays lived in (not layovers or wishes) that started on today's month and day in
 * an earlier year, the most recent first. A visit that began on 29 February comes back on 28
 * February in other years.
 */
export function onThisDay(markers, today) {
    const year = Number(today.slice(0, 4));
    const monthDay = today.slice(5);
    const days = new Set([monthDay]);
    if (monthDay === '02-28' && !isLeapYear(year)) days.add('02-29');
    const memories = [];
    for (const marker of markers) {
        if (!['visited', 'lived'].includes(statusOf(marker))) continue;
        for (const visit of marker.visits || []) {
            const visitYear = Number(visit.startDate.slice(0, 4));
            if (visitYear < year && days.has(visit.startDate.slice(5))) {
                memories.push({ marker, visit, yearsAgo: year - visitYear });
            }
        }
    }
    return memories.sort((a, b) => a.yearsAgo - b.yearsAgo || a.marker.name.localeCompare(b.marker.name));
}

export function memoryLabel({ marker, yearsAgo }) {
    const when = yearsAgo === 1 ? 'A year ago today' : `${yearsAgo} years ago today`;
    return `${when}, you ${statusOf(marker) === 'lived' ? 'moved to' : 'arrived in'} ${marker.name.split(',')[0]}`;
}
