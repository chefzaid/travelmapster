// Signing up and in from the landing page (with a passkey or a second step, ADR 0027), the
// account menu, settings, password change, account deletion and sharing.
import { h, $, $all, fill, toast, formDialog, downloadFile, copyText } from './ui.js';
import { passkeysSupported, usePasskey } from './webauthn.js';
import { openOrgs } from './orgs.js';
import { SCHENGEN_RULE } from './days.js';
import { COUNTRY_LISTS, countedCountries } from './lists.js';
import { PALETTES, paletteId } from './palettes.js';
import { LOCALES, locale, rememberLocale, t, tParts, tn } from './i18n.js';
import { showPanel } from './panel.js';
import { openSecurity } from './lazy.js';
import { AUTH_HASHES } from './home.js';
import { DISTANCE_UNITS, distanceUnit, rememberDistanceUnit } from './units.js';
import { THEMES, applyTheme, rememberTheme, storedTheme } from './theme.js';

// ---------------------------------------------------------------- landing

// The ledger story counts the sample traveler's Schengen days live, as the Ledger tab would.
export function renderDemoLedger(ctx) {
    const schengen = ctx.currentLedger().stays.find(item => item.rule.id === SCHENGEN_RULE.id);
    fill($('#demo-ledger'),
        h('span', { 'aria-hidden': 'true' }, '🧮 '),
        tParts('The sample traveler is in Lisbon and has used {used} Schengen days, so {left} are left today.', {
            used: h('strong', {}, t('{used} of 90', { used: schengen.used })),
            left: h('strong', {}, tn(schengen.remaining, '{count} day', '{count} days'))
        })
    );
}

// "Sign up" and "Log in" on the landing page, and links from other pages to /#sign-up or
// /#log-in, open the account form in that mode.

export function openAuth(mode) {
    showPanel();
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
    $('#auth-submit').textContent = mode === 'login' ? t('Log in') : t('Create my map');
    $('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('#auth-hint').hidden = mode === 'login';
    $('#auth-error').hidden = true;
    $('#passkey-login').hidden = mode !== 'login' || !passkeysSupported();
    showSecondStep(false);
}

// ---------------------------------------------------------------- second step and passkeys

let recoveryMode = false;

function showSecondStep(show) {
    $('#auth-form').hidden = show;
    $('#second-step-form').hidden = !show;
    $('#second-step-error').hidden = true;
    $('#second-step-code').value = '';
    if (show) $('#second-step-code').focus();
}

function setRecoveryMode(on) {
    recoveryMode = on;
    $('#second-step-intro').textContent = on ? t('Enter one of your recovery codes. Each works once.') : t('Enter the 6-digit code from your authenticator app.');
    $('#second-step-label').textContent = on ? t('Recovery code') : t('Code');
    $('#second-step-code').inputMode = on ? 'text' : 'numeric';
    $('#second-step-code').autocomplete = on ? 'off' : 'one-time-code';
    $('#second-step-recovery').textContent = on ? t('Use a code from the app instead') : t('Use a recovery code instead');
    $('#second-step-code').focus();
}

async function finishSignIn(ctx, message) {
    if (AUTH_HASHES[location.hash]) history.replaceState(null, '', location.pathname + location.search);
    await ctx.startSession();
    toast(message, { tone: 'success' });
}

function setupSecondStep(ctx) {
    $('#second-step-recovery').addEventListener('click', () => setRecoveryMode(!recoveryMode));
    $('#second-step-cancel').addEventListener('click', () => {
        setRecoveryMode(false);
        showSecondStep(false);
        $('#auth-password').focus();
    });
    $('#second-step-form').addEventListener('submit', async event => {
        event.preventDefault();
        const answer = $('#second-step-code').value.trim();
        if (!answer) return;
        const submit = $('#second-step-submit');
        submit.disabled = true;
        try {
            const user = await ctx.api.secondStep(recoveryMode ? { recoveryCode: answer } : { code: answer });
            setRecoveryMode(false);
            showSecondStep(false);
            await finishSignIn(ctx, t('Welcome back, {username}!', { username: user.username }));
        } catch (error) {
            $('#second-step-error').textContent = error.message;
            $('#second-step-error').hidden = false;
            // The attempt expired: back to the password.
            if (error.status === 401) showSecondStep(false);
        } finally {
            submit.disabled = false;
        }
    });
    $('#passkey-login').addEventListener('click', async () => {
        const errorBox = $('#auth-error');
        errorBox.hidden = true;
        try {
            const response = await usePasskey(await ctx.api.passkeyLoginOptions());
            if (!response) return;
            const user = await ctx.api.passkeyLogin(response);
            await finishSignIn(ctx, t('Welcome back, {username}!', { username: user.username }));
        } catch (error) {
            errorBox.textContent = error.message;
            errorBox.hidden = false;
        }
    });
}

export function setupAuth(ctx) {
    setupLanding();
    $('#tab-login').addEventListener('click', () => setAuthMode('login'));
    $('#tab-register').addEventListener('click', () => setAuthMode('register'));
    setupSecondStep(ctx);
    setAuthMode('login');

    $('#auth-form').addEventListener('submit', async event => {
        event.preventDefault();
        const username = $('#auth-username').value.trim();
        const password = $('#auth-password').value;
        const errorBox = $('#auth-error');
        errorBox.hidden = true;
        if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username) || password.length < 8) {
            errorBox.textContent = t('Usernames need 3 to 32 letters, digits, dots, dashes or underscores, and passwords 8+ characters.');
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
            const result = await ctx.api.login(username, password);
            $('#auth-password').value = '';
            // Two-step sign-in is on: the session opens after the code.
            if (result?.secondStep) {
                showSecondStep(true);
                return;
            }
            await finishSignIn(ctx, authMode === 'register' ? t('Welcome aboard! Your map is ready. 🗺️') : t('Welcome back, {username}!', { username }));
        } catch (error) {
            errorBox.textContent = error.message;
            errorBox.hidden = false;
        } finally {
            submit.disabled = false;
        }
    });

    $('#logout-btn').addEventListener('click', async () => {
        const guest = Boolean(ctx.state.user?.guest);
        try {
            await ctx.api.logout();
        } catch {
            // Logging out locally is still the right outcome.
        }
        closeAccountMenu();
        ctx.showSignedOut();
        toast(guest ? t('Your guest map stays in this browser. See you soon! ✈️') : t('See you on your next trip! ✈️'));
    });
}

