// Sign-in security's API tokens: read-only access to the traveler's own data on the documented
// API, for an accountant's or HR system's integration (src/api-tokens.js). A token is shown
// once when made, and revoking it ends it at once.
import { h, toast, formDialog, formatDate, copyText } from './ui.js';
import { t } from './i18n.js';

const MAX_TOKENS = 10;

async function makeToken(ctx) {
    const values = await formDialog({
        title: t('Make an API token'),
        message: t('It reads your places, visits, trips and ledger on the API, and the reports of organizations you manage. It never changes anything, and never reaches your sign-in security.'),
        submitLabel: t('Make token'),
        fields: [{ name: 'name', label: t('Name'), required: true, maxlength: 60, placeholder: t('My accountant'), autocomplete: 'off' }]
    });
    if (!values?.name?.trim()) return false;
    const { token, name } = await ctx.api.createApiToken(values.name.trim());
    await formDialog({
        title: t('Your API token “{name}”', { name }),
        message: t('Copy it now: it is shown only once. Send it as "Authorization: Bearer" with each request, and keep it as safe as a password.'),
        content: [
            h('input', { id: 'api-token-value', value: token, readonly: true, class: 'token-value', 'aria-label': t('API token') }),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => copyText(token, t('API token copied.'), t('API token: {token}', { token })) }, t('📋 Copy the token'))
        ],
        submitLabel: t('Done'),
        fields: []
    });
    return true;
}

function tokenItem(ctx, token, step) {
    return h('li', { class: 'dialog-item' },
        h('span', {}, h('strong', {}, token.name),
            h('small', {}, t('Made {date}', { date: formatDate(token.createdAt.slice(0, 10)) }), ' · ',
                token.lastUsedAt ? t('last used {date}', { date: formatDate(token.lastUsedAt.slice(0, 10)) }) : t('not used yet'))),
        h('button', {
            type: 'button', class: 'btn btn-danger-ghost btn-sm', 'aria-label': t('Revoke the API token {name}', { name: token.name }),
            onclick: () => step(async () => {
                if (!(await ctx.confirmDialog({ title: t('Revoke “{name}”?', { name: token.name }), message: t('Integrations using it stop at once.'), confirmLabel: t('Revoke'), danger: true }))) return;
                await ctx.api.revokeApiToken(token.id);
                toast(t('API token revoked.'));
            })
        }, t('Revoke')));
}

/** The API tokens section of the sign-in security dialog. */
export function tokensSection(ctx, tokens, step) {
    return h('section', { class: 'dialog-section' },
        h('h4', {}, t('🔌 API tokens')),
        h('p', { class: 'small' }, t('Let an accountant\'s or HR system read your data through the API, without your password. Revoke a token you no longer use.')),
        tokens.length ? h('ul', { class: 'dialog-list', id: 'api-tokens' }, tokens.map(token => tokenItem(ctx, token, step))) : null,
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: tokens.length >= MAX_TOKENS, onclick: () => step(() => makeToken(ctx)) }, t('＋ Make a token')));
}
