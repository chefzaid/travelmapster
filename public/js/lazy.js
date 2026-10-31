// Features used only after a click, loaded then so the first page stays light: the first page
// loads every module imported statically from app.js (docs/development.md).
export const openNewTrip = (ctx, destination) => import('./trips.js').then(module => module.openNewTrip(ctx, destination));
export const ruleDialog = (ctx, kind, rule) => import('./ledger.js').then(module => module.ruleDialog(ctx, kind, rule));
export const openSecurity = ctx => import('./security.js').then(module => module.openSecurity(ctx));
