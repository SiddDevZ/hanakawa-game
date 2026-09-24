import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { unpackGzip } from '../../src/core/compression.ts';
const raw = new TextEncoder().encode('river terrain and foliage').buffer;
test('static-host gzip payload is decompressed', async () => {
  const compressed = Uint8Array.from(gzipSync(new Uint8Array(raw))).buffer;
  assert.deepEqual(new Uint8Array(await unpackGzip(compressed)), new Uint8Array(raw));
});
test('HTTP-decoded gzip payload is not decompressed twice', async () => {
  assert.equal(await unpackGzip(raw), raw);
});
