// Friends (ADR 0028): the public maps a traveler follows, in the Passport tab, each compared
// with the traveler's own countries, and the button to follow a map from its shared page.
import { h, $, toast, formDialog } from './ui.js';
import { computeStats } from './geo.js';
import { compareCountries } from './compare.js';

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

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
        ids.length ? h('ul', { class: 'compare-list' }, ids.map(id => h('li', {}, countryLabel(index, id)))) : h('p', { class: 'muted small' }, 'None'));
    formDialog({
        title: `You and ${username}`,
        message: `Counted on your list: ${plural(both.length, 'country', 'countries')} you have both been to.`,
        content: h('div', { class: 'compare-columns' },
            column('Both of you', both), column('Only you', onlyMine), column(`Only ${username}`, onlyTheirs)),
        submitLabel: 'Close',
        fields: []
    });
}

function friendItem(ctx, follow, redraw) {
    const status = h('small', {}, follow.public ? 'Counting…' : 'This map is private now.');
    const compare = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: true }, 'Compare');
    if (follow.public) {
        friendCountries(ctx, follow.username).then(theirs => {
            const shared = [...theirs].filter(id => ctx.state.stats.countedVisitedIds.has(id)).length;
            status.textContent = `${plural(theirs.size, 'country', 'countries')} · ${shared} in common`;
            compare.disabled = false;
            compare.addEventListener('click', () => showComparison(ctx, follow.username, theirs));
        }).catch(() => { status.textContent = 'This map is private now.'; });
    }
    return h('li', { class: 'friend' },
        h('span', {}, h('strong', {}, follow.username), status),
        compare,
        follow.public ? h('a', { class: 'btn btn-ghost btn-sm', href: `/?u=${encodeURIComponent(follow.username)}`, target: '_blank', rel: 'noopener' }, 'View') : null,
        h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': `Stop following ${follow.username}`, title: 'Stop following',
            onclick: async () => {
                try {
                    await ctx.api.unfollow(follow.username);
                    toast(`You no longer follow ${follow.username}.`);
                    redraw();
                } catch (error) {
                    ctx.handleError(error);
                }
            }
        }, '✕'));
}

async function followByName(ctx, redraw) {
    const values = await formDialog({
        title: 'Follow a map',
        message: 'Follow a friend\'s public map to see how many countries you have in common. They are not told.',
        submitLabel: 'Follow',
        fields: [{ name: 'username', label: 'Their username', required: true, maxlength: 32, autocomplete: 'off' }]
    });
    if (!values) return;
    try {
        const { username } = await ctx.api.follow(values.username.trim());
        toast(`You follow ${username}'s map.`, { tone: 'success' });
        redraw();
    } catch (error) {
        ctx.handleError(error);
    }
}

/** The Friends section of the Passport tab, filled once the followed maps are known. */
export function friendsSection(ctx) {
    const section = h('section', { class: 'friends' });
    if (ctx.state.user.guest) {
        section.append(h('h3', { class: 'section-title' }, '👥 Friends'),
            h('p', { class: 'muted small' }, 'Sign up to follow your friends\' maps and plan trips together.'));
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
            h('h3', { class: 'section-title' }, '👥 Friends', h('span', { class: 'count' }, follows.length)),
            follows.length
                ? h('ul', { class: 'friend-list' }, follows.map(follow => friendItem(ctx, follow, draw)))
                : h('p', { class: 'muted small' }, 'Follow friends\' public maps to compare the countries you have been to.'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => followByName(ctx, draw) }, '＋ Follow a map')
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
    button.textContent = following ? '✓ Following' : '＋ Follow this map';
    button.onclick = async () => {
        try {
            await ctx.api.follow(username);
            button.disabled = true;
            button.textContent = '✓ Following';
            toast(`You follow ${username}'s map. Compare it in your Passport tab.`, { tone: 'success' });
        } catch (error) {
            toast(error.message, { tone: 'error' });
        }
    };
}
