import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the packed public entrypoint, outside the checkout's module tree.
// Materialize runtime dependencies and required peers from the locked dev install;
// optional peers, development-only packages and their hoisted transitive packages
// must not mask an undeclared consumer requirement. This is an offline fixture,
// not an installation of every integration's complete dependency graph.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(process.argv.length, 3, 'Pass the archive produced by yarn pack');
const archive = resolve(process.argv[2]);
const tempRoot = await realpath(tmpdir());
const consumer = await mkdtemp(join(tempRoot, 'dframework-consumer-'));

try {
    const installed = join(consumer, 'node_modules', '@durlabh', 'dframework');
    await mkdir(installed, { recursive: true });
    execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', installed]);
    const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
    assert.equal(manifest.name, '@durlabh/dframework');
    const providers = {
        ...manifest.dependencies,
        ...Object.fromEntries(Object.entries(manifest.peerDependencies)
            .filter(([name]) => !manifest.peerDependenciesMeta?.[name]?.optional)),
    };
    for (const name of Object.keys(providers)) {
        const target = join(consumer, 'node_modules', name);
        await mkdir(dirname(target), { recursive: true });
        await cp(join(root, 'node_modules', name), target, { recursive: true });
    }
    await writeFile(join(consumer, 'package.json'), JSON.stringify({
        private: true,
        type: 'module',
        dependencies: { [manifest.name]: `file:${archive}`, ...providers },
    }));
    await writeFile(join(consumer, 'verify.mjs'), `
        import assert from 'node:assert/strict';
        import { join, sep } from 'node:path';
        import { fileURLToPath } from 'node:url';
        import adapters from '@durlabh/dframework/adapters';

        assert.ok(fileURLToPath(import.meta.resolve('semver')).startsWith(
            join(process.cwd(), 'node_modules', 'semver') + sep
        ), 'semver must come from the isolated consumer, not an ambient install');
        assert.equal(typeof adapters.request.Axios, 'function');
        assert.equal(typeof adapters.search.Elastic, 'function');
        const requests = [];
        const adapter = new adapters.request.Got((options) => {
            requests.push(options);
            return { json: async () => ({ ok: true }) };
        });
        assert.deepEqual(await adapter.getJson({ url: 'https://fixture.invalid' }), { ok: true });
        assert.equal(requests[0].http2, true, 'supported Node defaults to HTTP/2');
        await adapter.getJson({ url: 'https://fixture.invalid', http2: false });
        assert.equal(requests[1].http2, false, 'explicit HTTP/2 override is preserved');
        console.log('Packed adapters import and Got defaults pass with required peers only.');
    `);
    const output = execFileSync(process.execPath, [join(consumer, 'verify.mjs')], {
        cwd: consumer,
        env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
        encoding: 'utf8',
    });
    process.stdout.write(output);
} finally {
    // The only recursive cleanup target is the newly allocated temp child.
    assert.equal(dirname(consumer), tempRoot);
    await rm(consumer, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
