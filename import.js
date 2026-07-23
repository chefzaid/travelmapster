const importFileInput = document.getElementById('import-file');
const importStatus = document.getElementById('import-status');

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (character === '"') {
            if (inQuotes && text[index + 1] === '"') {
                field += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (character === ',' && !inQuotes) {
            row.push(field);
            field = '';
        } else if (character === '\n' && !inQuotes) {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else if (character !== '\r' || inQuotes) {
            field += character;
        }
    }

    if (inQuotes) {
        throw new Error('CSV contains an unterminated quoted field.');
    }

    if (field || row.length) {
        row.push(field);
        rows.push(row);
    }

    if (rows.length === 0) {
        return [];
    }

    const headers = rows.shift().map(header => header.trim().toLowerCase());
    const requiredHeaders = ['lat', 'lng', 'type', 'name', 'category'];
    if (requiredHeaders.some(header => !headers.includes(header))) {
        throw new Error('CSV must include lat, lng, type, name, and category columns.');
    }

    return rows
        .filter(values => values.some(value => value.trim() !== ''))
        .map(values => Object.fromEntries(
            headers.map((header, index) => [header, values[index] ?? ''])
        ));
}

function parseImportContent(fileName, content) {
    const extension = fileName.toLowerCase().split('.').pop();
    if (extension === 'json') {
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? parsed : parsed.markers;
    }
    if (extension === 'csv') {
        return parseCsv(content);
    }
    throw new Error('Choose a .json or .csv file.');
}

function validateImportRecord(record) {
    const lat = Number(record.lat);
    const lng = Number(record.lng);
    const type = typeof record.type === 'string' ? record.type.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const category = typeof record.category === 'string' ? record.category.trim() : '';

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
    if (!['visited', 'wishlist'].includes(type)) return null;
    if (!['Country', 'City'].includes(category) || !name) return null;

    return { lat, lng, type, name, category };
}

async function importSavedPlaces() {
    const file = importFileInput.files[0];
    if (!file) {
        importStatus.textContent = 'Choose a JSON or CSV file first.';
        return;
    }

    try {
        const records = parseImportContent(file.name, await file.text());
        if (!Array.isArray(records)) {
            throw new Error('The import file must contain an array of saved places.');
        }

        let imported = 0;
        let skipped = 0;
        for (const record of records) {
            const marker = validateImportRecord(record);
            if (!marker) {
                skipped += 1;
                continue;
            }

            const response = await fetch('/addMarker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(marker)
            });
            if (response.ok) {
                imported += 1;
            } else {
                skipped += 1;
            }
        }

        await loadMarkers();
        importStatus.textContent = `Imported ${imported} places; skipped ${skipped}.`;
    } catch (error) {
        importStatus.textContent = error.message || 'Unable to import that file.';
    } finally {
        importFileInput.value = '';
    }
}

document.getElementById('import-places-btn').addEventListener('click', importSavedPlaces);
