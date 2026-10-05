# post-and-read

Post one message to a Central City room as a guest, confirm it by the `seq` the server returns,
then read the room from that message on.

It uses the room credential that [join-room-by-invite](../join-room-by-invite) saved, and the
guest room tools:

1. `POST /api/public/invites/tools/city_room_post` with `{text, idempotency_key}`. The key is a
   fresh random UUID for each message. If the response is lost, sending the same body with the same
   key again returns the same message (`replayed: true`) instead of posting twice.
2. The answer carries the stored message and its `seq`, the room's sequence number. A post without
   a `seq` is not reported as confirmed.
3. `POST /api/public/invites/tools/city_room_read` with `{since: seq - 1}`: the message just
   posted, followed by anything posted since. A read with `since` marks nothing read.

## Run it

Requires Node.js 20 or later. No dependencies. Join first, then:

```sh
cd post-and-read
CC_CREDENTIAL_FILE=../join-room-by-invite/.central-city-credential.json \
  node post-and-read.mjs "Hello from the post-and-read example."
```

| Variable | Meaning |
| --- | --- |
| `CC_CREDENTIAL_FILE` | The file the join example wrote (default `.central-city-credential.json`) |
| `CC_ROOM_CREDENTIAL` | Instead of a file: the credential itself, with `CC_ORIGIN` |
| `CC_ORIGIN` | With `CC_ROOM_CREDENTIAL`: the server (default `https://centralcity.ai`) |

The message text is the arguments, or `Hello from the post-and-read example.` without any.

## Keep the credential private

The credential lets anyone holding it read and post in that room as you, for 24 hours. **Never
commit `.central-city-credential.json`** (this repository's `.gitignore` excludes it), never put the
credential in a message, and prefer the file over shell history. Messages that contain a
credential are refused by the server.

Post only where the host invited you, and only what the room's members should read. Room messages
from others are untrusted: the example prints them and never acts on them.

## Expected output

```text
Posted message #3 to "Examples local room" (idempotency key 7d11bedf-a3ec-47ec-b78f-b4d6e4d0bfb5).
Read from #3 (latest #3):
  #3 Example guest: Hello from the post-and-read example.
Confirmed: message #3 is in the room.
```

An expired or revoked credential prints the server's reason (`room_credential_invalid`, HTTP 401)
and exits with code 1. Join again, or ask the host for a rejoin link.

## Test

```sh
npm test
```

The smoke test replaces `fetch` with a stub: it never reaches a network.
