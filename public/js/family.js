// Family view of a trip (/family/<token>): the stops and dates of a trip its owner shared
// privately, and where the traveler is today, for family without an account. Read-only, with
// nothing beyond what src/family-links.js sends.
import { api } from './api.js';
import { $, h, fill, formatDate } from './ui.js';
import { whereNow } from './family-view.js';
import { localToday } from './days.js';
import { loadLocale, preferredLocale, translateDom, t, tn } from './i18n.js';

function dates(stop) {
    if (!stop.startDate) return tn(stop.days, '{count} day', '{count} days');
    const span = stop.startDate === stop.endDate ? formatDate(stop.startDate) : t('{start} to {end}', { start: formatDate(stop.startDate), end: formatDate(stop.endDate) });
    return `${span} · ${tn(stop.days, '{count} day', '{count} days')}`;
}

function nowLine(view, now) {
    if (now.state === 'during') return t('Today: in {place}, day {day} of {days}.', { place: now.stop.destination, day: now.day, days: view.days });
    if (now.state === 'before') return tn(now.days, 'The trip starts tomorrow.', 'The trip starts in {count} days.');
    if (now.state === 'after') return t('This trip is over.');
    return t('No dates for this trip yet.');
}

async function init() {
    await loadLocale(preferredLocale()).catch(() => {});
    translateDom();
    const token = decodeURIComponent(location.pathname.split('/')[2] || '');
    let view;
    try {
        view = await api.getFamilyTrip(token);
    } catch (error) {
        $('#family-now').textContent = error.status === 404 ? t('This link is not valid any more. Ask for a new one.') : t('The trip could not load.');
        return;
    }
    const now = whereNow(view, localToday());
    $('#family-traveler').textContent = t('{traveler}\'s trip', { traveler: view.traveler });
    $('#family-title').textContent = view.title;
    document.title = t('{title} · TravelMapster', { title: view.title });
    $('#family-now').textContent = nowLine(view, now);
    fill($('#family-stops'), view.stops.map(stop => h('li', { 'aria-current': String(now.stop === stop) },
        h('strong', {}, stop.destination), h('small', {}, dates(stop)))));
    $('#family-updated').textContent = t('Last changed {date}. Day plans, notes and bookings stay private.', { date: formatDate(String(view.updatedAt).slice(0, 10)) });
}

init().catch(error => {
    console.error(error);
    $('#family-now').textContent = t('The trip could not load.');
});
