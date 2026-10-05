// Copyright 2026 Central City contributors
// SPDX-License-Identifier: Apache-2.0
//
// Offline smoke test: fetch is replaced by a stub, so nothing reaches a network or production.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMessage, joinAsGuest, latestMessages, parseInvite } from '../join.mjs';

const ORIGIN = 'https://rooms.example';
const CREDENTIAL = `crc_${'A'.repeat(43)}`;

function stubFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, authorization: init.headers.authorization });
    const answer = routes[new URL(url).pathname]?.(body);
    if (!answer) return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 });
    return new Response(JSON.stringify(answer), { status: 200 });
  };
  return { fetch, calls };
}

test('parseInvite reads /j/ links, room links and short codes', () => {
  assert.deepEqual(parseInvite(`${ORIGIN}/j/abc`), { origin: ORIGIN, code: `${ORIGIN}/j/abc` });
  assert.equal(parseInvite(`${ORIGIN}/r/launch-plan#crr_x`).origin, ORIGIN);
  assert.equal(parseInvite('7K4M-Q9XP').origin, 'https://centralcity.ai');
  assert.equal(
    parseInvite('7K4M-Q9XP', { CC_ORIGIN: 'http://127.0.0.1:4310' }).origin,
    'http://127.0.0.1:4310',
  );
  assert.throws(() => parseInvite('http://rooms.example/j/abc'), /https/);
  assert.throws(() => parseInvite(`${ORIGIN}/docs`), /invite link/);
  assert.throws(() => parseInvite(''), /invite link/);
});

test('joins through bootstrap and redeem, then reads the newest messages', async () => {
  const messages = Array.from({ length: 12 }, (_, i) => ({
    seq: i + 1,
    sender: 'Host',
    text: `m${i + 1}`,
  }));
  const { fetch, calls } = stubFetch({
    '/api/public/invites/bootstrap': (body) => (body.code ? { handle: 'cir_handle' } : null),
    '/api/public/invites/redeem': (body) =>
      body.handle === 'cir_handle' && body.name === 'Tester'
        ? {
            room_id: 'room-1',
            agent_id: 'agent-1',
            credential: CREDENTIAL,
            expires_at: '2026-10-06T00:00:00Z',
          }
        : null,
    '/api/public/invites/tools/city_room_read': (body) => ({
      room: { name: 'Launch plan' },
      latest_seq: 12,
      messages: messages.filter((m) => m.seq > body.since).slice(0, body.limit),
    }),
  });
  const invite = parseInvite(`${ORIGIN}/j/abc`);
  const joined = await joinAsGuest({ ...invite, name: 'Tester' }, { fetch });
  assert.equal(joined.credential, CREDENTIAL);
  assert.equal(joined.origin, ORIGIN);
  const latest = await latestMessages(joined, 10, { fetch });
  assert.equal(latest.room.name, 'Launch plan');
  assert.deepEqual(
    latest.messages.map((m) => m.seq),
    [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  // The credential travels only as a bearer header, and only to the room tools.
  assert.ok(calls.slice(0, 2).every((c) => c.authorization === undefined));
  assert.ok(calls.slice(2).every((c) => c.authorization === `Bearer ${CREDENTIAL}`));
  assert.equal(formatMessage({ seq: 3, sender: 'Host', text: 'hi\nthere' }), '#3 Host: hi there');
});

test('a refused invite surfaces the server reason', async () => {
  const fetch = async () =>
    new Response(JSON.stringify({ error: 'This invite is invalid.', code: 'invite_invalid' }), {
      status: 404,
    });
  await assert.rejects(
    joinAsGuest({ origin: ORIGIN, code: 'x', name: 'Tester' }, { fetch }),
    /invite_invalid.*404/,
  );
});
