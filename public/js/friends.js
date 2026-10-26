// Friends (ADR 0028): the public maps a traveler follows, in the Passport tab, each compared
// with the traveler's own countries, and the button to follow a map from its shared page.
import { h, $, toast, formDialog } from './ui.js';
import { computeStats } from './geo.js';
import { compareCountries } from './compare.js';
import { t, tn } from './i18n.js';


// Followed maps' counted countries, by name, loaded once per session.
const loaded = new Map();

async function friendCountries(ctx, username) {
    const key = `${username}|${ctx.state.stats.countryList}`;
    if (!loaded.has(key)) {
        loaded.set(key, ctx.api.getPublicMap(username).then(data =>
            computeStats(data.markers, ctx.state.index, { countryList: ctx.state.stats.countryList }).countedVisitedIds));
        loaded.get(key).catch(() => loaded.delete(key));
    }
    return loaded.get(key);
}

const countryLabel = (index, id) => {
    const country = index.byId.get(id);
    return country ? `${country.flag} ${country.name}` : id;
};

function showComparison(ctx, username, theirs) {
    const { index, stats } = ctx.state;
    const { both, onlyMine, onlyTheirs } = compareCountries(stats.countedVisitedIds, theirs, id => index.byId.get(id)?.name || id);
    const column = (title, ids) => h('section', {},
        h('h4', {}, `${title} · ${ids.length}`),
        ids.length ? h('ul', { class: 'compare-list' }, ids.map(id => h('li', {}, countryLabel(index, id)))) : h('p', { class: 'muted small' }, t('None')));
    formDialog({
        title: t('You and {username}', { username }),
        message: tn(both.length, 'Counted on your list: {count} country you have both been to.', 'Counted on your list: {count} countries you have both been to.'),
        content: h('div', { class: 'compare-columns' },
            column(t('Both of you'), both), column(t('Only you'), onlyMine), column(t('Only {username}', { username }), onlyTheirs)),
        submitLabel: t('Close'),
        fields: []
    });
}

function friendItem(ctx, follow, redraw) {
    const status = h('small', {}, follow.public ? t('Counting…') : t('This map is private now.'));
    const compare = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: true }, t('Compare'));
    if (follow.public) {
        friendCountries(ctx, follow.username).then(theirs => {
            const shared = [...theirs].filter(id => ctx.state.stats.countedVisitedIds.has(id)).length;
            status.textContent = tn(theirs.size, '{count} country · {shared} in common', '{count} countries · {shared} in common', { shared });
            compare.disabled = false;
            compare.addEventListener('click', () => showComparison(ctx, follow.username, theirs));
        }).catch(() => { status.textContent = t('This map is private now.'); });
    }
    return h('li', { class: 'friend' },
        h('span', {}, h('strong', {}, follow.username), status),
        compare,
        follow.public ? h('a', { class: 'btn btn-ghost btn-sm', href: `/?u=${encodeURIComponent(follow.username)}`, target: '_blank', rel: 'noopener' }, t('View')) : null,
        h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': t('Stop following {username}', { username: follow.username }), title: t('Stop following'),
            onclick: async () => {
                try {
                    await ctx.api.unfollow(follow.username);
                    toast(t('You no longer follow {username}.', { username: follow.username }));
                    redraw();
                } catch (error) {
                    ctx.handleError(error);
                }
            }
        }, '✕'));
}

async function followByName(ctx, redraw) {
    const values = await formDialog({
        title: t('Follow a map'),
        message: t('Follow a friend\'s public map to see how many countries you have in common. They are not told.'),
        submitLabel: t('Follow'),
        fields: [{ name: 'username', label: t('Their username'), required: true, maxlength: 32, autocomplete: 'off' }]
    });
    if (!values) return;
    try {
        const { username } = await ctx.api.follow(values.username.trim());
        toast(t('You follow {username}\'s map.', { username }), { tone: 'success' });
        redraw();
    } catch (error) {
        ctx.handleError(error);
    }
}

/** The Friends section of the Passport tab, filled once the followed maps are known. */
export function friendsSection(ctx) {
    const section = h('section', { class: 'friends' });
    if (ctx.state.user.guest) {
        section.append(h('h3', { class: 'section-title' }, t('👥 Friends')),
            h('p', { class: 'muted small' }, t('Sign up to follow your friends\' maps and plan trips together.')));
        return section;
    }
    const draw = async () => {
        let follows = [];
        try {
            follows = await ctx.api.getFollows();
        } catch {
            // Offline: the section says nothing is followed rather than failing the tab.
        }
        section.replaceChildren(
            h('h3', { class: 'section-title' }, t('👥 Friends'), h('span', { class: 'count' }, follows.length)),
            follows.length
                ? h('ul', { class: 'friend-list' }, follows.map(follow => friendItem(ctx, follow, draw)))
                : h('p', { class: 'muted small' }, t('Follow friends\' public maps to compare the countries you have been to.')),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => followByName(ctx, draw) }, t('＋ Follow a map'))
        );
    };
    draw();
    return section;
}

/** On a shared map, a signed-in traveler can follow it. */
export async function followButton(ctx, username) {
    const button = $('#public-follow');
    if (!button) return;
    let user = null;
    try {
        user = await ctx.api.currentUser();
    } catch {
        // Signed out: no button.
    }
    if (!user || user.username.toLowerCase() === username.toLowerCase()) return;
    const follows = await ctx.api.getFollows().catch(() => []);
    const following = follows.some(item => item.username.toLowerCase() === username.toLowerCase());
    button.hidden = false;
    button.disabled = following;
    button.textContent = following ? t('✓ Following') : t('＋ Follow this map');
    button.onclick = async () => {
        try {
            await ctx.api.follow(username);
            button.disabled = true;
            button.textContent = t('✓ Following');
            toast(t('You follow {username}\'s map. Compare it in your Passport tab.', { username }), { tone: 'success' });
        } catch (error) {
            toast(error.message, { tone: 'error' });
        }
    };
}
