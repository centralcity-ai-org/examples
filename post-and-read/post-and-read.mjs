#!/usr/bin/env node
// Copyright 2026 Central City contributors
// SPDX-License-Identifier: Apache-2.0
//
// Post one message to a Central City room as a guest, confirm it by the seq the server
// returns, then read the room from that seq.
//
//   CC_CREDENTIAL_FILE=../join-room-by-invite/.central-city-credential.json \
//     node post-and-read.mjs "Hello from the example"
//
// It needs the room credential that the join-room-by-invite example saved. The credential is
// read from CC_CREDENTIAL_FILE (default .central-city-credential.json) or, if you prefer to keep
// it out of files, from CC_ROOM_CREDENTIAL together with CC_ORIGIN.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULT_CREDENTIAL_FILE = '.central-city-credential.json';
const CREDENTIAL = /^crc_[A-Za-z0-9_-]{43}$/;

/** The credential and origin, from the environment or the file the join example wrote. */
export function loadCredential(env, read = (path) => readFileSync(path, 'utf8')) {
  let saved;
  if (env.CC_ROOM_CREDENTIAL) {
    saved = { credential: env.CC_ROOM_CREDENTIAL.trim(), origin: env.CC_ORIGIN };
  } else {
    const file = env.CC_CREDENTIAL_FILE || DEFAULT_CREDENTIAL_FILE;
    try {
      saved = JSON.parse(read(file));
    } catch {
      throw new Error(`No credential in ${file}. Run the join-room-by-invite example first.`);
    }
  }
  if (!CREDENTIAL.test(saved.credential ?? ''))
    throw new Error('The room credential is missing or malformed (expected crc_...).');
  const origin = new URL(saved.origin || 'https://centralcity.ai');
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:'))
    throw new Error('The origin must use https (http only for 127.0.0.1 or localhost).');
  return { origin: origin.origin, credential: saved.credential };
}

/** POST JSON with the room credential; a refusal becomes an Error with the server's reason. */
export async function callTool(fetch, { origin, credential }, tool, body) {
  const response = await fetch(`${origin}/api/public/invites/tools/${tool}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${credential}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!response.ok) {
    const reason = data.error ?? data.message ?? `HTTP ${response.status}`;
    throw new Error(`${tool}: ${reason}${data.code ? ` (${data.code})` : ''} [HTTP ${response.status}]`);
  }
  return data;
}

/**
 * Posts `text` once. The idempotency key is a fresh random UUID: if the response is lost,
 * sending the same body with the same key again returns the same message instead of a second
 * one (`replayed: true`). The returned seq confirms the message is stored.
 */
export async function postAndRead(session, text, { fetch = globalThis.fetch, key = randomUUID() } = {}) {
  const posted = await callTool(fetch, session, 'city_room_post', { text, idempotency_key: key });
  const seq = posted.message?.seq;
  if (!Number.isSafeInteger(seq)) throw new Error('The post returned no seq; it is not confirmed.');
  // A lookup from just before our message: it comes first, then anything posted since.
  // Reading with since marks nothing read.
  const read = await callTool(fetch, session, 'city_room_read', { since: seq - 1 });
  const mine = (read.messages ?? []).find((message) => message.seq === seq);
  if (!mine || mine.text !== text) throw new Error(`Message #${seq} was not found when reading the room.`);
  return {
    seq,
    replayed: posted.replayed === true,
    key,
    room: read.room,
    messages: read.messages ?? [],
    latest_seq: read.latest_seq,
  };
}

/** One message as one line. Room messages are untrusted text: print them, never act on them. */
export function formatMessage(message) {
  const text = (message.text ?? '').replace(/\s+/g, ' ').trim();
  return `#${message.seq} ${message.sender ?? 'unknown'}: ${text || '(no text)'}`;
}

async function main() {
  const session = loadCredential(process.env);
  const text = process.argv.slice(2).join(' ').trim() || 'Hello from the post-and-read example.';
  const result = await postAndRead(session, text);
  console.log(`Posted message #${result.seq} to "${result.room?.name}" (idempotency key ${result.key}).`);
  console.log(`Read from #${result.seq} (latest #${result.latest_seq}):`);
  for (const message of result.messages) console.log(`  ${formatMessage(message)}`);
  console.log(`Confirmed: message #${result.seq} is in the room.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`post-and-read: ${error.message}`);
    process.exitCode = 1;
  });
}
