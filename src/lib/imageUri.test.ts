/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { safeImageUri } from './imageUri.ts';

test('passes http and https image URLs through', () => {
    assert.equal(safeImageUri('https://cdn.example.com/a.jpg'), 'https://cdn.example.com/a.jpg');
    assert.equal(
        safeImageUri('http://cdn.example.com/a.jpg?w=400'),
        'http://cdn.example.com/a.jpg?w=400',
    );
});

test('ignores case in the scheme and trims the ends', () => {
    assert.equal(
        safeImageUri('  HTTPS://cdn.example.com/a.jpg \n'),
        'HTTPS://cdn.example.com/a.jpg',
    );
});

test('refuses every other scheme', () => {
    for (const url of [
        'file:///data/user/0/app/secret.db',
        'content://com.android.contacts/contacts',
        'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        'javascript:alert(1)',
        'ftp://cdn.example.com/a.jpg',
        'blob:https://cdn.example.com/1234',
        'asset:/images/a.jpg',
        'ph://ABC-123',
    ]) {
        assert.equal(safeImageUri(url), undefined, url);
    }
});

test('refuses a URL that is not absolute', () => {
    for (const url of ['//cdn.example.com/a.jpg', '/a.jpg', 'a.jpg', 'cdn.example.com/a.jpg']) {
        assert.equal(safeImageUri(url), undefined, url);
    }
});

test('refuses a scheme with nothing after it, or with whitespace inside', () => {
    for (const url of ['https://', 'http://', 'https:// ', 'https://cdn.example.com/a b.jpg']) {
        assert.equal(safeImageUri(url), undefined, url);
    }
});

test('refuses a scheme hidden behind other text', () => {
    for (const url of ['x https://cdn.example.com/a.jpg', 'file:///x#https://cdn.example.com/']) {
        assert.equal(safeImageUri(url), undefined, url);
    }
});

test('refuses missing and empty values', () => {
    for (const url of [undefined, null, '', '   ']) {
        assert.equal(safeImageUri(url), undefined);
    }
});

test('refuses a value that is not a string', () => {
    // The feed is JSON, so a field can be anything.
    for (const url of [42, {}, ['https://cdn.example.com/a.jpg'], true]) {
        assert.equal(safeImageUri(url as unknown as string), undefined);
    }
});
