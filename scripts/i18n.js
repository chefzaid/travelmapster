'use strict';

// Translation keys (ADR 0031): every t('…'), tn(n, '…', '…') and tk('…') in the browser modules
// and every data-i18n text and attribute in the pages, checked against public/locales/*.json.
//   node scripts/i18n.js check     lists missing, stale and broken entries (exit 1 if any)
//   node scripts/i18n.js sync      adds missing keys (empty, so the English shows) and drops stale ones
//   node scripts/i18n.js strings   lists literals that look like interface text but are not keys
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const root = path.join(__dirname, '..');
const jsDir = path.join(root, 'public', 'js');
const localesDir = path.join(root, 'public', 'locales');
const PAGES = ['index.html', 'schengen-calculator.html', 'embed.html'];
const LOCALES = ['fr', 'es', 'de', 'ar'];
// Server error messages travelers see as toasts; the client translates them when it can.
const SERVER_FILES = ['src/routes', 'src/validation.js', 'src/ledger-validation.js', 'src/trip-validation.js'];

function walk(node, visit, ancestors = []) {
    if (!node || typeof node.type !== 'string') return;
    visit(node, ancestors);
    const next = [...ancestors, node];
    for (const key of Object.keys(node)) {
        const value = node[key];
        if (Array.isArray(value)) for (const child of value) walk(child, visit, next);
        else if (value && typeof value.type === 'string') walk(value, visit, next);
    }
}

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'MethodDefinition']);
const literal = node => (node?.type === 'Literal' && typeof node.value === 'string' ? node.value
    : node?.type === 'TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : null);

/** Keys of one browser module, with the problems found in it. */
function scanModule(file) {
    const source = fs.readFileSync(file, 'utf8');
    const ast = acorn.parse(source, { ecmaVersion: 2024, sourceType: 'module', locations: true });
    const keys = new Map();
    const problems = [];
    const where = node => `${path.relative(root, file)}:${node.loc.start.line}`;
    walk(ast, (node, ancestors) => {
        if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || !['t', 'tn', 'tk', 'tParts'].includes(node.callee.name)) return;
        const name = node.callee.name;
        if (name !== 'tk' && !ancestors.some(ancestor => FUNCTIONS.has(ancestor.type))) {
            problems.push(`${where(node)} ${name}() runs when the module loads, before the language is known: use tk() and translate where it is shown`);
        }
        if (name === 'tn') {
            const one = literal(node.arguments[1]);
            const other = literal(node.arguments[2]);
            if (one === null || other === null) problems.push(`${where(node)} tn() needs literal singular and plural texts`);
            else keys.set(other, { plural: true, one, where: where(node) });
        } else {
            const key = literal(node.arguments[0]);
            if (key !== null) keys.set(key, { plural: false, where: where(node) });
            else if (name === 'tk') problems.push(`${where(node)} tk() needs a literal text`);
        }
    });
    return { keys, problems };
}

const VOID = new Set(['br', 'img', 'input', 'wbr', 'hr', 'meta', 'link', 'source']);
const decode = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

/** The markup inside the element whose opening tag ends at `start`, up to its closing tag. */
function innerHtml(html, start, tag) {
    const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
    pattern.lastIndex = start;
    let depth = 1;
    for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
        depth += match[1] ? -1 : 1;
        if (!depth) return html.slice(start, match.index);
    }
    return '';
}

/** A sentence's key as translateDom() makes it: element children become {1}, {2}… */
function sentenceKey(inner) {
    let key = '';
    let depth = 0;
    let n = 0;
    for (const [token] of inner.matchAll(/<[^>]+>|[^<]+/g)) {
        if (!token.startsWith('<')) {
            if (!depth) key += decode(token);
            continue;
        }
        const name = token.match(/^<\/?(\w+)/)?.[1]?.toLowerCase();
        if (token.startsWith('</')) depth -= 1;
        else {
            if (!depth) key += `{${++n}}`;
            if (!VOID.has(name) && !token.endsWith('/>')) depth += 1;
        }
    }
    return key.trim().replace(/\s+/g, ' ');
}

