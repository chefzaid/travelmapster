window.editingMarkerId = null;

function editMarker(id) {
    const marker = markers.find(item => String(item.id) === String(id));
    if (!marker) return;

    window.editingMarkerId = marker.id;
    document.getElementById('edit-name-input').value = marker.name;
    document.getElementById('edit-category-input').value = marker.category;
    document.getElementById('edit-lat-input').value = marker.lat;
    document.getElementById('edit-lng-input').value = marker.lng;
    document.querySelector(`input[name="pinType"][value="${marker.type}"]`).checked = true;
    document.getElementById('photo-url-input').value = marker.photoUrl || '';
    document.getElementById('notes-input').value = marker.notes || '';
    document.getElementById('travel-date-input').value = marker.travelDate || '';
    document.getElementById('edit-status').textContent = '';
    document.getElementById('edit-panel').hidden = false;
    document.getElementById('edit-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function updateMarker() {
    const status = document.getElementById('edit-status');
    const payload = {
        lat: document.getElementById('edit-lat-input').value,
        lng: document.getElementById('edit-lng-input').value,
        type: getPinType(),
        name: document.getElementById('edit-name-input').value,
        category: document.getElementById('edit-category-input').value,
        photoUrl: getPhotoUrl(),
        notes: getMarkerNotes(),
        travelDate: getTravelDate()
    };

    try {
        const response = await fetch(`/updateMarker/${window.editingMarkerId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Unable to update place.');
        }
        await loadMarkers();
        cancelEdit();
    } catch (error) {
        status.textContent = error.message;
    }
}

function cancelEdit() {
    window.editingMarkerId = null;
    document.getElementById('edit-panel').hidden = true;
    document.getElementById('edit-status').textContent = '';
}

document.getElementById('update-marker-btn').addEventListener('click', updateMarker);
document.getElementById('cancel-edit-btn').addEventListener('click', cancelEdit);
