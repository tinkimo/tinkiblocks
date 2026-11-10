# Web Serial discovery proof of concept

The Connections tab supports **Local Proxy** (the existing WebSocket path) and
**Web Serial** (direct USB modem identification and robot discovery). Web Serial
requires no proxy process. Robot claiming and control remain Local Proxy features.
No firmware changes or runtime dependencies were introduced.

## Architecture and authoritative sources

The editor's built-in Tinkibot extension owns a `ConnectionManager`, exposed as
`runtime.tinkibotConnectionManager`. It persists the method under
`tinkiblocks.communicationMethod`, serializes connect/method-switch operations,
and owns serial listeners, discovery timers and a bounded diagnostic buffer.
The Connections tab subscribes to snapshots; unmounting it removes only its UI
subscription, so a connected modem remains available when changing editor tabs.

- `connection/serial-transport.js`: native serial I/O, ordered writes, stream lock
  ownership and framing. No robot/UI logic.
- `connection/modem-discovery.js`: read-only identity polling and a UUID registry.
- `connection/connection-manager.js`: method selection, browser permissions,
  identification, lifecycle/state and diagnostics. Future methods can add an
  adapter here without moving serial I/O into React.
- `index.js`: a small lifecycle adapter around the existing proxy implementation.
  The WebSocket public API, claim/release/remove and command paths are preserved.
  The serial registry is deliberately separate from claimable proxy reservations.
- GUI `connection-controls.jsx`: isolated controls and temporary collapsible log.

Sources inspected:

- Companion `tinkiblocks-proxy/comms/usb.py`: 115200 baud, PySerial defaults
  (8 data bits, no parity, 1 stop bit, no flow control), `identify\n` →
  `tinkimodem`, three attempts; nickname-prefixed replies and modem diagnostics.
- Proxy `comms/framing.py` and `comms/bundles.py`: newline UTF-8 text, NUL/COBS
  binary envelopes, 24,576 + 128 byte text bound and 512-byte binary wire bound.
- Proxy `tinkitalk.py`: BLE scan, `get:uuid`, `get:nickname`, UUID extraction,
  connection/claim registry, and a persistent USB listener. **The proxy continues
  discovering robots over BLE even while it sends commands over USB.** There is
  no existing serial-specific discovery service to port literally.
