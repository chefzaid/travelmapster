// The installable app works offline with what was last loaded (ADR 0021): the service worker,
// and a word to the traveler when the network comes and goes.
import { toast } from './ui.js';
import { t } from './i18n.js';

export function setupOffline() {
    navigator.serviceWorker?.register('/sw.js').catch(error => console.warn('Offline mode is unavailable', error));
    window.addEventListener('offline', () => toast(t('You are offline: your map shows as last loaded, and changes will not save until you are back online.'), { duration: 8000 }));
    window.addEventListener('online', () => toast(t('Back online.'), { tone: 'success' }));
}
