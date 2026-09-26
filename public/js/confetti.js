// A tiny celebratory burst of emoji confetti. Respects reduced-motion preferences.

const PIECES = ['🎉', '✨', '🌍', '✈️', '⭐', '🎈'];

export function celebrate() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const layer = document.createElement('div');
    layer.className = 'confetti';
    layer.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 28; i += 1) {
        const piece = document.createElement('span');
        piece.textContent = PIECES[i % PIECES.length];
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.animationDelay = `${Math.random() * 0.4}s`;
        piece.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
        piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 200}px`);
        piece.style.setProperty('--spin', `${(Math.random() - 0.5) * 720}deg`);
        layer.append(piece);
    }
    document.body.append(layer);
    setTimeout(() => layer.remove(), 3400);
}