/** Text and attributes marked for translation in a page. */
function scanPage(file) {
    const html = fs.readFileSync(file, 'utf8');
    const keys = new Map();
    const problems = [];
    const text = value => decode(value.replace(/<[^>]*>/g, '')).trim().replace(/\s+/g, ' ');
    for (const match of html.matchAll(/<(\w+)[^>]*\sdata-i18n-parts(?=[\s>])[^>]*>/g)) {
        const tag = match[1];
        const key = sentenceKey(innerHtml(html, match.index + match[0].length, tag));
        if (key) keys.set(key, { plural: false, where: path.basename(file) });
    }
    for (const match of html.matchAll(/<(\w+)((?:\s[^>]*)?\sdata-i18n(?:\s[^>]*)?)>([\s\S]*?)<\/\1>/g)) {
        if (/<\w/.test(match[3])) problems.push(`${path.basename(file)}: data-i18n on <${match[1]}> holding markup: ${text(match[3]).slice(0, 60)}`);
        const key = text(match[3]);
        if (key) keys.set(key, { plural: false, where: path.basename(file) });
    }
    for (const match of html.matchAll(/<\w+([^>]*)data-i18n-attr="([^"]+)"([^>]*)>/g)) {
        const attributes = `${match[1]} ${match[3]}`;
        for (const name of match[2].split(/\s+/)) {
            const value = attributes.match(new RegExp(`\\s${name}="([^"]*)"`));
            if (!value) problems.push(`${path.basename(file)}: data-i18n-attr names ${name}, which the element lacks`);
            else keys.set(text(value[1]), { plural: false, where: path.basename(file) });
        }
    }
    return { keys, problems };
}

/** Plain error strings of the server's routes and validation. */
function scanServer() {
    const keys = new Map();
    const files = SERVER_FILES.flatMap(entry => {
        const full = path.join(root, entry);
        return fs.statSync(full).isDirectory() ? fs.readdirSync(full).map(file => path.join(full, file)) : [full];
    });
    for (const file of files) {
        const ast = acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 2024, sourceType: 'script', locations: true });
        walk(ast, node => {
            if (node.type !== 'Property' || node.key.name !== 'error') return;
            const key = literal(node.value);
            if (key && /\s/.test(key)) keys.set(key, { plural: false, where: `${path.relative(root, file)}:${node.loc.start.line}` });
        });
    }
    return keys;
}

function collect() {
    const keys = new Map();
    const problems = [];
    const modules = fs.readdirSync(jsDir).filter(file => file.endsWith('.js')).map(file => path.join(jsDir, file));
    for (const result of [...modules.map(scanModule), ...PAGES.map(page => scanPage(path.join(root, 'public', page)))]) {
        for (const [key, info] of result.keys) if (!keys.has(key) || info.plural) keys.set(key, info);
        problems.push(...result.problems);
    }
    for (const [key, info] of scanServer()) if (!keys.has(key)) keys.set(key, info);
    return { keys, problems };
}

const placeholders = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');

/** Missing, stale and broken entries of a catalog. */
function checkCatalog(locale, keys) {
    const file = path.join(localesDir, `${locale}.json`);
    const catalog = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const missing = [];
    const broken = [];
    for (const [key, info] of keys) {
        const value = catalog[key];
        const forms = info.plural ? (value && typeof value === 'object' ? Object.values(value) : []) : [value];
        if (!forms.length || forms.some(form => typeof form !== 'string' || !form)) missing.push(key);
        else if (forms.some(form => placeholders(form) !== placeholders(key) && !(info.plural && placeholders(form) === placeholders(key).replace('count', '').replace(/^,|,$/g, '')))) broken.push(key);
    }
    const stale = Object.keys(catalog).filter(key => !keys.has(key));
    return { catalog, missing, stale, broken };
}

