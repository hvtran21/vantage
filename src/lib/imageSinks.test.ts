/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// There is no component test setup, so this keeps the wiring honest: every place the app hands
// a URL to the image view or its prefetch has to have been through safeImageUri.
const root = join(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
    return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
            ? sourceFiles(join(dir, entry.name))
            : /\.tsx?$/.test(entry.name)
              ? [join(dir, entry.name)]
              : [],
    );
}

const files = [...sourceFiles('app'), ...sourceFiles('components')];

test('every remote image source is a checked URI', () => {
    const offenders: string[] = [];
    for (const file of files) {
        readFileSync(join(root, file), 'utf8')
            .split('\n')
            .forEach((line, i) => {
                const sink = /\{\s*uri:\s*([^}]+?)\s*\}|Image\.prefetch\(\s*([^,)]+)/.exec(line);
                const value = sink?.[1] ?? sink?.[2];
                if (value && value !== 'imageUri')
                    offenders.push(`${file}:${i + 1}  ${line.trim()}`);
            });
    }
    assert.deepEqual(offenders, []);
});

test('the two image sinks are still where this test looks', () => {
    const uses = files.filter((file) =>
        /safeImageUri\(/.test(readFileSync(join(root, file), 'utf8')),
    );
    assert.deepEqual(uses.map((f) => f.replaceAll('\\', '/')).sort(), [
        'app/article/[id].tsx',
        'components/NewsCard.tsx',
    ]);
});
