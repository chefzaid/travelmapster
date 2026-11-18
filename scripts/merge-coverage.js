#!/usr/bin/env node
// Joins the LCOV reports that the parallel CI test suites write into one report, prints the
// totals for GitLab's coverage pattern, and fails under the line coverage threshold of the
// test:coverage script in package.json, as `node --test` does for a single run:
//
//   node scripts/merge-coverage.js coverage/lcov.info coverage/unit/lcov.info coverage/...
//
// Lines merge exactly: a line counts as covered when any suite ran it, and lines that
// `node:coverage ignore` comments skip count as covered, as in Node's own totals. Functions
// merge by line and name, and branches by line and position on that line; Node numbers them
// by what each run executed, so their totals are close to a single run's, not exact.

const fs = require('node:fs');
const path = require('node:path');

const [output, ...reports] = process.argv.slice(2);
if (!output || reports.length === 0) {
    console.error('Usage: node scripts/merge-coverage.js <output> <report>...');
    process.exit(2);
}

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const thresholdMatch = /--test-coverage-lines=(\d+(?:\.\d+)?)/.exec(pkg.scripts['test:coverage'] || '');
if (!thresholdMatch) {
    console.error('The test:coverage script in package.json sets no --test-coverage-lines threshold.');
    process.exit(2);
}
const threshold = Number(thresholdMatch[1]);

const files = new Map();

function fileEntry(name) {
    if (!files.has(name)) files.set(name, { lineCount: 0, lines: new Map(), functions: new Map(), branches: new Map() });
    return files.get(name);
}

function add(map, key, value) {
    map.set(key, (map.get(key) || 0) + value);
}

function count(text) {
    const value = Number(text);
    return Number.isFinite(value) ? value : 0;
}

for (const report of reports) {
    if (!fs.existsSync(report)) {
        console.error(`Missing coverage report ${report}: did every test suite run and upload it?`);
        process.exit(1);
    }
    let file = null;
    let functions = [];
    let hits = [];
    const seen = new Map();
    const branchesOnLine = new Map();
    for (const raw of fs.readFileSync(report, 'utf8').split('\n')) {
        const line = raw.trim();
        const colon = line.indexOf(':');
        const tag = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? '' : line.slice(colon + 1);
        if (tag === 'SF') {
            file = fileEntry(value);
            functions = [];
            hits = [];
            seen.clear();
            branchesOnLine.clear();
        } else if (!file) {
            continue;
        } else if (tag === 'FN') {
            const comma = value.indexOf(',');
            const at = value.slice(0, comma);
            const name = value.slice(comma + 1);
            // Anonymous functions are named by their index in the run, so they match by line.
            const base = `${at},${/^anonymous_\d+$/.test(name) ? '' : name}`;
            const nth = (seen.get(base) || 0) + 1;
            seen.set(base, nth);
            functions.push({ key: `${base}#${nth}`, line: Number(at), name });
        } else if (tag === 'FNDA') {
            hits.push(count(value.slice(0, value.indexOf(','))));
        } else if (tag === 'BRDA') {
            const [at, , , taken] = value.split(',');
            const nth = (branchesOnLine.get(at) || 0) + 1;
            branchesOnLine.set(at, nth);
            add(file.branches, `${at},${nth}`, count(taken));
        } else if (tag === 'DA') {
            const [at, hit] = value.split(',');
            add(file.lines, Number(at), count(hit));
        } else if (tag === 'LF') {
            file.lineCount = Math.max(file.lineCount, count(value));
        } else if (tag === 'end_of_record') {
            functions.forEach((fn, i) => {
                const known = file.functions.get(fn.key);
                file.functions.set(fn.key, { line: fn.line, name: known ? known.name : fn.name, count: (known ? known.count : 0) + (hits[i] || 0) });
            });
            file = null;
        }
    }
}

const totals = { lines: 0, coveredLines: 0, branches: 0, coveredBranches: 0, functions: 0, coveredFunctions: 0 };
let lcov = '';
for (const name of [...files.keys()].sort()) {
    const file = files.get(name);
    const lineCount = Math.max(file.lineCount, file.lines.size);
    const ignored = lineCount - file.lines.size;
    const coveredLines = ignored + [...file.lines.values()].filter(hit => hit > 0).length;
    const functions = [...file.functions.values()].sort((a, b) => a.line - b.line);
    const branches = [...file.branches.entries()].map(([key, taken]) => ({ line: Number(key.split(',')[0]), taken }))
        .sort((a, b) => a.line - b.line);
    const coveredFunctions = functions.filter(fn => fn.count > 0).length;
    const coveredBranches = branches.filter(branch => branch.taken > 0).length;

    lcov += `TN:\nSF:${name}\n`;
    const named = functions.map((fn, i) => ({ ...fn, name: /^anonymous_\d+$/.test(fn.name) ? `anonymous_${i}` : fn.name }));
    for (const fn of named) lcov += `FN:${fn.line},${fn.name}\n`;
    for (const fn of named) lcov += `FNDA:${fn.count},${fn.name}\n`;
    lcov += `FNF:${functions.length}\nFNH:${coveredFunctions}\n`;
    branches.forEach((branch, i) => { lcov += `BRDA:${branch.line},${i},0,${branch.taken}\n`; });
    lcov += `BRF:${branches.length}\nBRH:${coveredBranches}\n`;
    for (const at of [...file.lines.keys()].sort((a, b) => a - b)) lcov += `DA:${at},${file.lines.get(at)}\n`;
    lcov += `LH:${coveredLines}\nLF:${lineCount}\nend_of_record\n`;

    totals.lines += lineCount;
    totals.coveredLines += coveredLines;
    totals.branches += branches.length;
    totals.coveredBranches += coveredBranches;
    totals.functions += functions.length;
    totals.coveredFunctions += coveredFunctions;
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, lcov);

const percent = (covered, total) => (total === 0 ? 100 : (covered / total) * 100);
const linePercent = percent(totals.coveredLines, totals.lines);
console.log(`Joined ${reports.length} coverage reports for ${files.size} files into ${output}.`);
console.log('file      | line % | branch % | funcs %');
console.log(`all files | ${linePercent.toFixed(2)} | ${percent(totals.coveredBranches, totals.branches).toFixed(2)} | `
    + `${percent(totals.coveredFunctions, totals.functions).toFixed(2)}`);
if (linePercent < threshold) {
    console.error(`Error: ${linePercent.toFixed(2)}% line coverage does not meet threshold of ${threshold}%.`);
    process.exit(1);
}
