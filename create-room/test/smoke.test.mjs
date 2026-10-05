// Copyright 2026 Central City contributors
// SPDX-License-Identifier: Apache-2.0
//
// Offline smoke test: fetch is replaced by a tiny stand-in MCP server, so nothing reaches a
// network or production.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoom, readOptions } from '../create-room.mjs';

const ORIGIN = 'https://rooms.example';

/** Answers the MCP handshake and tools/call with plain JSON, like a stateless server. */
function stubMcp(tools) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    if ((init.method ?? 'GET') !== 'POST') return new Response(null, { status: 405 });
    assert.equal(new URL(url).pathname, '/mcp');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-token');
    const message = JSON.parse(init.body);
    if (message.id === undefined) return new Response(null, { status: 202 });
    let result = {};
    if (message.method === 'initialize') {
      result = {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'stub', version: '0.0.0' },
      };
    } else if (message.method === 'tools/call') {
      calls.push(message.params);
      const data = tools[message.params.name](message.params.arguments);
      result = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    }
    return Response.json({ jsonrpc: '2.0', id: message.id, result });
  };
  return { fetch, calls };
}

test('readOptions needs CC_TOKEN and checks the origin', () => {
  assert.throws(() => readOptions([], {}), /CC_TOKEN/);
  assert.deepEqual(readOptions(['Launch plan'], { CC_TOKEN: 't' }), {
    token: 't',
    origin: 'https://centralcity.ai',
    name: 'Launch plan',
    agentId: undefined,
  });
  assert.throws(
    () => readOptions([], { CC_TOKEN: 't', CC_ORIGIN: 'http://rooms.example' }),
    /https/,
  );
  assert.equal(
    readOptions([], { CC_TOKEN: 't', CC_ORIGIN: 'http://127.0.0.1:4310' }).origin,
    'http://127.0.0.1:4310',
  );
});

test('picks the first agent, creates the room and returns its invite link', async () => {
  const { fetch, calls } = stubMcp({
    city_workspace: () => ({ agents: [{ id: 'agent-1' }] }),
    city_create_room: (args) => ({
      room: { id: 'room-1', name: args.name },
      link: {
        link: `${ORIGIN}/r/launch-plan#crr_token`,
        expires_at: '2026-10-12T00:00:00Z',
        join_link: `${ORIGIN}/j/code`,
        short_code: '7K4M-Q9XP',
        join_link_expires_at: '2026-10-06T00:00:00Z',
      },
      replayed: false,
    }),
  });
  const created = await createRoom(
    { token: 'test-token', origin: ORIGIN, name: 'Launch plan' },
    { fetch },
  );
  assert.equal(created.room.name, 'Launch plan');
  assert.equal(created.inviteLink, `${ORIGIN}/j/code`);
  assert.equal(created.shortCode, '7K4M-Q9XP');
  assert.equal(created.roomLink, `${ORIGIN}/r/launch-plan#crr_token`);
  const create = calls.find((c) => c.name === 'city_create_room');
  assert.equal(create.arguments.agent_id, 'agent-1');
  assert.match(create.arguments.idempotency_key, /^[0-9a-f-]{36}$/);
});

test('uses CC_AGENT_ID without reading the workspace', async () => {
  const { fetch, calls } = stubMcp({
    city_create_room: (args) => ({
      room: { id: 'room-2', name: args.name },
      link: null,
      replayed: false,
    }),
  });
  const created = await createRoom(
    { token: 'test-token', origin: ORIGIN, name: 'Solo', agentId: 'agent-9' },
    { fetch },
  );
  assert.deepEqual(
    calls.map((c) => c.name),
    ['city_create_room'],
  );
  assert.equal(created.inviteLink, null);
});
