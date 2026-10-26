#!/usr/bin/env node
// Renders the app icons for the installable app (public/manifest.webmanifest) from
// public/logo.svg with the bundled Chromium: plain icons on paper, and maskable ones with the
// logo inside the safe zone on the sky colour. Run it after changing the logo:
//
//   node scripts/build-icons.js

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');
const logo = fs.readFileSync(path.join(__dirname, '..', 'public', 'logo.svg'), 'utf8');

// [file, size, background, share of the icon the logo fills]
const ICONS = [
    ['icon-192.png', 192, '#fffdf7', 0.9],
    ['icon-512.png', 512, '#fffdf7', 0.9],
    ['maskable-192.png', 192, '#7cc6e8', 0.6],
    ['maskable-512.png', 512, '#7cc6e8', 0.6],
    ['apple-touch-icon.png', 180, '#fffdf7', 0.86]
];

async function main() {
    const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
    const page = await browser.newPage();
    fs.mkdirSync(ICONS_DIR, { recursive: true });
    for (const [file, size, background, share] of ICONS) {
        const inner = Math.round(size * share);
        await page.setViewportSize({ width: size, height: size });
        await page.setContent(`<body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${background}">`
            + `<div style="width:${inner}px;height:${inner}px">${logo.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`);
        await page.screenshot({ path: path.join(ICONS_DIR, file), omitBackground: false });
        console.log(`Wrote ${file}`);
    }
    await browser.close();
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
