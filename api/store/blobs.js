'use strict';
// Files ("blobs") in a bucket: the events bucket and the site's event-maps/ folder. A tiny interface with an in-memory
// version (tests, local development) and an S3 version (production), so the event logic (api/lib/events.js) is tested
// without AWS. Keys are plain strings like "summer/game-config.json". Every method is async.
//
//   list(prefix, { delimiter })  -> { keys: [...], prefixes: [...] }   (with delimiter "/", folders come back as prefixes)
//   get(key)                     -> Buffer, or null when there is no such file
//   put(key, body, { contentType, cacheControl })
//   delete(key)
//   deletePrefix(prefix, { keep }) -> removes every file whose key starts with prefix (except those starting with keep)

function createMemoryBlobs() {
  const files = new Map(); // key -> { body: Buffer, contentType, cacheControl }
  const blobs = {
    async list(prefix = '', { delimiter } = {}) {
      const keys = [];
      const prefixes = new Set();
      for (const key of [...files.keys()].sort()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const cut = delimiter ? rest.indexOf(delimiter) : -1;
        if (cut >= 0) prefixes.add(prefix + rest.slice(0, cut + 1));
        else keys.push(key);
      }
      return { keys, prefixes: [...prefixes] };
    },
    async get(key) { return files.has(key) ? Buffer.from(files.get(key).body) : null; },
    async put(key, body, { contentType, cacheControl } = {}) { files.set(key, { body: Buffer.from(body), contentType, cacheControl }); },
    async delete(key) { files.delete(key); },
    async deletePrefix(prefix, { keep } = {}) {
      for (const key of [...files.keys()]) if (key.startsWith(prefix) && !(keep && key.startsWith(keep))) files.delete(key);
    },
    // Test helper: what a file was stored with.
    meta(key) { const f = files.get(key); return f ? { contentType: f.contentType, cacheControl: f.cacheControl } : null; },
  };
  return blobs;
}

// s3: an S3Client from @aws-sdk/client-s3 (the Lambda runtime provides the SDK); commands: the SDK's command classes.
function createS3Blobs({ s3, bucket, commands }) {
  const { ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand } = commands;
  const isMissing = (e) => e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
  const blobs = {
    async list(prefix = '', { delimiter } = {}) {
      const keys = [];
      const prefixes = [];
      let ContinuationToken;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: delimiter, ContinuationToken }));
        keys.push(...(page.Contents ?? []).map((o) => o.Key));
        prefixes.push(...(page.CommonPrefixes ?? []).map((p) => p.Prefix));
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return { keys, prefixes };
    },
    async get(key) {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return Buffer.from(await res.Body.transformToByteArray());
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async put(key, body, { contentType, cacheControl } = {}) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }));
    },
    async delete(key) { await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
    async deletePrefix(prefix, { keep } = {}) {
      const { keys } = await blobs.list(prefix);
      const doomed = keys.filter((k) => !(keep && k.startsWith(keep)));
      for (let i = 0; i < doomed.length; i += 1000) {
        await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: doomed.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }));
      }
    },
  };
  return blobs;
}

module.exports = { createMemoryBlobs, createS3Blobs };
