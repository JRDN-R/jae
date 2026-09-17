/* Storage regressions use real file-backed Blobs to reproduce source invalidation.
 * OPFS and picker handles are modeled in memory; these checks prove stream,
 * commit, readback, and cleanup behavior, not browser download UI behavior. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {stageBlob, writeBlob, assertReadable, disposeTemp} = require('../src/file-storage.js');

const payload = (length = 196619) => Buffer.from(Uint8Array.from({length}, (_, i) => (i * 71 + 19) & 255));
const bytes = async blob => Buffer.from(await blob.arrayBuffer());

async function diskSource(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jae-storage-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const filename = path.join(dir, 'source.mp4');
  const original = payload();
  fs.writeFileSync(filename, original);
  const blob = await fs.openAsBlob(filename, {type: 'video/mp4'});
  return {blob, original, overwrite: () => fs.writeFileSync(filename, 'source replaced')};
}

function fileHandle(options = {}) {
  const state = {writes: 0, closes: 0, aborts: 0, locks: 0, reads: 0, committed: null};
  const chunks = [];
  const writable = {
    async write(chunk) {
      state.writes++;
      if (options.writeError) throw options.writeError;
      const data = chunk && chunk.type === 'write' ? chunk.data : chunk;
      chunks.push(data instanceof Blob ? await bytes(data) : Buffer.from(data));
      if (options.afterWrite) options.afterWrite();
    },
    async close() {
      state.closes++;
      if (options.closeError) throw options.closeError;
      state.committed = Buffer.concat(chunks);
    },
    async abort() { state.aborts++; },
    getWriter() {
      state.locks++;
      let released = false;
      return {
        write: chunk => writable.write(chunk),
        close: () => writable.close(),
        abort: () => writable.abort(),
        releaseLock() { if (!released) { released = true; state.locks--; } }
      };
    }
  };
  const handle = {
    async createWritable() {
      if (options.createError) throw options.createError;
      return writable;
    },
    async getFile() {
      state.reads++;
      if (options.readError) throw options.readError;
      assert.ok(state.committed, 'readback must happen after a successful close');
      return new Blob([options.readback === undefined ? state.committed : options.readback]);
    }
  };
  return {handle, state};
}

function opfs(options = {}) {
  const file = fileHandle(options);
  const state = {created: [], removed: []};
  const root = {
    async getFileHandle(name, flags) {
      assert.equal(flags.create, true);
      state.created.push(name);
      if (options.fileError) throw options.fileError;
      return file.handle;
    },
    async removeEntry(name) { state.removed.push(name); }
  };
  return {root, handle: file.handle, file: file.state, state, storage: {getDirectory: async () => root}};
}

function streamingBlob(chunks, options = {}) {
  let read = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (read < chunks.length) controller.enqueue(chunks[read++]);
      else if (options.readError) controller.error(options.readError);
      else controller.close();
    }
  });
  const blob = new Blob(chunks);
  Object.defineProperty(blob, 'stream', {value: () => stream});
  if (options.size !== undefined) Object.defineProperty(blob, 'size', {value: options.size});
  return {blob, stream};
}

test('wrapping a real file-backed Blob does not detach it from a replaced source', async t => {
  const source = await diskSource(t);
  const wrapped = new Blob([source.blob]);
  assert.deepEqual(await bytes(wrapped), source.original);
  source.overwrite();
  await assert.rejects(wrapped.arrayBuffer());
  await assert.rejects(stageBlob(wrapped, {storage: {}}), error => error.name === 'SourceReadError');
});

test('memory staging fully detaches bytes before a source file is overwritten', async t => {
  const source = await diskSource(t), progress = [];
  const staged = await stageBlob(source.blob, {storage: {}, onProgress: (...args) => progress.push(args)});
  assert.equal(staged.temp, null);
  assert.notEqual(staged.blob, source.blob);
  assert.equal(staged.blob.type, source.blob.type);
  source.overwrite();
  assert.deepEqual(await bytes(staged.blob), source.original);
  assert.deepEqual(progress.at(-1), [source.original.length, source.original.length]);
});

test('unavailable OPFS falls back to detached bytes, with a strict memory bound', async () => {
  const original = new Blob([payload(65)]);
  const storage = {async getDirectory() { throw new DOMException('Private storage unavailable', 'SecurityError'); }};
  assert.deepEqual(await bytes((await stageBlob(original, {storage, maxMemoryBytes: 65})).blob), await bytes(original));
  let reads = 0;
  const large = new Blob([payload(66)]);
  Object.defineProperty(large, 'arrayBuffer', {value: () => { reads++; throw Error('Unexpected read'); }});
  await assert.rejects(stageBlob(large, {storage, maxMemoryBytes: 65}), /memory|large|limit|storage/i);
  assert.equal(reads, 0, 'oversized memory fallback must reject before allocating or reading');
});

test('OPFS staging commits and verifies a separate copy that survives source replacement', async t => {
  const source = await diskSource(t), store = opfs(), progress = [];
  const staged = await stageBlob(source.blob, {storage: store.storage, maxMemoryBytes: 1, onProgress: (...args) => progress.push(args)});
  assert.equal(staged.temp.root, store.root);
  assert.equal(staged.temp.handle, store.handle);
  assert.equal(staged.temp.name, store.state.created[0]);
  assert.equal(store.file.closes, 1);
  assert.ok(store.file.reads >= 1, 'staging must inspect the committed file');
  assert.equal(store.file.locks, 0);
  assert.deepEqual(store.state.removed, []);
  source.overwrite();
  assert.deepEqual(await bytes(staged.blob), source.original);
  assert.deepEqual(progress.at(-1), [source.original.length, source.original.length]);
  await disposeTemp(staged.temp);
  assert.deepEqual(store.state.removed, [staged.temp.name]);
  await disposeTemp(null);
});

test('failure to create the OPFS writable cleans its entry and uses the bounded fallback', async () => {
  const store = opfs({createError: new DOMException('Not supported', 'NotSupportedError')});
  const original = new Blob([payload(100)]);
  const staged = await stageBlob(original, {storage: store.storage, maxMemoryBytes: 100});
  assert.equal(staged.temp, null);
  assert.deepEqual(await bytes(staged.blob), await bytes(original));
  assert.deepEqual(store.state.removed, store.state.created);
});

test('OPFS close failure and wrong committed size reject and remove the partial file', async () => {
  for (const options of [{closeError: Error('Commit failed')}, {readback: Buffer.alloc(0)}, {readback: payload(3)}]) {
    const store = opfs(options);
    await assert.rejects(stageBlob(new Blob([payload(100)]), {storage: store.storage}));
    assert.deepEqual(store.state.removed, store.state.created);
    assert.equal(store.file.locks, 0);
    if (options.closeError) assert.ok(store.file.aborts > 0, 'a failed commit must abort the writable');
  }
});

test('a streaming source error never falls back to rereading it and cleans OPFS', async () => {
  const sourceError = Error('Source disappeared during read');
  const source = streamingBlob([new Uint8Array([1, 2, 3])], {readError: sourceError});
  let fallbackReads = 0;
  Object.defineProperty(source.blob, 'arrayBuffer', {value: () => { fallbackReads++; return Promise.resolve(new ArrayBuffer(3)); }});
  const store = opfs();
  await assert.rejects(stageBlob(source.blob, {storage: store.storage}), error => {
    assert.equal(error.name, 'SourceReadError');
    assert.equal(error.cause, sourceError);
    assert.match(error.message, /reselect|readable/i);
    return true;
  });
  assert.equal(fallbackReads, 0);
  assert.equal(source.stream.locked, false);
  assert.equal(store.file.locks, 0);
  assert.equal(store.file.closes, 0);
  assert.ok(store.file.aborts > 0);
  assert.deepEqual(store.state.removed, store.state.created);
});

test('cancelling an OPFS copy aborts, releases stream locks, and removes partial bytes', async () => {
  let cancelled = false;
  const source = streamingBlob([payload(65536), payload(65536)]);
  const store = opfs({afterWrite: () => { cancelled = true; }});
  await assert.rejects(stageBlob(source.blob, {
    storage: store.storage,
    checkCancel() { if (cancelled) throw new DOMException('Copy cancelled', 'AbortError'); }
  }), error => error.name === 'AbortError');
  assert.equal(store.file.closes, 0);
  assert.ok(store.file.aborts > 0);
  assert.equal(store.file.locks, 0);
  assert.equal(source.stream.locked, false);
  assert.deepEqual(store.state.removed, store.state.created);
});

test('writeBlob reports the actual committed byte count and verifies the destination', async () => {
  const target = fileHandle(), original = new Blob([payload()]), progress = [];
  assert.equal(await writeBlob(target.handle, original, {onProgress: (...args) => progress.push(args)}), original.size);
  assert.deepEqual(target.state.committed, await bytes(original));
  assert.equal(target.state.closes, 1);
  assert.ok(target.state.reads >= 1);
  assert.equal(target.state.aborts, 0);
  assert.equal(target.state.locks, 0);
  assert.deepEqual(progress.at(-1), [original.size, original.size]);
});

test('writeBlob refuses empty, truncated, and oversized streams without committing', async () => {
  for (const source of [streamingBlob([]), streamingBlob([payload(3)], {size: 4}), streamingBlob([payload(5)], {size: 4})]) {
    const target = fileHandle();
    await assert.rejects(writeBlob(target.handle, source.blob), /empty|zero|size|length|incomplete|bytes|expected/i);
    assert.equal(target.state.closes, 0);
    assert.equal(target.state.locks, 0);
    assert.equal(source.stream.locked, false);
    if (target.state.writes) assert.ok(target.state.aborts > 0);
  }
});

test('write failures and cancellation abort destination writes and release reader locks', async () => {
  for (const failure of ['write', 'cancel', 'source']) {
    let cancelled = false;
    const source = streamingBlob([payload(8), payload(8)], failure === 'source' ? {readError: Error('Source read failed')} : {});
    const target = fileHandle(failure === 'write' ? {writeError: Error('Destination write failed')} : {afterWrite: () => { cancelled = failure === 'cancel'; }});
    await assert.rejects(writeBlob(target.handle, source.blob, {
      checkCancel() { if (cancelled) throw new DOMException('Cancelled', 'AbortError'); }
    }));
    assert.equal(target.state.closes, 0);
    assert.ok(target.state.aborts > 0);
    assert.equal(target.state.locks, 0);
    assert.equal(source.stream.locked, false);
  }
});

test('writeBlob rejects close failures and committed readback failures', async () => {
  for (const options of [{closeError: Error('Close failed')}, {readError: Error('Readback failed')}, {readback: Buffer.alloc(0)}, {readback: payload(9)}]) {
    const target = fileHandle(options);
    await assert.rejects(writeBlob(target.handle, new Blob([payload(10)])));
    assert.equal(target.state.locks, 0);
    if (options.closeError) assert.ok(target.state.aborts > 0);
  }
});

test('assertReadable accepts nonempty bytes and identifies empty or stale sources by label', async t => {
  await assertReadable(new Blob([payload()]), 'clip-healthy.mp4');
  await assert.rejects(assertReadable(new Blob(), 'clip-empty.mp4'), /clip-empty\.mp4/);
  const source = await diskSource(t);
  source.overwrite();
  await assert.rejects(assertReadable(source.blob, 'clip-stale.mp4'), /clip-stale\.mp4/);
});

test('assertReadable checks the end of a source as well as its readable beginning', async () => {
  const blob = new Blob([payload(200000)]), originalSlice = blob.slice.bind(blob);
  Object.defineProperty(blob, 'slice', {value(start, end) {
    const part = originalSlice(start, end);
    if (start > 0 || start < 0) Object.defineProperty(part, 'arrayBuffer', {value: async () => { throw Error('Source tail unavailable'); }});
    return part;
  }});
  await assert.rejects(assertReadable(blob, 'clip-broken-tail.mp4'), /clip-broken-tail\.mp4/);
});
