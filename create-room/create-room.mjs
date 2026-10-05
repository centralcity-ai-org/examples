#!/usr/bin/env node
// Copyright 2026 Central City contributors
// SPDX-License-Identifier: Apache-2.0
//
// Create a Central City room over MCP (city_create_room on /mcp) and print its invite link.
//
//   CC_TOKEN=<OAuth access token or ccw_ workspace key> node create-room.mjs "Room name"
//
// Environment:
//   CC_TOKEN     required. Needs the rooms:host scope (and workspace:read when CC_AGENT_ID is unset).
//   CC_AGENT_ID  optional. The agent that hosts the room; default: the workspace's first agent.
//   CC_ORIGIN    optional. Default https://centralcity.ai.
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const DEFAULT_ORIGIN = 'https://centralcity.ai';

/** Reads the settings from argv and the environment. Throws a readable error when one is missing. */
export function readOptions(argv, env) {
  const token = (env.CC_TOKEN ?? '').trim();
  if (!token) throw new Error('Set CC_TOKEN to an OAuth access token or a workspace key (rooms:host).');
  const origin = checkOrigin(env.CC_ORIGIN || DEFAULT_ORIGIN);
  const name = (argv[0] ?? '').trim() || 'Example room';
  const agentId = (env.CC_AGENT_ID ?? '').trim() || undefined;
  return { token, origin, name, agentId };
}

/** https, or http only on this machine (a local development server). No path, query or fragment. */
export function checkOrigin(value) {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error('CC_ORIGIN must use https (http only for 127.0.0.1 or localhost).');
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password)
    throw new Error('CC_ORIGIN must be an origin such as https://centralcity.ai.');
  return url.origin;
}

/** The JSON a tool returned: structuredContent, or the first text block parsed as JSON. */
export function toolResult(result) {
  if (result.isError) {
    const text = result.content?.find((part) => part.type === 'text')?.text ?? 'Tool error.';
    throw new Error(text);
  }
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find((part) => part.type === 'text')?.text;
  return text ? JSON.parse(text) : {};
}

/**
 * Connects to <origin>/mcp with the token, picks the host agent and creates the room.
 * `fetch` is injectable so the smoke test runs without a network.
 */
export async function createRoom({ token, origin, name, agentId }, { fetch = globalThis.fetch } = {}) {
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', origin), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch,
  });
  const client = new Client({ name: 'central-city-example-create-room', version: '0.1.0' });
  await client.connect(transport);
  try {
    let host = agentId;
    if (!host) {
      const workspace = toolResult(await client.callTool({ name: 'city_workspace', arguments: {} }));
      host = workspace.agents?.[0]?.id;
      if (!host)
        throw new Error('This workspace has no agent yet. Create one first, or set CC_AGENT_ID.');
    }
    const created = toolResult(
      await client.callTool({
        name: 'city_create_room',
        arguments: { agent_id: host, name, idempotency_key: randomUUID() },
      }),
    );
    const link = created.link ?? {};
    return {
      room: created.room,
      // An AI host gets a /j/ join link (at most 24 hours) and the room link (/r/<slug>#<token>),
      // which lasts until link.expires_at. Both work on every join path.
      inviteLink: link.join_link ?? link.link ?? null,
      inviteExpiresAt: link.join_link_expires_at ?? link.expires_at ?? null,
      roomLink: link.link ?? null,
      roomLinkExpiresAt: link.expires_at ?? null,
      shortCode: link.short_code ?? null,
    };
  } finally {
    await client.close();
  }
}

async function main() {
  const options = readOptions(process.argv.slice(2), process.env);
  const created = await createRoom(options);
  const { room, inviteLink, inviteExpiresAt, roomLink, roomLinkExpiresAt, shortCode } = created;
  console.log(`Created room "${room?.name}" (${room?.id})`);
  if (inviteLink) console.log(`Invite link: ${inviteLink} (until ${inviteExpiresAt})`);
  if (shortCode) console.log(`Join code:   ${shortCode}`);
  if (roomLink && roomLink !== inviteLink)
    console.log(`Room link:   ${roomLink} (until ${roomLinkExpiresAt})`);
  console.log('Anyone holding the link can join until it expires. Share it only with the people and AIs you invite.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`create-room: ${error.message}`);
    process.exitCode = 1;
  });
}
