# Shared Tinkibot API: Local Proxy and Web Serial

The Connections tab offers **Auto | Modem | Proxy**. Auto checks authorised USB
ESP32-C3 gateways running **tinkimoden-proxy**, then falls back to the local
WebSocket/Python service. Both paths support discovery,
physical claims, release/remove, Scratch actions, sensor reporters, bundles and
asynchronous events. The preference persists; new device permission remains
user initiated. Previously authorised devices connect automatically. No browser extension or desktop application
is required for Web Serial after firmware provisioning.

## Architecture and investigation

Previously, the editor built public command objects for `ws://127.0.0.1:9006`.
The Python proxy validated the public schema, maintained robot sessions and
claims, translated commands, and forwarded correlated compact JSON bundles. It
continued discovering robots over BLE even when commands used a USB modem.
The original MicroPython modem forwarded text/fragmented messages between USB,
ESP-NOW and a Nordic UART peripheral bridge; it did not implement the robot API.

The consolidated gateway moves discovery, peer-bound UUID registration, physical
claim tracking, public validation/translation, bounded pending execution and
response adaptation onto the ESP32-C3. Its BLE central uses existing robot NUS
characteristics; ESP-NOW retains existing framing. Robot firmware still interprets
and executes commands and remains the authority on physical acceptance. Neither
reference implementation nor robot firmware is modified. Their inspected revisions
and exact build/flash/protocol instructions are recorded in the gateway README.

```text
Scratch blocks / Connections UI
             |
shared public robot API and response handler (Tinkibot extension)
             |
ConnectionManager.ensureConnected / sendRequest / message events
             |
    +--------+---------+
    |                  |
existing WebSocket     SerialTransport (native byte streams)
adapter                |
    |                  tinkimoden-proxy (MicroPython)
Python proxy           public API / UUID registry / physical claims / correlation
    |                  |
old modem / BLE        ESP-NOW / Nordic UART BLE central
    +------------------+
             |
       existing Tinkibots
```

All claim/release/remove, action, reporter and bundle sends now enter
`ConnectionManager.sendRequest`; individual block interfaces and bundle collection
rules are unchanged. The existing public `api.js` converter/validator and one
`_handleRobotMessage` handle both transports. The old WebSocket implementation is
kept behind connect/send/disconnect hooks rather than duplicated in serial code.
No Scratch block sends directly to `window.socket`.

`SerialTransport` owns 115200 8N1 I/O, a single reader/writer, serialized writes,
partial UTF-8/newline framing, binary-envelope isolation and lock cleanup.
`ConnectionManager` owns selection, native permissions, capability negotiation,
request timers, bounded diagnostics, lease renewal and stale-response isolation.
It consumes gateway robot lists instead of maintaining a second browser-side
wireless discovery mechanism. The old discovery-only modem poller was removed.
The VM normalizes both backends into the same robot registry/events and ownership
states. UI components subscribe to that registry and call the same runtime methods.

## Connecting from the HTTPS editor

1. Provision the ESP32-C3 using the gateway README; stop the Python proxy and all
   serial monitors. Updating source alone does not update the hosted editor.
2. Deploy the matching editor through the existing HTTPS release process. Open it
   in current desktop Chrome/Edge and open Connections. Auto is the default;
   Modem restricts detection to USB and Proxy restricts it to the Python service.
3. Add USB Device opens the browser's own permission dialog directly from the
   click handler. Cancelling is harmless. Previously authorised ports come from
   `navigator.serial.getPorts()`. Select the appropriate port and Connect.
4. Expect `identify` → `tinkimoden-proxy`, followed by a correlated `register`
   response containing firmware and `robot-api-v1`. The original `tinkimodem`
   identify token is tolerated for diagnostics, but no control is enabled without
   the new API capability. Install matching gateway firmware on a legacy modem.
5. Robots appear as UUID cards. Click Claim, then physically accept on the robot.
   A prompt's immediate OK is not ownership. Pending claims can be cancelled with
   Release. After reconnect, an uncertain reservation can be confirmed again;
   the robot decides whether it remains owned or needs physical acceptance.
6. Run existing blocks and bundles normally. Reporters await their own correlated
   result. Release changes ownership only on confirmed serial response/event.

The proxy provides no authoritative USB VID/PID allowlist. Native authorised ports
show IDs where exposed; their serial identifiers never replace bot/client UUIDs.
Not every serial device is a gateway. A wrong device fails the identify/API
handshake and releases the port. No reset/break/DTR/RTS sequence is sent.

Unsupported/insecure browsers show guidance and retain Local Proxy. The host
must permit serial (not `Permissions-Policy: serial=()`). Top-level same-origin
HTTPS permits it by default; embedding needs serial delegation and secure
ancestors. CSP does not need a new network `connect-src` for native serial.
Actual production headers and physical USB drivers require on-device verification.

## Public contract, correlation and switching

The preferred contract is the existing Python proxy JSON API: canonical
`request-id` / `client-uuid`, authoritative `bot-uuid`, optional advisory nickname,
public descriptive `command` objects or a one-robot `cmds` array. Single responses
use command/status/result; bundle responses use `rsp`. Events are distinct.
Legacy raw compact `cmd` arrays and `blocks-uuid` are not the current public API.
The gateway's `docs/protocol.md` describes the full contract and extensions.

Serial pending requests are keyed by request ID and checked against client and
bot UUIDs. They are bounded at 32 in the browser; the C3 admits only two executing
requests, one per UUID, returning busy beyond that. The existing VM command queue
keeps sequential block execution; different requests cannot overwrite one another.
Registration renews a 20-second client lease using a nonoverlapping five-second
refresh. One missed refresh is tolerated; three consecutive failures close the
link. Successful replies are applied only to the connection that requested them. All requests use
fresh IDs. Malformed/wrong/late responses do not complete another caller.

