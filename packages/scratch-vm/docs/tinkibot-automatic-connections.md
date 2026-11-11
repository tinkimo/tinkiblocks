# Automatic Tinkibot connections

Connections offers Auto (default), Modem and Proxy. Preference and the actual
active transport are separate manager state. The VM remains the authoritative
robot registry; React subscribes to it. Blocks, the public request API, response
correlation and bundle collection boundaries are unchanged.

## Detection and recovery

- Auto enumerates `navigator.serial.getPorts()` and checks ports sequentially.
  Each candidate uses the existing 115200 8N1 `identify` handshake (three one-second
  attempts), then a correlated `register` (five-second timeout) requiring
  `robot-api-v1`. Failed candidates close their streams and release locks before
  the next port opens. No DTR/RTS/reset sequence is sent.
- Only Add USB Device calls `requestPort()`, directly from a click. Cancellation
  leaves the current connection alone. Selecting/authorising a port pins that
  choice until the preference changes; Connect uses that choice.
- If no compatible authorised port succeeds, Auto connects to
  `ws://127.0.0.1:9006`, with a 2.5-second connection deadline. Modem never falls
  back. Proxy never enumerates or opens USB ports.
- A USB candidate is verified using an isolated instance of the existing serial
  session implementation while the proxy remains connected. Its streams are
  transferred to the active manager only after validation. Queued/executing
  commands, bundles, claims, releases and removals defer automatic switching;
  the UI offers a notification and Retry. A deferred candidate ends its lease
  and releases the port. Explicit preference changes cancel pending work.
- USB attach/detach, serial stream errors, proxy loss, tab visibility and opening
  Connections trigger policy checks. Recovery uses at most three delayed attempts
  (1, 3, 10 seconds). Retry explicitly starts a fresh cycle. Disconnect pauses
  recovery until Connect, Retry or a preference change.
- Failed candidate ports are remembered for the session, avoiding repeated opens
  of unrelated hardware. Reattachment or explicit Retry permits another probe.
  Chrome/Edge may require authorisation again for a different USB device or port.
- The Connections pane is constrained to the editor tab and scrolls vertically,
  including on short laptop screens. The console has its own visible scrollbar,
  viewport-bounded height and keyboard focus; Copy log remains reachable.
- The diagnostic history is shared, in memory, and survives switches: up to 200
  timestamped entries of 1,000 characters, redacted as before. Verbose mode adds
  raw/parsed traffic for both transports. Expand the bottom console to clear or
  copy metadata and logs. It scrolls internally.

## Discovery investigation and fixes

The inspected gateway already implements asynchronous discovery and expiry:
`gateway/controller.py::registry_event` emits the individual robot event and a
complete `connected_robots` snapshot; `gateway/registry.py::observe/service`
reconciles UUIDs, nickname changes and peer freshness. Gateway discovery runs at
five seconds, and robots expire after 20 seconds without a live route. An offline
accepted claim becomes uncertain, retaining its owner. No firmware change was
required for this task.

Browser defects found in the code and covered by regression scenarios were:

1. The lease/list `setInterval` could overlap requests and immediately disconnect
   the entire link after one failed refresh. A late successful response lacked a
   connection generation check and could replace newer state after reconnect.
2. Every identical snapshot rebuilt the runtime list and notified React, even
   when nothing changed. Transport switching explicitly sent an empty registry,
   losing reservations rather than representing availability separately.
3. `robot_connected` used `incomingOwner || oldOwner`, so an explicit null owner
   could incorrectly retain an old claim. It also retained an old claim status
   when the event supplied a new one.

The browser now consumes the existing notifications immediately and uses a
single nonoverlapping register refresh as a repair path. Its default interval is
5,000 ms (`environment.refreshInterval`, keep below the 20-second gateway lease);
it reads the cached registry and renews the lease without issuing robot commands
or extra wireless discovery. It therefore continues during long commands without
interrupting execution. One or two failed refreshes retain the registry; three
consecutive failures close the connection and invoke bounded recovery. Replies
from obsolete connection generations are discarded.

Snapshots are reconciled by UUID. Identical robot objects are reused and
unchanged lists do not notify the UI. Missing claimed rows remain offline until
Remove or an authoritative owner update; offline does not mean released. Explicit
null ownership and claim-status changes are applied. The existing physical
confirmation and uncertain-reservation rules remain in place.

These software findings do not prove a particular hardware installation's radio,
power or USB fault. Hardware acceptance remains necessary.

## Validation

Automated coverage lives in:

- `test/unit/extension_tinkibot_serial.js`: real stream mocks, sequential probes,
  timeouts, permission cancellation, manual modes/pinning, fallback, bounded
  recovery, detach/reattach, visibility, deferred switching, cancellation, discovery
  reconciliation, missed refresh, diagnostics, claims, commands and bundles.
- `test/unit/extension_tinkibot_bundles.js`: existing bundle regression coverage;
  mocks now close sockets and dispose managers, including connection deadlines.
- GUI `test/unit/components/connections-tab.test.jsx`: segmented preferences,
  status, shared robot updates/actions, console controls, retained log content and
  its position after robot changes.

Run from the corresponding package:

```sh
# scratch-vm
node test/unit/extension_tinkibot_serial.js
node test/unit/extension_tinkibot.js
node test/unit/extension_tinkibot_api.js
node test/unit/extension_tinkibot_music.js
node test/unit/extension_tinkibot_bundles.js
npm run build
# scratch-gui
npm run test:unit -- --runInBand
npm run i18n:src
npm run build:dev
npm run build:dist
```

