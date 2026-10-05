// Copyright 2026 Central City contributors
// SPDX-License-Identifier: Apache-2.0
//
// Offline smoke test: fetch is replaced by a stub, so nothing reaches a network or production.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCredential, postAndRead } from '../post-and-read.mjs';

const ORIGIN = 'https://rooms.example';
const CREDENTIAL = `crc_${'B'.repeat(43)}`;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('loadCredential reads the saved file or the environment', () => {
  const file = JSON.stringify({ origin: ORIGIN, credential: CREDENTIAL });
  assert.deepEqual(
    loadCredential({}, () => file),
    { origin: ORIGIN, credential: CREDENTIAL },
  );
  assert.deepEqual(loadCredential({ CC_ROOM_CREDENTIAL: CREDENTIAL, CC_ORIGIN: ORIGIN }), {
    origin: ORIGIN,
    credential: CREDENTIAL,
  });
  const missing = () => {
    throw new Error('ENOENT');
  };
  assert.throws(() => loadCredential({}, missing), /join-room-by-invite/);
  assert.throws(() => loadCredential({ CC_ROOM_CREDENTIAL: 'nope' }), /malformed/);
  assert.throws(
    () => loadCredential({ CC_ROOM_CREDENTIAL: CREDENTIAL, CC_ORIGIN: 'http://rooms.example' }),
    /https/,
  );
});

test('posts once with a UUID key, confirms by seq and reads from it', async () => {
  const stored = [{ seq: 1, sender: 'Host', text: 'Welcome' }];
  const keys = [];
  const fetch = async (url, init) => {
    assert.equal(init.headers.authorization, `Bearer ${CREDENTIAL}`);
    const body = JSON.parse(init.body);
    const tool = new URL(url).pathname.split('/').pop();
    if (tool === 'city_room_post') {
      keys.push(body.idempotency_key);
      const message = { seq: stored.length + 1, sender: 'Guest', text: body.text };
      stored.push(message);
      return Response.json({ message, replayed: false });
    }
    if (tool === 'city_room_read')
      return Response.json({
        room: { name: 'Launch plan' },
        latest_seq: stored.length,
        messages: stored.filter((m) => m.seq > body.since),
      });
    return Response.json({ error: 'Unknown tool.' }, { status: 404 });
  };
  const result = await postAndRead({ origin: ORIGIN, credential: CREDENTIAL }, 'Hello', { fetch });
  assert.equal(result.seq, 2);
  assert.deepEqual(
    result.messages.map((m) => m.seq),
    [2],
  );
  assert.equal(keys.length, 1);
  assert.match(keys[0], UUID_V4);
  assert.equal(result.key, keys[0]);
});

test('a post without a seq is not reported as confirmed', async () => {
  const fetch = async () => Response.json({ message: {} });
  await assert.rejects(
    postAndRead({ origin: ORIGIN, credential: CREDENTIAL }, 'Hello', { fetch }),
    /not confirmed/,
  );
});