Switching clears transport availability, removes old serial listeners or socket
handlers, rejects pending work and initializes the selected backend. Serial
`end-session` stops gateway discovery/heartbeats and BLE connections. Abrupt
unplug uses lease expiry. Unsent wireless fragments are cancelled; work already
executing on a robot may continue with an unknown outcome and is never replayed.
The gateway retains uncertain reservations instead of silently granting control
after a reconnect. Accepted claims and disconnected owner reservations on the
unchanged proxy continue using its existing lifecycle.

The new `identify` response intentionally prevents the unmodified Python proxy
from mistaking the JSON gateway for its old raw modem. Local Proxy uses the
existing service plus an original modem or direct BLE. After ending a gateway
session, allow the robot's existing 20-second heartbeat grace period to expire
before testing direct Python BLE events (up to roughly 40 seconds after unplug).
One OS serial port/BLE link cannot be owned by two applications at once.
Use Reconnect Local Proxy if the Python service starts after the initial attempt.

## Diagnostics and limits

The permanent `ConnectionDebugPanel` appears below the robot list, with an
internally scrolling console. History survives preference and transport changes.
It shows selected transport, serial/security support, port VID/PID, USB and
handshake status, firmware and robot count. Verbose mode logs outgoing/incoming
and parsed messages, IDs, robot/claim events and errors. Logs are in-memory,
limited to 200 entries and 1,000 characters per entry, with credential/key-label
redaction and no binary contents. Notifications are batched at 50 ms. Clear,
verbose toggle and clipboard copy include diagnostic metadata without persistence.
Gateway registers also report radio counters, limits and free heap.

The C3 public request limit is 6,144 UTF-8 bytes, compact request limit 4,096,
response limit 8,192 and bundle limit 32 commands. The registry has eight UUIDs;
two BLE robots can connect. ESP-NOW packet framing and BLE MTU limits are handled
by the gateway, not by per-command browser round trips. A whole bundle remains
one public request and one robot envelope. Oversize/busy/timeout errors are explicit;
wireless oversize responses can lead to a timeout, never a truncated success.

Current correlated JSON-bundle robot firmware is needed. Plain old `OK` replies
without request IDs cannot safely support concurrent/correlated control. No silent
legacy fallback or robot firmware change is included. Existing radio transport
has no new cryptographic authentication/encryption. A reboot entirely inside the
availability window and claim events lacking transaction/boot IDs cannot always
be distinguished; stronger guarantees need a robot protocol extension. See the
gateway README for resource budgets and exact security/compatibility limits.

## Tests and real-hardware checklist

From the affected package directories:

```sh
# packages/scratch-vm
node test/unit/extension_tinkibot_serial.js
node test/unit/extension_tinkibot.js
node test/unit/extension_tinkibot_api.js
node test/unit/extension_tinkibot_music.js
node test/unit/extension_tinkibot_bundles.js
npm run build

# packages/scratch-gui
npx jest --runInBand test/unit/components/connections-tab.test.jsx
npm run test:unit -- --runInBand
npm run i18n:src
npm run build:dev
```

Serial tests use real WHATWG streams and mocked hardware permissions, with
fake clocks for deadlines. They exercise actual VM claims, actions, a complete
bundle, sensors and release over serial, and verify nothing is sent to the
inactive socket. Existing proxy tests cover the unchanged block/bundle behavior.
Gateway unittest cases cover public schema, identity/ownership, peer routing,
partial failures, limits, timeouts, USB/ESP-NOW/BLE framing and GATT lifecycle.
A browser component smoke can exercise the real manager/extension with simulated
serial; it is not physical hardware verification. Results are recorded in the
completion report. Whole-package legacy lint/test failures must be reported
separately from these focused checks.

On real hardware, follow `tinkimoden-proxy/docs/hardware-testing.md`: HTTPS
connection, permission cancellation, two robots, reject/accept claims physically,
movement/rotation/display, one bundled sequence and a sensor, release, unplug/
reconnect, re-confirm reservations and switch back to the Python proxy. Include
BLE-only/default-MTU and ESP-NOW fragmentation tests, duplicate/empty nicknames,
radio loss, output backpressure, low heap and startup/OS driver behavior.
No physical flashing, robot actuation or production deployment is claimed here.

## Change inventory and next steps

Tinkiblocks changes: VM `tinkimo_tinkibot/index.js` (shared API/adapters and claims),
`api.js` and its tests (shared execution deadline budgets),
`connection/connection-manager.js`, `connection/serial-transport.js`, removal of
`connection/modem-discovery.js`; Connections tab JSX/CSS integration, debug control
component and VM/GUI tests; README, AGENTS and this guide. The original proxy and
modem remain unchanged. The new repository contains its own modular firmware,
configuration, tests, cross-compile tool and protocol/flashing/hardware guides.

To add another transport, implement connect/disconnect/send at the manager boundary
and deliver the same validated messages/state. Reuse the public converters and VM
handler; do not fork individual Scratch blocks or create a second robot registry.
General Python scripting, console/file tools and file transfers remain outside
this firmware. Next steps are real C3 coexistence/heap validation, shared generated
schema fixtures, robot claim/session epochs and authenticated routing before
migrating encrypted communication or file transfers.

See [Automatic connections](tinkibot-automatic-connections.md) for detection,
recovery, investigation findings and the Windows Chrome/Edge acceptance checks.