Validation results for this change:

- Serial/connection suite: 39 scenarios, 171 assertions passed.
- Existing VM/proxy/API/music/bundle regressions: 483 assertions passed.
- GUI: 47 suites, 311 tests and 15 snapshots passed; one existing skipped test.
- VM build, GUI development/production builds and translation extraction passed.
  Production retains two asset-size warnings.
- Scoped manager/serial/bundle and GUI lint: zero errors. GUI retains rule-conflict
  arrow-parenthesis and generic PropTypes warnings. The legacy VM extension has
  233 lint errors and three warnings, exactly matching its baseline; package-wide
  lint therefore remains blocked. Whitespace checks passed.
- No physical modem/robot, firmware flash or hosted deployment validation.

A Chromium smoke test uses the real Connections component, VM extension,
connection manager and serial framing, with a simulated gateway: automatic
startup without prompting, physical claim gate, movement, bundle, sensor,
release, live rename/offline/reconnect, bottom diagnostics, native click activation,
reconnect and preference switching. This is browser simulation, not hardware
verification.

## Windows Chrome/Edge manual acceptance

1. Use the matching HTTPS editor and provisioned gateway. Close serial monitors.
   Open Connections with no saved preference: Auto should connect to an already
   authorised compatible gateway without a picker. With a new device, click Add
   USB Device, select it, then Connect. Cancel once to verify harmless cancellation.
2. Authorise an unrelated serial device before the gateway. Verify the wrong
   device closes after the bounded handshake and the gateway is selected. Ensure
   the unrelated device can still be used by its normal application afterwards.
3. With no gateway, start the Python service: Auto should use Proxy. With neither
   service, verify Disconnected and bounded retries. Start the service and Retry.
   Check Modem does not fall back and Proxy does not touch USB.
4. With a proxy command/bundle or physical claim pending, attach an authorised
   gateway. Verify the proxy remains active and the deferred-switch message
   appears. Finish the transaction and Retry. Check manual port pinning, Disconnect
   staying disconnected, switching preferences and returning to a visible tab.
5. Power on a robot after connection; claim it and physically accept. Rename it,
   power it off, wait over 20 seconds, then power it on. Verify one UUID row, updated
   nickname/availability, retained ownership and physical revalidation as required.
   Test a brief radio interruption shorter than the expiry period.
6. Unplug/replug USB while idle and with a request pending. Pending work must reject,
   rows go offline, resources close, and recovery follows the preference. Do the
   equivalent by stopping/restarting the Python service. Movement is never replayed.
7. Run normal movement, sounds, a multi-action bundle and a sensor reporter through
   both transports. Release only on the protocol's confirmed outcome. Expand the
   bottom console, enable verbose, switch preference, copy and clear the history.

School policy may block Web Serial or device permissions even in Chrome/Edge.
USB drivers, radio reachability, the existing gateway capacity and local-proxy
BLE support still apply. OS-level serial `open()`/close completion depends on the
browser and driver; identification and API/WebSocket handshakes are bounded.
No firmware flashing, real-radio test or hosted-editor deployment was performed.

## Files changed

- `AGENTS.md`, `README.md`: connection policy guidance and documentation links.
- `packages/scratch-vm/src/extensions/tinkimo_tinkibot/connection/connection-manager.js`:
  preference, probes, transfer, fallback, lifecycle, recovery and refresh.
- `packages/scratch-vm/src/extensions/tinkimo_tinkibot/index.js`: manager startup,
  busy indication, proxy diagnostics and UUID reconciliation.
- `packages/scratch-gui/src/components/connections-tab/connection-controls.jsx`:
  segmented selector, active status, retry and exported permanent console.
- `packages/scratch-gui/src/components/connections-tab/connections-tab.jsx`:
  activation and console placement below the shared robot list.
- `packages/scratch-gui/src/components/connections-tab/connections-tab.css`:
  compact selector and bottom-console layout.
- `packages/scratch-vm/test/unit/extension_tinkibot_serial.js`,
  `packages/scratch-vm/test/unit/extension_tinkibot_bundles.js`,
  `packages/scratch-gui/test/unit/components/connections-tab.test.jsx`: coverage.
- `packages/scratch-vm/docs/tinkibot-web-serial.md` and this document: updated
  workflow, investigation, limits and validation instructions.

Translation extraction was run; its generated source files are ignored by this
repository. No dependencies or firmware files changed.

### Console viewport regression

A real-CSS Chromium reproduction at 1024×600 showed the Connections pane expanding
to 694 px and ending below the clipped editor at y=786, without its own overflow.
The pane now fills the positioned tab bounds (508 px, ending at y=600), and its
694 px contents scroll. With 200 diagnostic entries the console stays at 238 px
while its contents scroll independently; keyboard scrolling and Copy access pass.
The earlier component smoke used stub CSS and did not exercise this flex-layout
failure. The updated verification uses the real Connections and GUI tab styles.

The reported one-of-two physical robot discovery problem remains unconfirmed.
A host simulation of sequential BLE connections with distinct UUIDs reaches both
registry rows, while two BLE peers reporting the same UUID reproduce one row and
`robot_uuid_peer_changed`. Compare the two standalone UUIDs and capture the verbose
log with both robots on before attributing the hardware symptom to either path.
