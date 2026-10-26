// Sign-in security (ADR 0027), from the account menu: passkeys to add and remove, and two-step
// sign-in with an authenticator app, its QR code and recovery codes.
import { h, toast, formDialog, formatDate, downloadFile } from './ui.js';
import { createPasskey, passkeysSupported } from './webauthn.js';
import { qrSvg } from './qr.js';

const MAX_PASSKEYS = 10;

const svgImage = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

async function addPasskey(ctx) {
    const values = await formDialog({
        title: 'Add a passkey',
        message: 'Your device keeps the key and unlocks it with your fingerprint, face or screen lock. Name it to know it again.',
        submitLabel: 'Create passkey',
        fields: [{ name: 'name', label: 'Name', value: 'Passkey', required: true, maxlength: 60 }]
    });
    if (!values) return false;
    const response = await createPasskey(await ctx.api.passkeyOptions());
    if (!response) return false;
    await ctx.api.addPasskey(values.name.trim(), response);
    toast('Passkey added: you can log in with it from now on.', { tone: 'success' });
    return true;
}

async function showRecoveryCodes(codes) {
    await formDialog({
        title: 'Save your recovery codes',
        message: 'If you lose your phone, each of these codes lets you sign in once. Keep them somewhere safe: they are shown only now.',
        content: [
            h('ol', { class: 'recovery-codes' }, codes.map(code => h('li', {}, h('code', {}, code)))),
            h('button', {
                type: 'button', class: 'btn btn-ghost btn-sm',
                onclick: () => downloadFile('travelmapster-recovery-codes.txt', `TravelMapster recovery codes\n\n${codes.join('\n')}\n`, 'text/plain')
            }, '⬇️ Download them')
        ],
        submitLabel: 'I saved them',
        fields: []
    });
}

async function turnOnTwoStep(ctx) {
    const { secret, uri } = await ctx.api.twoStepSetup();
    for (let tries = 0; tries < 3; tries++) {
        const values = await formDialog({
            title: 'Turn on two-step sign-in',
            message: 'Scan the code with an authenticator app (such as Google Authenticator, Microsoft Authenticator, 1Password or Aegis), then type the 6-digit code it shows.',
            content: [
                h('img', { class: 'qr-code', src: svgImage(qrSvg(uri, { scale: 5 })), alt: 'QR code to add TravelMapster to an authenticator app', width: 200, height: 200 }),
                h('p', { class: 'small' }, 'Cannot scan? Enter this key in the app: ', h('code', { class: 'two-step-key' }, secret.match(/.{1,4}/g).join(' ')))
            ],
            submitLabel: 'Turn on',
            fields: [{ name: 'code', label: 'Code from the app', required: true, inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7, pattern: '[0-9 ]{6,7}' }]
        });
        if (!values) return false;
        try {
            const { recoveryCodes } = await ctx.api.twoStepEnable(values.code);
            await showRecoveryCodes(recoveryCodes);
            toast('Two-step sign-in is on.', { tone: 'success' });
            return true;
        } catch (error) {
            toast(error.message, { tone: 'error' });
        }
    }
    return false;
}

async function turnOffTwoStep(ctx) {
    const values = await formDialog({
        title: 'Turn off two-step sign-in?',
        message: 'Your password alone will open your account again.',
        submitLabel: 'Turn off',
        danger: true,
        fields: [{ name: 'password', label: 'Password', type: 'password', required: true, autocomplete: 'current-password' }]
    });
    if (!values) return false;
    await ctx.api.twoStepDisable(values.password);
    toast('Two-step sign-in is off.');
    return true;
}

function passkeyItem(ctx, passkey, step) {
    return h('li', { class: 'passkey' },
        h('span', {}, h('strong', {}, passkey.name),
            h('small', {}, `Added ${formatDate(passkey.createdAt.slice(0, 10))}`,
                passkey.lastUsedAt ? ` · last used ${formatDate(passkey.lastUsedAt.slice(0, 10))}` : ' · not used yet')),
        h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': `Remove the passkey ${passkey.name}`, title: 'Remove',
            onclick: () => step(async () => {
                if (!(await ctx.confirmDialog({ title: `Remove “${passkey.name}”?`, message: 'It will no longer sign you in.', confirmLabel: 'Remove passkey', danger: true }))) return;
                await ctx.api.removePasskey(passkey.id);
                toast('Passkey removed.');
            })
        }, '✕'));
}

/** The sign-in security dialog: passkeys and two-step sign-in, redrawn after each change. */
export async function openSecurity(ctx) {
    const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'security-title' });
    const body = h('div', { class: 'dialog-body' });
    dialog.append(body);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    // Each step's own dialog opens over this one, which waits closed meanwhile.
    const step = async action => {
        dialog.close();
        try {
            await action();
        } catch (error) {
            ctx.handleError(error);
        }
        openSecurity(ctx);
    };
    let status;
    try {
        status = await ctx.api.security();
    } catch (error) {
        dialog.remove();
        ctx.handleError(error);
        return;
    }
    const { passkeys, twoStep } = status;
    body.append(
        h('h3', { id: 'security-title' }, 'Sign-in security'),
        h('section', { class: 'security-section' },
            h('h4', {}, '🔑 Passkeys'),
            h('p', { class: 'small' }, 'Log in with your fingerprint, face or screen lock instead of your password. Passkeys cannot be phished.'),
            passkeys.length ? h('ul', { class: 'passkey-list' }, passkeys.map(passkey => passkeyItem(ctx, passkey, step))) : null,
            passkeysSupported()
                ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: passkeys.length >= MAX_PASSKEYS, onclick: () => step(() => addPasskey(ctx)) }, '＋ Add a passkey')
                : h('p', { class: 'small muted' }, 'This browser cannot create passkeys.')),
        h('section', { class: 'security-section' },
            h('h4', {}, '📱 Two-step sign-in'),
            twoStep.enabled
                ? h('p', { class: 'small' }, `On: after your password, a code from your authenticator app. ${twoStep.recoveryCodesLeft} recovery ${twoStep.recoveryCodesLeft === 1 ? 'code' : 'codes'} left.`)
                : h('p', { class: 'small' }, 'After your password, also ask for a code from an authenticator app on your phone.'),
            h('button', {
                type: 'button', class: twoStep.enabled ? 'btn btn-danger-ghost btn-sm' : 'btn btn-ghost btn-sm',
                onclick: () => step(() => (twoStep.enabled ? turnOffTwoStep(ctx) : turnOnTwoStep(ctx)))
            }, twoStep.enabled ? 'Turn off' : 'Turn on')),
        h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dialog.close() }, 'Done'))
    );
    dialog.showModal();
}