function sync(keys) {
    fs.mkdirSync(localesDir, { recursive: true });
    for (const locale of LOCALES) {
        const { catalog } = checkCatalog(locale, keys);
        const next = {};
        for (const key of [...keys.keys()].sort((a, b) => a.localeCompare(b, 'en'))) {
            const info = keys.get(key);
            const value = catalog[key];
            if (info.plural) next[key] = value && typeof value === 'object' ? value : { one: '', other: '' };
            else next[key] = typeof value === 'string' ? value : '';
        }
        fs.writeFileSync(path.join(localesDir, `${locale}.json`), `${JSON.stringify(next, null, 2)}\n`);
    }
}

/** Literals in the browser modules that read like interface text and are not keys. */
function untranslatedStrings() {
    const found = [];
    for (const file of fs.readdirSync(jsDir).filter(name => name.endsWith('.js'))) {
        const full = path.join(jsDir, file);
        const ast = acorn.parse(fs.readFileSync(full, 'utf8'), { ecmaVersion: 2024, sourceType: 'module', locations: true });
        walk(ast, (node, ancestors) => {
            const parent = ancestors.at(-1);
            if (parent?.type === 'ImportDeclaration' || parent?.type === 'ExportNamedDeclaration') return;
            if (parent?.type === 'CallExpression' && parent.callee.type === 'Identifier' && ['t', 'tn', 'tk', 'tParts'].includes(parent.callee.name)) return;
            if (parent?.type === 'Property' && parent.key === node) return;
            const value = node.type === 'Literal' && typeof node.value === 'string' ? node.value
                : node.type === 'TemplateElement' ? node.value.cooked : null;
            // Also one-word labels handed to a function or used as a default, such as input('from', 'From').
            const handed = (parent?.type === 'CallExpression' && parent.arguments.includes(node)) || parent?.type === 'AssignmentPattern';
            const sentence = value && /[A-Za-z]{2,}[^\n]*\s[A-Za-z]{2,}/.test(value) && /^[\s\p{Extended_Pictographic}A-Z“'"(]/u.test(value);
            // Also words around ${…} in the middle of a sentence, such as `${place}: a visit from ${date}`,
            // but not class names or the message of an Error.
            const midSentence = node.type === 'TemplateElement' && parent.expressions.length && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(value)
                && !/^[a-z-]+( [a-z-]+)*$/.test(value.trim()) && !/[<>="{}]|https?:/.test(value)
                && !ancestors.some(ancestor => ancestor.type === 'NewExpression' && ancestor.callee.name === 'Error');
            if (sentence || midSentence || (handed && value && /^[\p{Extended_Pictographic}\s]*[A-Z][a-z]+[.!?…]?$/u.test(value))) {
                found.push(`${file}:${node.loc.start.line} ${JSON.stringify(value).slice(0, 100)}`);
            }
        });
    }
    return found;
}

module.exports = { LOCALES, checkCatalog, collect, placeholders };

if (require.main === module) {
    const command = process.argv[2] || 'check';
    const { keys, problems } = collect();
    if (command === 'sync') {
        sync(keys);
        console.log(`${keys.size} keys written to ${LOCALES.length} catalogs`);
    } else if (command === 'strings') {
        console.log(untranslatedStrings().join('\n'));
    } else {
        let failed = problems.length > 0;
        for (const problem of problems) console.log(problem);
        for (const locale of LOCALES) {
            const { missing, stale, broken } = checkCatalog(locale, keys);
            console.log(`${locale}: ${keys.size} keys, ${missing.length} missing, ${stale.length} stale, ${broken.length} with other placeholders`);
            for (const key of broken) console.log(`  placeholders differ: ${key}`);
            if (missing.length || stale.length || broken.length) failed = true;
        }
        process.exitCode = failed ? 1 : 0;
    }
}
