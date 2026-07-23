const suggestionsButton = document.getElementById('country-suggestions-btn');
const suggestionsStatus = document.getElementById('suggestions-status');
const suggestionsList = document.getElementById('country-suggestions-list');

function clearSuggestions() {
    suggestionsList.replaceChildren();
}

function addSuggestionResultTo(page, list) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    const summary = document.createElement('p');
    const title = page.title || 'Travel guide';
    const extract = (page.snippet || page.extract || '').replace(/<[^>]+>/g, '');

    link.href = `https://en.wikivoyage.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = title;
    summary.textContent = extract.length > 280 ? `${extract.slice(0, 277)}...` : extract;
    item.append(link, summary);
    list.appendChild(item);
}

async function loadCountrySuggestions() {
    const country = document.getElementById('country-input').value.trim();
    clearSuggestions();

    if (!country) {
        suggestionsStatus.textContent = 'Enter a country first.';
        return;
    }

    suggestionsStatus.textContent = 'Loading travel suggestions...';
    suggestionsButton.disabled = true;

    try {
        const params = new URLSearchParams({
            action: 'query',
            list: 'search',
            srsearch: `${country} travel`,
            srnamespace: '0',
            srlimit: '5',
            format: 'json',
            origin: '*'
        });
        const response = await fetch(`https://en.wikivoyage.org/w/api.php?${params}`);
        if (!response.ok) throw new Error('Travel guide service is unavailable.');
        const data = await response.json();
        const results = data.query?.search || [];

        results.forEach(page => addSuggestionResultTo(page, suggestionsList));
        suggestionsStatus.textContent = results.length
            ? `Found ${results.length} guide suggestions for ${country}.`
            : `No travel guide suggestions found for ${country}.`;
    } catch (error) {
        suggestionsStatus.textContent = error.message || 'Unable to load travel suggestions.';
    } finally {
        suggestionsButton.disabled = false;
    }
}

const citySuggestionsButton = document.getElementById('city-suggestions-btn');
const citySuggestionsStatus = document.getElementById('city-suggestions-status');
const citySuggestionsList = document.getElementById('city-suggestions-list');

async function loadCitySuggestions() {
    const city = document.getElementById('city-input').value.trim();
    citySuggestionsList.replaceChildren();

    if (!city) {
        citySuggestionsStatus.textContent = 'Enter a city first.';
        return;
    }

    citySuggestionsStatus.textContent = 'Loading sight suggestions...';
    citySuggestionsButton.disabled = true;

    try {
        const params = new URLSearchParams({
            action: 'query',
            list: 'search',
            srsearch: `${city} sights`,
            srnamespace: '0',
            srlimit: '5',
            format: 'json',
            origin: '*'
        });
        const response = await fetch(`https://en.wikivoyage.org/w/api.php?${params}`);
        if (!response.ok) throw new Error('Travel guide service is unavailable.');
        const data = await response.json();
        const results = data.query?.search || [];

        results.forEach(page => addSuggestionResultTo(page, citySuggestionsList));
        citySuggestionsStatus.textContent = results.length
            ? `Found ${results.length} sight suggestions for ${city}.`
            : `No sight suggestions found for ${city}.`;
    } catch (error) {
        citySuggestionsStatus.textContent = error.message || 'Unable to load sight suggestions.';
    } finally {
        citySuggestionsButton.disabled = false;
    }
}

suggestionsButton.addEventListener('click', loadCountrySuggestions);
document.getElementById('country-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        loadCountrySuggestions();
    }
});

citySuggestionsButton.addEventListener('click', loadCitySuggestions);
document.getElementById('city-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        loadCitySuggestions();
    }
});
