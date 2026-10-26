// Sign-in security (ADR 0027), from the account menu: passkeys to add and remove, and two-step
// sign-in with an authenticator app, its QR code and recovery codes.
import { h, toast, formDialog, formatDate, downloadFile, steppedDialog } from './ui.js';
import { createPasskey, passkeysSupported } from './webauthn.js';
import { qrSvg } from './qr.js';
import { t, tn, tParts } from './i18n.js';

const MAX_PASSKEYS = 10;

const svgImage = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

async function addPasskey(ctx) {
    const values = await formDialog({
        title: t('Add a passkey'),
        message: t('Your device keeps the key and unlocks it with your fingerprint, face or screen lock. Name it to know it again.'),
        submitLabel: t('Create passkey'),
        fields: [{ name: 'name', label: t('Name'), value: 'Passkey', required: true, maxlength: 60 }]
    });
    if (!values) return false;
    const response = await createPasskey(await ctx.api.passkeyOptions());
    if (!response) return false;
    await ctx.api.addPasskey(values.name.trim(), response);
    toast(t('Passkey added: you can log in with it from now on.'), { tone: 'success' });
    return true;
}

async function showRecoveryCodes(codes) {
    await formDialog({
        title: t('Save your recovery codes'),
        message: t('If you lose your phone, each of these codes lets you sign in once. Keep them somewhere safe: they are shown only now.'),
        content: [
            h('ol', { class: 'recovery-codes' }, codes.map(code => h('li', {}, h('code', {}, code)))),
            h('button', {
                type: 'button', class: 'btn btn-ghost btn-sm',
                onclick: () => downloadFile('travelmapster-recovery-codes.txt', `${t('TravelMapster recovery codes')}\n\n${codes.join('\n')}\n`, 'text/plain')
            }, t('⬇️ Download them'))
        ],
        submitLabel: t('I saved them'),
        fields: []
    });
}

async function turnOnTwoStep(ctx) {
    const { secret, uri } = await ctx.api.twoStepSetup();
    for (let tries = 0; tries < 3; tries++) {
        const values = await formDialog({
            title: t('Turn on two-step sign-in'),
            message: t('Scan the code with an authenticator app (such as Google Authenticator, Microsoft Authenticator, 1Password or Aegis), then type the 6-digit code it shows.'),
            content: [
                h('img', { class: 'qr-code', src: svgImage(qrSvg(uri, { scale: 5 })), alt: t('QR code to add TravelMapster to an authenticator app'), width: 200, height: 200 }),
                h('p', { class: 'small' }, tParts('Cannot scan? Enter this key in the app: {key}', { key: h('code', { class: 'two-step-key' }, secret.match(/.{1,4}/g).join(' ')) }))
            ],
            submitLabel: t('Turn on'),
            fields: [{ name: 'code', label: t('Code from the app'), required: true, inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7, pattern: '[0-9 ]{6,7}' }]
        });
        if (!values) return false;
        try {
            const { recoveryCodes } = await ctx.api.twoStepEnable(values.code);
            await showRecoveryCodes(recoveryCodes);
            toast(t('Two-step sign-in is on.'), { tone: 'success' });
            return true;
        } catch (error) {
            toast(error.message, { tone: 'error' });
        }
    }
    return false;
}

async function turnOffTwoStep(ctx) {
    const values = await formDialog({
        title: t('Turn off two-step sign-in?'),
        message: t('Your password alone will open your account again.'),
        submitLabel: t('Turn off'),
        danger: true,
        fields: [{ name: 'password', label: t('Password'), type: 'password', required: true, autocomplete: 'current-password' }]
    });
    if (!values) return false;
    await ctx.api.twoStepDisable(values.password);
    toast(t('Two-step sign-in is off.'));
    return true;
}

function passkeyItem(ctx, passkey, step) {
    return h('li', { class: 'dialog-item passkey' },
        h('span', {}, h('strong', {}, passkey.name),
            h('small', {}, t('Added {date}', { date: formatDate(passkey.createdAt.slice(0, 10)) }), ' · ',
                passkey.lastUsedAt ? t('last used {date}', { date: formatDate(passkey.lastUsedAt.slice(0, 10)) }) : t('not used yet'))),
        h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': t('Remove the passkey {name}', { name: passkey.name }), title: t('Remove'),
            onclick: () => step(async () => {
                if (!(await ctx.confirmDialog({ title: t('Remove “{name}”?', { name: passkey.name }), message: t('It will no longer sign you in.'), confirmLabel: t('Remove passkey'), danger: true }))) return;
                await ctx.api.removePasskey(passkey.id);
                toast(t('Passkey removed.'));
            })
        }, '✕'));
}

/** The sign-in security dialog: passkeys and two-step sign-in, redrawn after each change. */
export function openSecurity(ctx) {
    return steppedDialog({
        labelledBy: 'security-title',
        load: () => ctx.api.security(),
        onError: ctx.handleError,
        draw: ({ passkeys, twoStep }, step, close) => [
            h('h3', { id: 'security-title' }, t('Sign-in security')),
            h('section', { class: 'dialog-section' },
                h('h4', {}, t('🔑 Passkeys')),
                h('p', { class: 'small' }, t('Log in with your fingerprint, face or screen lock instead of your password. Passkeys cannot be phished.')),
                passkeys.length ? h('ul', { class: 'dialog-list' }, passkeys.map(passkey => passkeyItem(ctx, passkey, step))) : null,
                passkeysSupported()
                    ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: passkeys.length >= MAX_PASSKEYS, onclick: () => step(() => addPasskey(ctx)) }, t('＋ Add a passkey'))
                    : h('p', { class: 'small muted' }, t('This browser cannot create passkeys.'))),
            h('section', { class: 'dialog-section' },
                h('h4', {}, t('📱 Two-step sign-in')),
                twoStep.enabled
                    ? h('p', { class: 'small' }, tn(twoStep.recoveryCodesLeft, 'On: after your password, a code from your authenticator app. {count} recovery code left.', 'On: after your password, a code from your authenticator app. {count} recovery codes left.'))
                    : h('p', { class: 'small' }, t('After your password, also ask for a code from an authenticator app on your phone.')),
                h('button', {
                    type: 'button', class: twoStep.enabled ? 'btn btn-danger-ghost btn-sm' : 'btn btn-ghost btn-sm',
                    onclick: () => step(() => (twoStep.enabled ? turnOffTwoStep(ctx) : turnOnTwoStep(ctx)))
                }, twoStep.enabled ? t('Turn off') : t('Turn on'))),
            h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: close }, t('Done')))
        ]
    });
}
