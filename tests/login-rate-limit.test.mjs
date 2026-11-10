import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../app/api/_lib.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText.replace(/export /g, '');
function limits(row) {
    const env = { DB: { prepare() { return { bind() { return { first: async () => row, run: async () => ({}) }; } }; } } };
    return new Function('env', `${code}; return {loginRateLimit,recordFailedLogin}`)(env);
}

test('PIN rate limiting handles missing, expired and active blocking records', async () => {
    const now = 100000;
    for (const method of ['loginRateLimit', 'recordFailedLogin']) {
        assert.equal(await limits(null)[method]('user', now), 0);
        assert.equal(await limits({blockedUntil: now - 1})[method]('user', now), 0);
        assert.equal(await limits({blockedUntil: now + 1501})[method]('user', now), 2);
    }
});
