// Travel ideas from Wikivoyage (CC BY-SA). Parsing is pure so it can be unit tested.

const WIKIVOYAGE_API = 'https://en.wikivoyage.org/w/api.php';
const LISTING_TYPES = ['see', 'do', 'eat', 'drink', 'buy'];
const cache = new Map();

export function wikivoyageUrl(title) {
    return `https://en.wikivoyage.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}`;
}

export function stripWikiMarkup(text) {
    return String(text || '')
        .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\{\{[^{}]*\}\}/g, '')
        .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
        .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
        .replace(/'''?/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function templateField(body, field) {
    const match = body.match(new RegExp(`\\|\\s*${field}\\s*=\\s*([^|]*)`, 'i'));
    return match ? stripWikiMarkup(match[1]) : '';
}

function shorten(text, length = 160) {
    return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

// Extracts {{see|name=...}} style listings and "Cities" bullet lists from Wikivoyage wikitext.
export function parseWikivoyageListings(wikitext) {
    const ideas = Object.fromEntries(LISTING_TYPES.map(type => [type, []]));
    const text = String(wikitext || '');
    const templatePattern = /\{\{\s*(see|do|eat|drink|buy|listing)\s*\|([\s\S]*?)\}\}(?!\})/gi;
    let match;
    while ((match = templatePattern.exec(text))) {
        let type = match[1].toLowerCase();
        const body = `|${match[2]}`;
        if (type === 'listing') type = templateField(body, 'type').toLowerCase();
        if (!ideas[type]) continue;
        const name = templateField(body, 'name');
        if (!name || ideas[type].some(item => item.name === name)) continue;
        ideas[type].push({ name, description: shorten(templateField(body, 'content') || templateField(body, 'alt')) });
    }

    const destinations = [];
    const sectionPattern = /^==\s*(Cities|Other destinations|Regions)\s*==\s*$([\s\S]*?)(?=^==[^=])/gim;
    while ((match = sectionPattern.exec(`${text}\n== End ==\n`))) {
        for (const line of match[2].split('\n')) {
            const link = line.match(/^\*+\s*(?:\{\{marker[^}]*name=\[\[([^\]|]+)[^}]*\}\}|\[\[([^\]|]+)(?:\|[^\]]*)?\]\])\s*[—–-]?\s*(.*)$/i);
            if (!link) continue;
            const name = (link[1] || link[2]).trim();
            if (destinations.some(item => item.name === name)) continue;
            destinations.push({ name, description: shorten(stripWikiMarkup(link[3])) });
        }
    }

    return { ...ideas, destinations };
}

async function wikivoyage(params) {
    const url = `${WIKIVOYAGE_API}?${new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params })}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Travel guides are unavailable right now.');
    return response.json();
}

export async function fetchIdeas(destination) {
    const key = destination.trim().toLowerCase();
    if (cache.has(key)) return cache.get(key);

    const promise = (async () => {
        const [page, summary] = await Promise.all([
            wikivoyage({ action: 'parse', page: destination, prop: 'wikitext', redirects: '1' }).catch(() => null),
            wikivoyage({ action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exsentences: '3', redirects: '1', titles: destination }).catch(() => null)
        ]);
        const title = page?.parse?.title || destination;
        const ideas = page?.parse ? parseWikivoyageListings(page.parse.wikitext) : parseWikivoyageListings('');
        const extract = summary?.query?.pages?.find(item => !item.missing)?.extract || '';

        // Fall back to a guide search when the destination has no page of its own.
        let related = [];
        if (!page?.parse) {
            const search = await wikivoyage({ action: 'query', list: 'search', srsearch: destination, srlimit: '6', srnamespace: '0' });
            related = (search.query?.search || []).map(result => ({
                name: result.title,
                description: shorten(stripWikiMarkup(result.snippet))
            }));
        }
        return { title, url: wikivoyageUrl(title), summary: extract, related, ...ideas };
    })();

    cache.set(key, promise);
    promise.catch(() => cache.delete(key));
    return promise;
}

// Spreads ideas across morning, afternoon and evening slots for a trip of `days` days.
export function buildItinerary(ideas, days) {
    const daytime = [...(ideas.see || []), ...(ideas.do || []), ...(ideas.destinations || []), ...(ideas.related || [])];
    const evening = [...(ideas.eat || []), ...(ideas.drink || [])];
    const format = item => item ? (item.description ? `${item.name}: ${item.description}` : item.name) : '';
    const plan = [];
    for (let day = 0; day < days; day += 1) {
        plan.push({
            morning: format(daytime[day * 2]),
            afternoon: format(daytime[day * 2 + 1] || (ideas.buy || [])[day]),
            evening: format(evening[day])
        });
    }
    return plan;
}