- [tinkimo/tinkimodem](https://github.com/tinkimo/tinkimodem), inspected at
  `39b7466071603066119b24452833b3c69c1e9a61`: `comms/usb.py`, `main.py`,
  `config/__init__.py` and README. `identify` is handled locally; other lines
  are broadcast over ESP-NOW, with BLE fallback when available. Robot replies
  are forwarded unchanged with a newline. The modem itself sends
  `all.heartbeat` every five seconds; the browser must not duplicate it.
- Companion robot firmware `main.py` get handlers, ESP-NOW response formatting
  and `comms/message-parser.py`: `all.get:uuid` is an existing broadcast query;
  responses are `+<nickname>.OK get uuid <UUID>`. Nicknames come from
  `<nickname>.get:nickname` → `+<nickname>.OK get nickname <nickname>`.

### Browser-only discovery exchange

```text
browser → identify\n
modem   → tinkimodem\n
browser → all.get:uuid\n
robot   → +lime.OK get uuid 01234567-89ab-cdef-0123-456789abcdef\n
browser → lime.get:nickname\n
robot   → +lime.OK get nickname lime\n
```

Identification is retried at one-second intervals, at most three times. Discovery
runs immediately after identification and every five seconds. UUIDs deduplicate
robots; each UUID reply refreshes availability. Fifteen seconds without a reply
marks a robot unavailable (evaluated on each poll); disconnect marks all offline.
This is inferred radio availability, not the proxy's BLE/claim status. At most
128 robots are retained per modem session; reconnecting clears the registry.
`BLE:`, `Connection state changed.`, modem-targeted replies, malformed identities
and unrelated events do not create robots. Event contents can appear in verbose
diagnostics without changing claim ownership.

No new wire messages, pairing, robot registration, command translation, bundling,
file transfers or encryption were added. Discovery needs no robot claim. The
framer separates and discards binary frames before UTF-8 decoding; binary file
transfer is deliberately unsupported and no binary traffic is sent.

## Browser, USB and deployment limitations

- Target current desktop Chrome/Edge on HTTPS. Localhost can be used for
  development because browsers consider it trustworthy. Other browsers still
  support the unchanged Local Proxy path.
- `getPorts()` returns authorised devices only. **Add USB Device** immediately
  invokes `requestPort()` from its click handler. Cancelling is harmless;
  permission/policy/open errors remain visible. USB attach/detach events refresh
  the list and removal closes the active connection.
- The proxy has no authoritative VID/PID allowlist. The picker is intentionally
  unfiltered, displays VID/PID where available, and requires a successful
  `tinkimodem` reply. USB IDs alone never establish that a port is a modem.
- The modem firmware uses MicroPython `sys.stdin`/`sys.stdout`, a serial console,
  not a custom WebUSB protocol. The sources do not contain USB descriptors or
  the board's MicroPython build configuration, so native ESP32-C3 USB Serial/JTAG
  versus an external USB-to-UART bridge, actual VID/PID and OS driver requirements
  must be confirmed on the physical board. Web Serial works with an OS-exposed
  serial port; a bootloader-only or nonserial USB interface is insufficient.
- No explicit DTR, RTS or break signals are set. OS/browser behavior when opening
  a particular board can still reset it; startup retries tolerate a short delay.
- Stop the Python proxy and close serial monitors before connecting directly.
  Closing its WebSocket does **not** instruct a separately running proxy to
  release its USB port. Port-in-use errors are surfaced rather than bypassed.
- Serial discovery reuses the existing identity commands over ESP-NOW rather
  than BLE enumeration. Firmware must answer targeted/broadcast gets and the
  modem must forward them. Equivalent discovery to BLE cannot be guaranteed for
  radio/channel loss, missing forwarding, unroutable robots, or colliding
  nicknames. Unnamed robots can be listed by UUID but cannot receive a targeted
  nickname query. UUIDs distinguish rows, but nickname routing remains ambiguous when
  names collide. No firmware change is proposed for this iteration.
- The selected method is persisted, not a port identity (browser port objects
  have no stable public path/serial number). Reload lists authorised devices but
  requires the user to connect again. No background permission requests occur.
- The repository's static webpack/GitHub Pages setup needs no WebSocket or
  external `connect-src` entry for native serial. The production host must not
  disable serial using `Permissions-Policy: serial=()`. Top-level same-origin
  hosting permits serial by default; embedded use needs appropriate `serial`
  delegation and secure ancestors. The real editor.tinkimo.com headers and
  deployed build were not changed or verified by this task.
- Diagnostic logs are opt-in for raw/parsed traffic, limited to 200 entries and
  1,000 characters per entry, with common credential/key redaction. USB binary
  contents are not logged. No credential/key commands are sent. Logs remain in
  memory and can be cleared/copied; debug notifications are batched at 50 ms.

## Physical ESP32-C3 test checklist

These instructions require deploying the changed editor through its normal
HTTPS release process. Source changes alone do not update editor.tinkimo.com.
No successful physical-device test is claimed.

1. Stop Tinkitalk/the Python proxy and any serial monitor. Attach the modem using
   a USB data cable; confirm its serial port and required driver in the OS.
2. Open the updated HTTPS editor in desktop Chrome or Edge. Open Connections,
   select Web Serial, and enable verbose logging in Connection debug log.
3. Click Add USB Device; cancel once to verify that this leaves the UI usable.
   Click again, select the modem in the browser's own dialog, and inspect VID/PID.
4. Connect. Expect USB Connecting → Connected and Tinkimodem identified. Verify
   `identify`/`tinkimodem` and then `all.get:uuid` in the log. A different serial
   device should fail identification after three attempts and release its port.
5. Power on two Tinkibots with distinct nicknames on the modem's wireless channel.
   Within polling cycles, expect both UUIDs and nicknames, with Available via modem.
   Check raw UUID and nickname replies. There should be no Claim/Release controls.
6. Power one robot off; expect Disconnected within 15–20 seconds. Power it back
   on; expect its same UUID row to become available again, without duplicates.
7. Disconnect and reconnect using the UI. Unplug during an active read and also
   during identification. Expect a visible error, offline robots and released
   locks; reattach, refresh/select the authorised port and connect again.
8. Switch to Local Proxy. Start the proxy after the browser releases the port;
   reconnect using the existing proxy behavior (reload if its initial connection
   attempt happened before proxy startup). Verify normal robot discovery,
   claim, command, release and disconnected-reservation Remove behavior.
9. Switch back to Web Serial, stop the proxy first, and reconnect. Reload to verify
   the method preference survives while USB connection remains user initiated.
10. Test Firefox/Safari or a serial-disabled policy: show capability guidance;
    selecting Local Proxy must still expose the existing robot UI. Test a port
    occupied by another program and clipboard denial; errors must stay visible.
11. Copy the debug log for failed exchanges. Distinguish handshake failure from
    a successful handshake with no wireless UUID replies. The latter requires
    checking robot power, firmware, wireless channel and modem forwarding.

## Automated checks

From the repository root:

```sh
npm exec --workspace=packages/scratch-vm -- tap --disable-coverage test/unit/extension_tinkibot_serial.js
npm exec --workspace=packages/scratch-vm -- tap --disable-coverage test/unit/extension_tinkibot.js test/unit/extension_tinkibot_api.js test/unit/extension_tinkibot_bundles.js test/unit/extension_tinkibot_music.js
npm exec --workspace=packages/scratch-gui -- jest --runInBand test/unit/components/connections-tab.test.jsx
```

Tests use mock serial permissions and real WHATWG streams, fragmented protocol
fixtures, fake timers for handshake timeouts, and the existing proxy regression
fixtures. They cover the 14 scenarios in the request plus framing overflow,
UTF-8, binary isolation, availability expiry, bounded/redacted logs, permission
policy failures, retained reservations and serial listener/UI subscription cleanup.
See the completion report for actual run results and any repository-wide failures.

## Next migration steps

First validate this discovery exchange against real modem/robot revisions and
record descriptors, channel behavior and nickname collisions. Then introduce
UUID-based command correlation/routing at a shared protocol boundary, followed
by claims and asynchronous events with ownership guarantees. Port command
translation/queues and bundles with their existing tests before file transfers.
Only add binary transport negotiation or encryption when both endpoints support
it; neither belongs in a discovery-only transport.

## Change inventory

All implementation changes are in the `tinkiblocks` repository. The proxy,
robot firmware and fetched modem source were inspected without modification.

| File (relative to repository root) | Purpose |
| --- | --- |
| `AGENTS.md` | Record the discovery architecture and guide location |
| `README.md` | Explain the Web Serial preview and link this guide |
| `packages/scratch-vm/src/extensions/tinkimo_tinkibot/index.js` | Preserve proxy behavior behind a lifecycle adapter and expose the manager |
| `packages/scratch-vm/src/extensions/tinkimo_tinkibot/connection/connection-manager.js` | Method selection, permissions, handshake, state and bounded diagnostics |
| `packages/scratch-vm/src/extensions/tinkimo_tinkibot/connection/serial-transport.js` | Serial I/O, framing, write ordering and cleanup |
| `packages/scratch-vm/src/extensions/tinkimo_tinkibot/connection/modem-discovery.js` | Existing UUID/nickname queries and availability registry |
| `packages/scratch-vm/test/unit/extension_tinkibot_serial.js` | Mock-stream protocol, lifecycle and proxy-adapter tests |
| `packages/scratch-vm/docs/tinkibot-web-serial.md` | Investigation, limitations, validation and physical test instructions |
| `packages/scratch-gui/src/components/connections-tab/connections-tab.jsx` | Select the displayed robot registry and suppress serial control actions |
| `packages/scratch-gui/src/components/connections-tab/connection-controls.jsx` | Transport/port controls and isolated temporary debug component |
| `packages/scratch-gui/src/components/connections-tab/connections-tab.css` | Connection controls, readable UUIDs and bounded log display |
| `packages/scratch-gui/test/unit/components/connections-tab.test.jsx` | UI controls, unsupported browser guidance, diagnostics and subscription cleanup |

## Validation results — 10 November 2026

| Check | Observed result |
| --- | --- |
| New serial/manager/discovery tests | 15 cases, 79 assertions passed |
| Existing Tinkibot proxy/API/bundle/music regression tests | 480 assertions passed |
| Connections tab Jest tests | 8 tests passed, including the four existing proxy UI tests |
| Chromium component smoke | Passed with real ConnectionsTab/ConnectionManager and mock serial streams: active user permission call, persisted method, fragmented handshake, two robots, raw diagnostics, discovery-only actions, disconnect/reconnect, switch to proxy and released locks; no page errors |
| VM `npm run build` | Passed |
| GUI `npm run build:dev` | Passed on final source |
| GUI `npm run build:dist` | Passed; two webpack asset/entrypoint size warnings |
| GUI `npm run i18n:src` | Passed; generated translation files follow the repository's ignored/generated-file convention |
| Scoped VM ESLint (new modules and serial tests) | Passed without errors or warnings |
| Scoped GUI ESLint (Connections components/tests) | Passed with four generic object PropTypes warnings; legacy conflicting arrow-parens warning rule disabled for the formatting pass |
| Existing VM extension lint comparison | Original and modified `index.js` both have 234 errors; no added error rules |
| Full VM tests (`npm run tap -- --disable-coverage --jobs=4`) | Failed: 1,629 passed, 114 failed. Many failures/timeouts occur in broader engine/project/asset integration tests, including failed asset fetches, missing renderer/blocks and timed-out test processes. This is not a green full-suite result. |
| Full VM lint | Failed on existing legacy errors; the scoped new code passes |
| Full GUI lint | Failed across existing files. Errors reported in an earlier revision of the new controls/tests were fixed and the final scoped check passes. |
| Full-editor Chromium smoke | Did not complete: the Connections tab resolved in the DOM but did not become actionable within 120 seconds; a diagnostic attempt also timed out reading the page body. The isolated real-component/manager smoke above passed. |
| Patch whitespace (`git diff --check`) | Passed |
| Physical modem / robot radio / production HTTPS deployment | Not performed or claimed |

Build outputs and test caches are generated/ignored and are not source changes.
No site was published, and neither the proxy nor either firmware was modified.
