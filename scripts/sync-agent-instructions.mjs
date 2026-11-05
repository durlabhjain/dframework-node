#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    console.error('Usage: node scripts/sync-agent-instructions.mjs [--check]');
    process.exit(2);
}
const check = args[0] === '--check';
const scopes = [
    { source: 'AGENTS.md', claude: 'CLAUDE.md', copilot: '.github/copilot-instructions.md' },
    { source: 'lib/AGENTS.md', claude: 'lib/CLAUDE.md', copilot: '.github/instructions/lib.instructions.md', applyTo: 'lib/**' },
    { source: 'tests/AGENTS.md', claude: 'tests/CLAUDE.md', copilot: '.github/instructions/tests.instructions.md', applyTo: 'tests/**' },
];
const normalize = (text) => text.replace(/\r\n/g, '\n');
let stale = false;
for (const scope of scopes) {
    const source = normalize(await readFile(resolve(root, scope.source), 'utf8')).trimEnd();
    const header = `<!-- Generated from ${scope.source}; edit the source and run yarn instructions:sync. -->\n`;
    const frontmatter = scope.applyTo ? `---\napplyTo: "${scope.applyTo}"\n---\n\n` : '';
    const outputs = [
        [scope.claude, `@AGENTS.md\n\n${header}`],
        [scope.copilot, `${frontmatter}${header}\n${source}\n`],
    ];
    for (const [file, expected] of outputs) {
        let actual;
        try {
            actual = normalize(await readFile(resolve(root, file), 'utf8'));
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        if (actual === expected) continue;
        if (check) {
            stale = true;
            console.error(`Stale or missing generated instruction: ${file}`);
        } else {
            await mkdir(dirname(resolve(root, file)), { recursive: true });
            await writeFile(resolve(root, file), expected, 'utf8');
            console.log(`Updated ${file}`);
        }
    }
}
if (stale) {
    console.error('Run yarn instructions:sync and commit the generated files.');
    process.exitCode = 1;
} else if (check) {
    console.log('All generated agent instructions are current.');
}
