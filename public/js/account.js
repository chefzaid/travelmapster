// Signing up and in from the landing page, the account menu, settings, password change,
// account deletion and sharing.
import { h, $, $all, fill, toast, formDialog, downloadFile } from './ui.js';
import { accountArchive } from './archive.js';
import { SCHENGEN_RULE } from './days.js';
import { COUNTRY_LISTS, countedCountries } from './lists.js';
import { PALETTES, paletteId } from './palettes.js';

// ---------------------------------------------------------------- landing

// The ledger story counts the sample traveler's Schengen days live, as the Ledger tab would.
export function renderDemoLedger(ctx) {
    const schengen = ctx.currentLedger().stays.find(item => item.rule.id === SCHENGEN_RULE.id);
    fill($('#demo-ledger'),
        h('span', { 'aria-hidden': 'true' }, '🧮 '),
        'The sample traveler is in Lisbon and has used ',
        h('strong', {}, `${schengen.used} of 90`),
        ' Schengen days, so ',
        h('strong', {}, `${schengen.remaining} days`),
        ' are left today.'
    );
}

// "Sign up" and "Log in" on the landing page, and links from other pages to /#sign-up or
// /#log-in, open the account form in that mode.
export const AUTH_HASHES = { '#sign-up': 'register', '#log-in': 'login' };

export function openAuth(mode) {
    setAuthMode(mode);
    $('#account-start').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('#auth-username').focus({ preventScroll: true });
}

function setupLanding() {
    for (const button of $all('[data-auth-mode]')) {
        button.addEventListener('click', () => openAuth(button.dataset.authMode));
    }
}

// ---------------------------------------------------------------- sign up and in

let authMode = 'login';

function setAuthMode(mode) {
    authMode = mode;
    $('#tab-login').setAttribute('aria-selected', String(mode === 'login'));
    $('#tab-register').setAttribute('aria-selected', String(mode === 'register'));
    $('#auth-submit').textContent = mode === 'login' ? 'Log in' : 'Create my map';
    $('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('#auth-hint').hidden = mode === 'login';
    $('#auth-error').hidden = true;
}

export function setupAuth(ctx) {
    setupLanding();
    $('#tab-login').addEventListener('click', () => setAuthMode('login'));
    $('#tab-register').addEventListener('click', () => setAuthMode('register'));
    setAuthMode('login');

    $('#auth-form').addEventListener('submit', async event => {
        event.preventDefault();
        const username = $('#auth-username').value.trim();
        const password = $('#auth-password').value;
        const errorBox = $('#auth-error');
        errorBox.hidden = true;
        if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username) || password.length < 8) {
            errorBox.textContent = 'Usernames need 3 to 32 letters, digits, dots, dashes or underscores, and passwords 8+ characters.';
            errorBox.hidden = false;
            return;
        }
        const submit = $('#auth-submit');
        submit.disabled = true;
        try {
            if (authMode === 'register') {
                // The hidden field stays empty for people; sign-up bots fill it in.
                await ctx.api.register(username, password, $('#auth-website').value);
            }
            await ctx.api.login(username, password);
            $('#auth-password').value = '';
            if (AUTH_HASHES[location.hash]) history.replaceState(null, '', location.pathname + location.search);
            await ctx.startSession();
            toast(authMode === 'register' ? 'Welcome aboard! Your map is ready. 🗺️' : `Welcome back, ${username}!`, { tone: 'success' });
        } catch (error) {
            errorBox.textContent = error.message;
            errorBox.hidden = false;
        } finally {
            submit.disabled = false;
        }
    });

    $('#logout-btn').addEventListener('click', async () => {
        try {
            await ctx.api.logout();
        } catch {
            // Logging out locally is still the right outcome.
        }
        closeAccountMenu();
        ctx.showSignedOut();
        toast('See you on your next trip! ✈️');
    });
}

// ---------------------------------------------------------------- account menu

