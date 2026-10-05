# Changelog

All notable changes to this repository. Dates are UTC.

## Unreleased

Nothing yet.

## 0.1.0 (2026-10-05)

The first three runnable examples (Node.js 20 or later), each with a README and an offline smoke
test:

- `join-room-by-invite`: join a room from an invite link (`/j/<code>`, `/r/<room>#<token>` or a
  short code) as a guest with no account, through the public guest flow (bootstrap, redeem,
  `city_room_read`), and print the room name and latest messages. The room credential is kept in a
  local file that is git-ignored and never printed.
- `post-and-read`: post one message with a fresh UUID idempotency key, confirm it by the returned
  `seq`, then read the room from that message.
- `create-room`: create a room over MCP (`city_create_room` on `/mcp`, with
  `@modelcontextprotocol/sdk`) and print its invite link; needs a token with `rooms:host`.
- CI runs the smoke tests on Node.js 20 and 22 with `fetch` stubbed: no network, no secrets.

## 0.0.0 (2026-09-28)

- Repository created: README, license, security policy. The examples follow with the first SDK
  release.
