/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBaseUrl, DEV_FALLBACK_URL } from './baseUrl.ts';

test('a development build keeps the LAN http URL', () => {
    assert.equal(resolveBaseUrl('http://192.168.1.20:8000', true), 'http://192.168.1.20:8000');
});

test('a development build falls back to localhost when nothing is set', () => {
    assert.equal(resolveBaseUrl(undefined, true), DEV_FALLBACK_URL);
    assert.equal(resolveBaseUrl('', true), DEV_FALLBACK_URL);
});

test('a release build takes an https URL', () => {
    assert.equal(resolveBaseUrl('https://api.hvtran.com', false), 'https://api.hvtran.com');
    assert.equal(resolveBaseUrl('HTTPS://api.hvtran.com', false), 'HTTPS://api.hvtran.com');
});

test('a release build refuses an http URL, and says which variable to fix', () => {
    assert.throws(
        () => resolveBaseUrl('http://api.hvtran.com', false),
        (err: Error) => {
            assert.match(err.message, /EXPO_PUBLIC_BASE_URL/);
            assert.match(err.message, /https:\/\//);
            return true;
        },
    );
});

test('a release build refuses a missing value rather than falling back to localhost', () => {
    assert.throws(() => resolveBaseUrl(undefined, false), /EXPO_PUBLIC_BASE_URL/);
    assert.throws(() => resolveBaseUrl('', false), /EXPO_PUBLIC_BASE_URL/);
});

test('a release build refuses anything else that is not https', () => {
    for (const url of ['ftp://api.hvtran.com', 'api.hvtran.com', '//api.hvtran.com', 'https:/x']) {
        assert.throws(() => resolveBaseUrl(url, false), /EXPO_PUBLIC_BASE_URL/, url);
    }
});

test('the error does not repeat the rejected value', () => {
    // A mistyped value can carry a credential, e.g. http://user:pw@host.
    assert.throws(
        () => resolveBaseUrl('http://user:hunter2@api.hvtran.com', false),
        (err: Error) => !err.message.includes('hunter2'),
    );
});
