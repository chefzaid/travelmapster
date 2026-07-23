function getPhotoUrl() {
    return document.getElementById('photo-url-input').value.trim();
}

function clearPhotoUrl() {
    document.getElementById('photo-url-input').value = '';
}

function getMarkerNotes() {
    return document.getElementById('notes-input').value.trim();
}

function clearMarkerNotes() {
    document.getElementById('notes-input').value = '';
}

function buildPhotoLink(data) {
    if (!data.photoUrl) return '';
    return `<br><a href="${escapeHtml(data.photoUrl)}" target="_blank" rel="noopener noreferrer">View photo</a><br>`;
}

function buildMarkerNotes(data) {
    if (!data.notes) return '';
    return `<br><strong>Notes:</strong> ${escapeHtml(data.notes)}<br>`;
}
