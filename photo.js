function getPhotoUrl() {
    return document.getElementById('photo-url-input').value.trim();
}

function clearPhotoUrl() {
    document.getElementById('photo-url-input').value = '';
}

function buildPhotoLink(data) {
    if (!data.photoUrl) return '';
    return `<br><a href="${escapeHtml(data.photoUrl)}" target="_blank" rel="noopener noreferrer">View photo</a><br>`;
}