// ---------------------------------------------------------------- account menu

// Account settings that change how the map and passport count (ADR 0014, 0015).
async function openSettings(ctx) {
    const { user, index } = ctx.state;
    const countries = [...index.countries].sort((a, b) => a.name.localeCompare(b.name));
    const values = await formDialog({
        title: t('Settings'),
        submitLabel: t('Save settings'),
        fields: [
            { name: 'locale', label: t('Language'), type: 'select', value: locale(),
                options: Object.entries(LOCALES).map(([value, { name }]) => ({ value, label: name })) },
            { name: 'distanceUnit', label: t('Distances in'), type: 'select', value: distanceUnit(),
                options: Object.entries(DISTANCE_UNITS).map(([value, { label }]) => ({ value, label })),
                hint: t('Kept in this browser, like the language.') },
            { name: 'theme', label: t('Light or dark'), type: 'select', value: storedTheme(),
                options: Object.entries(THEMES).map(([value, { label }]) => ({ value, label })) },
            { name: 'homeCountry', label: t('Home country'), type: 'select', value: user.homeCountry || '',
                options: [{ value: '', label: t('No home country') }, ...countries.map(country => ({ value: country.id, label: `${country.flag} ${country.name}` }))],
                hint: t('Shown with its own color and counted as a country you have been to and lived in. It is never shown on your public map.') },
            { name: 'countryList', label: t('Count countries from'), type: 'select', value: user.countryList || 'all',
                options: COUNTRY_LISTS.map(list => ({ value: list.id, label: `${list.label} (${countedCountries(index, list.id).length})` })),
                hint: t('Your passport, ranks and share of the world count only this list; the map still colors in every territory. Places such as Kosovo, Taiwan or Greenland are not UN members or observers, so they count only on the full list.') },
            { name: 'mapPalette', label: t('Map colors'), type: 'select', value: paletteId(user.mapPalette),
                options: PALETTES.map(palette => ({ value: palette.id, label: palette.label })),
                hint: t('Color-blind safe colors keep every status apart for all kinds of color vision; print-friendly colors suit paper and grayscale printers. Patterns and outlines stay the same.') },
            // A guest map is never public.
            ...(user.guest ? [] : [
                { name: 'publicJourneys', label: t('Show journey lines on my public map'), type: 'checkbox', value: user.publicJourneys,
                    hint: t('Visitors already see your visit dates; with this on, the timeline also draws the order you traveled in.') },
                { name: 'publicIndexing', label: t('Let search engines list my public map'), type: 'checkbox', value: user.publicIndexing,
                    hint: t('Only while your map is public. Off, your shared link still works and shows a preview, but asks search engines not to list it. Search engines can take a few weeks to drop a page.') }
            ])
        ]
    });
    if (!values) return;
    const changes = {};
    if ((values.homeCountry || null) !== (user.homeCountry || null)) changes.homeCountry = values.homeCountry || null;
    if (values.countryList !== (user.countryList || 'all')) changes.countryList = values.countryList;
    if (values.mapPalette !== paletteId(user.mapPalette)) changes.mapPalette = values.mapPalette;
    if (!user.guest) {
        if ((values.publicJourneys === 'on') !== Boolean(user.publicJourneys)) changes.publicJourneys = values.publicJourneys === 'on';
        if ((values.publicIndexing === 'on') !== Boolean(user.publicIndexing)) changes.publicIndexing = values.publicIndexing === 'on';
    }
    // Kept in this browser: distances and the theme.
    const unitChanged = values.distanceUnit !== distanceUnit();
    const themeChanged = values.theme !== storedTheme();
    if (unitChanged) rememberDistanceUnit(values.distanceUnit);
    if (themeChanged) {
        rememberTheme(values.theme);
        applyTheme(values.theme);
        ctx.map?.refreshTheme();
    }
    if ((unitChanged || themeChanged) && !Object.keys(changes).length) {
        ctx.renderActiveTab();
        toast(t('Settings saved.'), { tone: 'success' });
    }
    if (Object.keys(changes).length) await ctx.saveSettings(changes, t('Settings saved.'));
    // A new language redraws the whole page in it (ADR 0031).
    if (values.locale !== locale()) {
        rememberLocale(values.locale);
        location.reload();
    }
}

