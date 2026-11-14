#!/usr/bin/env node
// Builds public/data/airports.json, the airports the flight log knows, from OurAirports (public
// domain, https://github.com/davidmegginson/ourairports-data): every airport with an IATA code
// and scheduled service, as rows [iata, name, town, lat, lng], sorted by code.
//
// Usage: node scripts/build-airports.js path/to/airports.csv
const fs = require('node:fs');
const path = require('node:path');

/** The rows of a CSV file with quoted fields, as objects keyed by the header. */
function readCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') {
                field += '"';
                i += 1;
            } else if (char === '"') quoted = false;
            else field += char;
        } else if (char === '"') quoted = true;
        else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\n') {
            row.push(field.replace(/\r$/, ''));
            rows.push(row);
            row = [];
            field = '';
        } else field += char;
    }
    if (field || row.length) rows.push([...row, field]);
    const [header, ...body] = rows;
    return body.map(values => Object.fromEntries(header.map((name, i) => [name, values[i] ?? ''])));
}

/** The airports with an IATA code and scheduled service, as compact rows sorted by code. */
function airportRows(records) {
    const round = value => Math.round(Number(value) * 1000) / 1000;
    const byCode = new Map();
    for (const record of records) {
        const code = record.iata_code.trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(code) || record.scheduled_service !== 'yes' || record.type === 'closed') continue;
        // Two airports with one code: the larger one.
        const rank = ['large_airport', 'medium_airport', 'small_airport'].indexOf(record.type);
        const known = byCode.get(code);
        if (known && known.rank <= (rank < 0 ? 9 : rank)) continue;
        byCode.set(code, { rank: rank < 0 ? 9 : rank, row: [code, record.name.trim(), record.municipality.trim(), round(record.latitude_deg), round(record.longitude_deg)] });
    }
    return [...byCode.keys()].sort().map(code => byCode.get(code).row);
}

if (require.main === module) {
    const [source] = process.argv.slice(2);
    if (!source) {
        console.error('Usage: node scripts/build-airports.js path/to/airports.csv');
        process.exit(1);
    }
    const rows = airportRows(readCsv(fs.readFileSync(source, 'utf8')));
    const target = path.join(__dirname, '..', 'public', 'data', 'airports.json');
    fs.writeFileSync(target, `${JSON.stringify(rows)}\n`);
    console.log(`Wrote ${rows.length} airports to ${target}`);
}

module.exports = { airportRows, readCsv };
