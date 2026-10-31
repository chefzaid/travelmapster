// Trips tab, "Subscribe in your calendar": a private link to a feed of the traveler's dated trips
// and planned stays (src/calendar-feed.js) that Google, Apple or Outlook calendars keep up to
// date. The link is shown once when made; a new one ends it, and so does turning it off.
import { h, fill, toast, copyText, formatDate } from './ui.js';
import { t } from './i18n.js';

function draw(ctx, body, feed, link = '') {
    const make = async () => {
        try {
            const created = await ctx.api.createCalendarFeed();
            draw(ctx, body, { active: true, createdAt: created.createdAt }, created.url);
        } catch (error) {
            ctx.handleError(error);
        }
    };
    const stop = async () => {
        if (!(await ctx.confirmDialog({ title: t('Turn off the calendar link?'), message: t('Calendars subscribed to it stop updating.'), confirmLabel: t('Turn off'), danger: true }))) return;
        try {
            await ctx.api.deleteCalendarFeed();
            draw(ctx, body, { active: false, createdAt: null });
            toast(t('Calendar link turned off.'));
        } catch (error) {
            ctx.handleError(error);
        }
    };
    if (!feed.active) {
        fill(body,
            h('p', { class: 'muted small' }, t('Your dated trips and planned stays in Google, Apple or Outlook calendars, kept up to date from a private link.')),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: make }, t('📆 Make a private calendar link')));
        return;
    }
    fill(body,
        link ? [
            h('label', { class: 'field', for: 'calendar-feed-url' }, h('span', {}, t('Your private link')),
                h('input', { id: 'calendar-feed-url', type: 'url', value: link, readonly: true })),
            h('p', { class: 'muted small' }, t('Add it in your calendar as a subscription “from URL”. It is shown only now; anyone with it sees your trips\' titles, places and dates.')),
            h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => copyText(link, t('Calendar link copied.'), t('Calendar link: {link}', { link })) }, t('📋 Copy the link'))
        ] : h('p', { class: 'muted small' }, t('On since {date}. The link was shown when it was made; make a new one to see a link again.', { date: formatDate(String(feed.createdAt).slice(0, 10)) })),
        h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: make }, t('New link, ending this one')),
            h('button', { type: 'button', class: 'btn btn-danger-ghost btn-sm', onclick: stop }, t('Turn off'))));
}

/** The section, filled once the feed's state arrives; a guest map has no account to subscribe to. */
export function calendarFeedSection(ctx) {
    if (ctx.state.user?.guest) return null;
    const body = h('div', { 'aria-live': 'polite' });
    ctx.api.getCalendarFeed().then(feed => draw(ctx, body, feed)).catch(() => fill(body, h('p', { class: 'muted small' }, t('The calendar link could not be loaded.'))));
    return h('section', { 'aria-labelledby': 'calendar-feed-title' },
        h('h3', { class: 'section-title', id: 'calendar-feed-title' }, t('Subscribe in your calendar')), body);
}