async function changePassword(ctx) {
    const values = await formDialog({
        title: t('Change password'),
        message: t('Other devices will be signed out.'),
        submitLabel: t('Change password'),
        fields: [
            { name: 'currentPassword', label: t('Current password'), type: 'password', required: true, autocomplete: 'current-password' },
            { name: 'newPassword', label: t('New password'), type: 'password', required: true, minlength: 8, autocomplete: 'new-password', hint: t('At least 8 characters.') },
            { name: 'confirmPassword', label: t('Repeat new password'), type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }
        ]
    });
    if (!values) return;
    if (values.newPassword !== values.confirmPassword) {
        toast(t('The new passwords do not match.'), { tone: 'error' });
        return;
    }
    try {
        await ctx.api.changePassword(values.currentPassword, values.newPassword);
        toast(t('Password changed.'), { tone: 'success' });
    } catch (error) {
        ctx.handleError(error);
    }
}

// Everything in the account as one ZIP archive (ADR 0017: a record you can keep).
async function downloadArchive(ctx) {
    const closeToast = toast(t('Packing your data…'), { duration: 15000 });
    try {
        const [data, { accountArchive }] = await Promise.all([ctx.api.exportAccount(), import('./archive.js')]);
        const date = data.exportedAt.slice(0, 10);
        downloadFile(`travelmapster-${data.profile.username}-${date}.zip`, accountArchive(data), 'application/zip');
        closeToast();
        toast(t('Your data archive is downloaded.'), { tone: 'success' });
    } catch (error) {
        closeToast();
        ctx.handleError(error);
    }
}

async function deleteAccount(ctx) {
    const values = await formDialog({
        title: t('Delete your account?'),
        message: t('Your places, trips, day ledger and passport are deleted for good. Download all your data from the account menu first if you want to keep it.'),
        submitLabel: t('Delete account'),
        danger: true,
        fields: [{ name: 'password', label: t('Password'), type: 'password', required: true, autocomplete: 'current-password' }]
    });
    if (!values) return;
    try {
        await ctx.api.deleteAccount(values.password);
        ctx.showSignedOut();
        toast(t('Your account and travel data were deleted.'));
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
            for (const id of ['#copy-share-btn', '#embed-btn']) $(id).disabled = visibility !== 'public';
            toast(visibility === 'public' ? t('Your map is public. Share the link!') : t('Your map is private again.'), { tone: 'success' });
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
    menuItem('#security-btn', openSecurity);
    menuItem('#orgs-btn', openOrgs);
    menuItem('#export-btn', downloadArchive);
    menuItem('#delete-account-btn', deleteAccount);

    const copy = (text, done, label) => copyText(text, done, `${label}: ${text}`);
    $('#copy-share-btn').addEventListener('click', () =>
        copy(`${location.origin}/?u=${encodeURIComponent(ctx.state.user.username)}`, t('Share link copied!'), t('Share link')));
    // A frame for blogs and personal sites, read-only and without notes (ADR 0020).
    $('#embed-btn').addEventListener('click', () => {
        closeAccountMenu();
        const { username } = ctx.state.user;
        copy(`<iframe src="${location.origin}/embed/${encodeURIComponent(username)}" title="${t('{username}\'s travel map', { username })}" width="640" height="420" style="border:0" loading="lazy"></iframe>`,
            t('Embed code copied: paste it into your website.'), t('Embed code'));
    });
}