// Account settings that change how the map and passport count (ADR 0014, 0015).
async function openSettings(ctx) {
    const { user, index } = ctx.state;
    const countries = [...index.countries].sort((a, b) => a.name.localeCompare(b.name));
    const values = await formDialog({
        title: 'Settings',
        submitLabel: 'Save settings',
        fields: [
            { name: 'homeCountry', label: 'Home country', type: 'select', value: user.homeCountry || '',
                options: [{ value: '', label: 'No home country' }, ...countries.map(country => ({ value: country.id, label: `${country.flag} ${country.name}` }))],
                hint: 'Shown with its own color and counted as a country you have been to and lived in. It is never shown on your public map.' },
            { name: 'countryList', label: 'Count countries from', type: 'select', value: user.countryList || 'all',
                options: COUNTRY_LISTS.map(list => ({ value: list.id, label: `${list.label} (${countedCountries(index, list.id).length})` })),
                hint: 'Your passport, ranks and share of the world count only this list; the map still colors in every '
                    + 'territory. Places such as Kosovo, Taiwan or Greenland are not UN members or observers, so they count '
                    + 'only on the full list.' },
            { name: 'mapPalette', label: 'Map colors', type: 'select', value: paletteId(user.mapPalette),
                options: PALETTES.map(palette => ({ value: palette.id, label: palette.label })),
                hint: 'Color-blind safe colors keep every status apart for all kinds of color vision; print-friendly colors '
                    + 'suit paper and grayscale printers. Patterns and outlines stay the same.' },
            { name: 'publicJourneys', label: 'Show journey lines on my public map', type: 'checkbox', value: user.publicJourneys,
                hint: 'Visitors already see your visit dates; with this on, the timeline also draws the order you traveled in.' }
        ]
    });
    if (!values) return;
    const changes = {};
    if ((values.homeCountry || null) !== (user.homeCountry || null)) changes.homeCountry = values.homeCountry || null;
    if (values.countryList !== (user.countryList || 'all')) changes.countryList = values.countryList;
    if (values.mapPalette !== paletteId(user.mapPalette)) changes.mapPalette = values.mapPalette;
    if ((values.publicJourneys === 'on') !== Boolean(user.publicJourneys)) changes.publicJourneys = values.publicJourneys === 'on';
    if (!Object.keys(changes).length) return;
    await ctx.saveSettings(changes, 'Settings saved.');
}

async function changePassword(ctx) {
    const values = await formDialog({
        title: 'Change password',
        message: 'Other devices will be signed out.',
        submitLabel: 'Change password',
        fields: [
            { name: 'currentPassword', label: 'Current password', type: 'password', required: true, autocomplete: 'current-password' },
            { name: 'newPassword', label: 'New password', type: 'password', required: true, minlength: 8, autocomplete: 'new-password', hint: 'At least 8 characters.' },
            { name: 'confirmPassword', label: 'Repeat new password', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }
        ]
    });
    if (!values) return;
    if (values.newPassword !== values.confirmPassword) {
        toast('The new passwords do not match.', { tone: 'error' });
        return;
    }
    try {
        await ctx.api.changePassword(values.currentPassword, values.newPassword);
        toast('Password changed.', { tone: 'success' });
    } catch (error) {
        ctx.handleError(error);
    }
}

// Everything in the account as one ZIP archive (ADR 0017: a record you can keep).
async function downloadArchive(ctx) {
    const closeToast = toast('Packing your data…', { duration: 15000 });
    try {
        const data = await ctx.api.exportAccount();
        const date = data.exportedAt.slice(0, 10);
        downloadFile(`travelmapster-${data.profile.username}-${date}.zip`, accountArchive(data), 'application/zip');
        closeToast();
        toast('Your data archive is downloaded.', { tone: 'success' });
    } catch (error) {
        closeToast();
        ctx.handleError(error);
    }
}

async function deleteAccount(ctx) {
    const values = await formDialog({
        title: 'Delete your account?',
        message: 'Your places, trips, day ledger and passport are deleted for good. Download all your data from the account menu first if you want to keep it.',
        submitLabel: 'Delete account',
        danger: true,
        fields: [{ name: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'current-password' }]
    });
    if (!values) return;
    try {
        await ctx.api.deleteAccount(values.password);
        ctx.showSignedOut();
        toast('Your account and travel data were deleted.');
    } catch (error) {
        ctx.handleError(error);
    }
}

export function closeAccountMenu() {
    $('#account-menu').hidden = true;
    $('#account-btn').setAttribute('aria-expanded', 'false');
}

export function setupAccountMenu(ctx) {
    const button = $('#account-btn');
    const menu = $('#account-menu');
    button.addEventListener('click', () => {
        menu.hidden = !menu.hidden;
        button.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', event => {
        if (!menu.hidden && !$('#account').contains(event.target)) closeAccountMenu();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !menu.hidden) {
            closeAccountMenu();
            button.focus();
        }
    });

    $('#public-toggle').addEventListener('change', async event => {
        const visibility = event.target.checked ? 'public' : 'private';
        try {
            await ctx.api.saveProfile({ profileVisibility: visibility });
            ctx.state.user.profileVisibility = visibility;
            $('#copy-share-btn').disabled = visibility !== 'public';
            toast(visibility === 'public' ? 'Your map is public. Share the link!' : 'Your map is private again.', { tone: 'success' });
        } catch (error) {
            event.target.checked = !event.target.checked;
            ctx.handleError(error);
        }
    });

    // Each menu item closes the menu, then opens its dialog.
    const menuItem = (selector, action) => $(selector).addEventListener('click', () => {
        closeAccountMenu();
        action(ctx);
    });
    menuItem('#settings-btn', openSettings);
    menuItem('#password-btn', changePassword);
    menuItem('#export-btn', downloadArchive);
    menuItem('#delete-account-btn', deleteAccount);

    $('#copy-share-btn').addEventListener('click', async () => {
        const shareUrl = `${location.origin}/?u=${encodeURIComponent(ctx.state.user.username)}`;
        try {
            await navigator.clipboard.writeText(shareUrl);
            toast('Share link copied!', { tone: 'success' });
        } catch {
            toast(`Share link: ${shareUrl}`);
        }
    });
}
