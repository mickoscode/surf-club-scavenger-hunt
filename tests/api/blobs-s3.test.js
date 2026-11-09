// The S3 version of the blob store, against a small fake of S3 that follows the parts of the real behaviour it relies on
// (keys, prefixes and delimiters, pages of results, a missing key, deleting in batches). Real SDK command classes.
const test = require('node:test');
const assert = require('node:assert/strict');
const commands = require('@aws-sdk/client-s3');
const { createS3Blobs, createMemoryBlobs } = require('../../api/store/blobs.js');

function fakeS3() {
  const files = new Map();
  const log = [];
  return {
    log,
    async send(command) {
      const { Bucket, Key, Prefix = '', Delimiter, ContinuationToken, Body, Delete, ContentType, CacheControl } = command.input;
      assert.equal(Bucket, 'the-bucket');
      log.push(command.constructor.name);
      switch (command.constructor.name) {
        case 'PutObjectCommand': files.set(Key, { body: Buffer.from(Body), ContentType, CacheControl }); return {};
        case 'GetObjectCommand': {
          if (!files.has(Key)) throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
          return { Body: { transformToByteArray: async () => new Uint8Array(files.get(Key).body) } };
        }
        case 'DeleteObjectCommand': files.delete(Key); return {};
        case 'DeleteObjectsCommand': assert.ok(Delete.Objects.length <= 1000); for (const o of Delete.Objects) files.delete(o.Key); return {};
        case 'ListObjectsV2Command': {
          const all = [...files.keys()].filter((k) => k.startsWith(Prefix)).sort();
          const contents = []; const prefixes = new Set();
          for (const k of all) {
            const cut = Delimiter ? k.slice(Prefix.length).indexOf(Delimiter) : -1;
            if (cut >= 0) prefixes.add(Prefix + k.slice(Prefix.length, Prefix.length + cut + 1)); else contents.push(k);
          }
          const start = ContinuationToken ? Number(ContinuationToken) : 0;
          const page = contents.slice(start, start + 2); // two at a time, to make paging matter
          const more = start + 2 < contents.length;
          return { Contents: page.map((Key) => ({ Key })), CommonPrefixes: start === 0 ? [...prefixes].map((Prefix) => ({ Prefix })) : [], IsTruncated: more, NextContinuationToken: more ? String(start + 2) : undefined };
        }
        default: throw new Error(`unexpected ${command.constructor.name}`);
      }
    },
  };
}

test('the S3 blobs put, get, list (with folders and pages) and delete like the in-memory ones', async () => {
  for (const [name, blobs] of [['s3', createS3Blobs({ s3: fakeS3(), bucket: 'the-bucket', commands })], ['memory', createMemoryBlobs()]]) {
    await blobs.put('a/one.txt', Buffer.from('1'), { contentType: 'text/plain' });
    for (const n of [2, 3, 4, 5]) await blobs.put(`a/game-zones/z${n}.webp`, Buffer.from(String(n)));
    await blobs.put('b/two.txt', Buffer.from('2'));
    assert.equal((await blobs.get('a/one.txt')).toString(), '1', name);
    assert.equal(await blobs.get('nope'), null, name);
    assert.deepEqual((await blobs.list('', { delimiter: '/' })).prefixes.sort(), ['a/', 'b/'], name);
    const inA = await blobs.list('a/', { delimiter: '/' });
    assert.deepEqual([inA.keys, inA.prefixes], [['a/one.txt'], ['a/game-zones/']], name);
    assert.equal((await blobs.list('a/game-zones/')).keys.length, 4, name); // more than one page
    await blobs.deletePrefix('a/', { keep: 'a/game-zones/z3' });
    assert.deepEqual((await blobs.list('a/')).keys, ['a/game-zones/z3.webp'], name);
    await blobs.delete('b/two.txt');
    assert.equal(await blobs.get('b/two.txt'), null, name);
  }
});

test('the S3 blobs store the content type and cache header they are given', async () => {
  const s3 = fakeS3();
  const seen = [];
  const blobs = createS3Blobs({ s3: { send: async (c) => { seen.push(c.input); return s3.send(c); } }, bucket: 'the-bucket', commands });
  await blobs.put('x.webp', Buffer.from('x'), { contentType: 'image/webp', cacheControl: 'public, max-age=1' });
  assert.deepEqual([seen[0].ContentType, seen[0].CacheControl], ['image/webp', 'public, max-age=1']);
});

test('the Lambda handler builds the events store only where the bucket names are given (the admin function)', () => {
  const { createEventsFromEnvironment } = require('../../api/handlers/shared.js');
  assert.equal(createEventsFromEnvironment({}), null);
  assert.equal(createEventsFromEnvironment({ EVENTS_BUCKET: 'only-one' }), null);
  assert.equal(typeof createEventsFromEnvironment({ EVENTS_BUCKET: 'events', SITE_BUCKET: 'site' }).names, 'function');
});
