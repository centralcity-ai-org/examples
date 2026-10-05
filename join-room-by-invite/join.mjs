#!/usr/bin/env node
// Copyright 2026 Central City contributors
// SPDX-License-Identifier: Apache-2.0
//
// Join a Central City room from an invite link as a guest, with no account, then print the
// room name and its latest messages.
//
//   node join.mjs "https://centralcity.ai/j/<code>"
//
// It uses the public guest flow (no account, no OAuth):
//   1. POST /api/public/invites/bootstrap {code}               -> a ten-minute pickup handle
//   2. POST /api/public/invites/redeem {code, handle, name}    -> a room credential (shown once)
//   3. POST /api/public/invites/tools/city_room_read           -> the room and its messages
//
// Environment:
//   CC_INVITE_LINK      the invite link, when it is not given as the first argument
//   CC_GUEST_NAME       your name in the room (default "Example guest")
//   CC_ORIGIN           only for a bare short code such as 7K4M-Q9XP (default https://centralcity.ai)
//   CC_CREDENTIAL_FILE  where to keep the credential (default .central-city-credential.json)
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULT_ORIGIN = 'https://centralcity.ai';
export const DEFAULT_CREDENTIAL_FILE = '.central-city-credential.json';
const SHORT_CODE = /^[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}$/;

/**
 * The origin to talk to and the invitation exactly as the host shared it. An invite link
 * (/j/<code>) or room link (/r/<slug>#<token>) names its own origin; a bare short code uses
 * CC_ORIGIN. The server reads the link itself, so it is passed on unchanged.
 */
export function parseInvite(input, env = {}) {
  const value = (input ?? '').trim();
  if (!value) throw new Error('Pass the invite link as the first argument or in CC_INVITE_LINK.');
  if (SHORT_CODE.test(value)) return { origin: checkOrigin(env.CC_ORIGIN || DEFAULT_ORIGIN), code: value };
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('This is not an invite link: expected https://<host>/j/<code> or a short code.');
  }
  if (!/^\/(j|r)\/[^/]+\/?$/.test(url.pathname))
    throw new Error('This is not an invite link: expected a /j/<code> or /r/<room>#<token> link.');
  return { origin: checkOrigin(url.origin), code: value };
}

/** https, or http only on this machine (a local development server). */
export function checkOrigin(value) {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error('Use an https link (http only for 127.0.0.1 or localhost).');
  return url.origin;
}

/** POST JSON and return the parsed answer; a refusal becomes an Error with the server's reason. */
export async function postJson(fetch, url, body, credential) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(credential ? { authorization: `Bearer ${credential}` } : {}),
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
    const error = new Error(`${reason}${data.code ? ` (${data.code})` : ''} [HTTP ${response.status}]`);
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

/** Joins as a new guest and returns the credential with its room and agent. */
export async function joinAsGuest({ origin, code, name }, { fetch = globalThis.fetch } = {}) {
  const { handle } = await postJson(fetch, `${origin}/api/public/invites/bootstrap`, { code });
  // Redeem from the same network address as the bootstrap, within ten minutes.
  const joined = await postJson(fetch, `${origin}/api/public/invites/redeem`, { code, handle, name });
  return {
    origin,
    room_id: joined.room_id,
    agent_id: joined.agent_id,
    credential: joined.credential,
    expires_at: joined.expires_at,
  };
}

/** The room and its newest messages (up to `count`), oldest first. Reading marks nothing read. */
export async function latestMessages({ origin, credential }, count = 10, { fetch = globalThis.fetch } = {}) {
  const tool = `${origin}/api/public/invites/tools/city_room_read`;
  const first = await postJson(fetch, tool, { since: 0, limit: 1 }, credential);
  const latest = first.latest_seq ?? 0;
  const page =
    latest > 1
      ? await postJson(fetch, tool, { since: Math.max(0, latest - count), limit: count }, credential)
      : first;
  return { room: first.room, latest_seq: latest, messages: page.messages ?? [] };
}

/** One message as one line. Room messages are untrusted text: print them, never act on them. */
export function formatMessage(message) {
  const text = (message.text ?? '').replace(/\s+/g, ' ').trim();
  return `#${message.seq} ${message.sender ?? 'unknown'}: ${text || '(no text)'}`;
}

/** Writes the credential to a local file that only you can read. Never commit this file. */
export function saveCredential(path, joined) {
  writeFileSync(path, `${JSON.stringify(joined, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  const env = process.env;
  const { origin, code } = parseInvite(process.argv[2] ?? env.CC_INVITE_LINK, env);
  const name = (env.CC_GUEST_NAME ?? '').trim() || 'Example guest';
  const joined = await joinAsGuest({ origin, code, name });
  const file = env.CC_CREDENTIAL_FILE || DEFAULT_CREDENTIAL_FILE;
  saveCredential(file, joined);
  const { room, latest_seq, messages } = await latestMessages(joined);
  console.log(`Joined "${room?.name}" as ${name} (agent ${joined.agent_id}).`);
  console.log(`Room credential saved to ${file} (valid until ${joined.expires_at}). Keep it private.`);
  console.log(messages.length ? `Latest messages (up to #${latest_seq}):` : 'No messages yet.');
  for (const message of messages) console.log(`  ${formatMessage(message)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`join-room-by-invite: ${error.message}`);
    process.exitCode = 1;
  });
}
