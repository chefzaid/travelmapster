'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTestContext } = require('../helpers');

let ctx;
test.before(async () => { ctx = await createTestContext(); });
test.after(async () => { await ctx.close(); });

test('only the embeddable map may be framed by other sites, and it stays out of search results', async () => {
    const embed = await request(ctx.server).get('/embed/someone');
    assert.equal(embed.status, 200);
    assert.match(embed.headers['content-type'], /html/);
    assert.match(embed.headers['content-security-policy'], /frame-ancestors \*/);
    assert.doesNotMatch(embed.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(embed.headers['x-frame-options'], undefined);
    assert.equal(embed.headers['x-robots-tag'], 'noindex');
    assert.match(embed.text, /\/a\/[0-9a-f]{12}\/js\/embed\.js/);
    // Scripts and styles stay same-origin only.
    assert.match(embed.headers['content-security-policy'], /script-src 'self'/);

    for (const page of ['/', '/schengen-calculator']) {
        const res = await request(ctx.server).get(page);
        assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/, page);
        assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN', page);
    }
});
