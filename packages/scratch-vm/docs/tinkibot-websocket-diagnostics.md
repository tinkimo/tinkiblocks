# Investigating the local proxy handshake

The editor uses `ws://127.0.0.1:9006` without subprotocols. The missing trailing
slash is normalized to `/` by the WebSocket constructor. This change adds
observability; it does not change connection ownership, retries, robot commands,
or the transport protocol.

## What the source establishes

- `scratch-gui/src/reducers/gui.ts` creates a VM in `buildInitialState` (via `vmInitialState` in `reducers/vm.ts`).
- `scratch-vm/src/virtual-machine.js` always loads `tinkibot` in its constructor.
- `extension-support/extension-manager.js:loadExtensionIdSync` rejects duplicate
  loading in the same manager. Tinkibot's categories use one extension instance.
- `extensions/tinkimo_tinkibot/index.js` starts a connection in its constructor.
  `connect()` shares its pending promise within that instance. It does not close
  an existing socket or schedule reconnects. The message handlers preserve the
  existing public robot protocol.
- Separate VMs create separate extension instances. They overwrite the same
  `window.socket`, while retaining instance-local promises and connection flags.
  This can misroute subsequent sends, but overwriting a JavaScript reference does
  not itself close a WebSocket handshake. It does not establish the cause of the
  reported initial failure.
- If a connection closes before opening, the original connection promise remains
  pending; a subsequent explicit `connect()` starts a new attempt. There is no
  deliberate disconnect API, reconnect timer, or extension teardown hook here.
  Runtime disposal also resets projects, so it cannot safely be treated as
  extension destruction without investigating its callers.
- This repository contains neither the Python proxy nor the production wrapper,
  redirects, response headers, CSP, or Permissions Policy configuration.

The reported stack mentioning an extension `actions.js` does not match this
checkout. Establish the deployed commit and matching source map before assigning
that stack to these source lines.

## Reading the diagnostics

Filter the browser console for `Tinkibot WebSocket`. Each attempt has an instance
and attempt number, elapsed milliseconds, and a ready-state name (`CONNECTING`,
`OPEN`, `CLOSING`, `CLOSED`, or `UNKNOWN`). Counters are local to a loaded module
and frame; compare them within the same execution context.

The start record includes the document origin, frame status, secure-context flag,
document readiness and visibility, and previous global socket state. A duplicate
request while connecting is logged at debug level once per attempt. Open, failure,
and close records retain the original socket's identity even if another VM has
replaced `window.socket`. Close records include code, reason, clean-close flag,
and whether the attempt ever opened. Constructor exceptions log their name and
are rethrown unchanged. No robot payloads, client IDs, or URL query strings are
logged. Browser error events usually do not disclose their underlying cause.

There is no `reconnection scheduled` record because the current implementation
has no automatic reconnection mechanism. These diagnostics deliberately do not
add one before the production failure has been isolated.

## Validate from the deployed HTTPS editor

1. Deploy the diagnostic build through the normal release process. Record its
   commit and verify DevTools loads the matching bundle/source map, bypassing
   stale caches. Start the real Python proxy on the browser machine, port 9006.
2. Open DevTools before loading the editor. Enable timestamps, Preserve log and all console
   levels, including Verbose. In Network, filter for WS. Reload once. Capture
   the start, error/open, and close records and the browser's accompanying
   security messages. Record whether there was an HTTP request and a 101 reply.
3. Select the execution context containing `gui.js` in the console frame selector.
   Record `location.origin`, `window === window.top`, `isSecureContext`, and
   `document.readyState`. Repeat in the top frame. An initiator chain is not
   proof of document origin: redirects change documents, frames have their own
   origins, and an external script runs with its embedding document's origin.
4. Run the manual `new WebSocket('ws://127.0.0.1:9006/')` test in **that same GUI
   frame**, first immediately after reload and then after the automatic failure.
   Record its open/error/close outcome and close the test socket afterwards.
   A later success in the top frame does not establish permission for a framed
   GUI or permission at startup time.
5. Inspect the actual document responses for both hosts: redirects, frame
   `sandbox`/`allow` attributes, CSP `connect-src`, Permissions Policy, and Chrome's
   local-network access permissions for the relevant origins. Capture DevTools
   Issues/security messages. Do not assume mixed-content blocking just because
   the document is HTTPS, and do not add TLS when the same-frame test succeeds.
6. Correlate proxy timestamps and connection endpoints with those records. Supply
   the proxy version, handshake/origin-validation configuration, and whether it
   received a request line and `Origin` header. Inspect only necessary handshake
   metadata, not credentials or robot message payloads. An EOF before the HTTP
   request line is not evidence of an origin rejection; origin validation needs
   an HTTP request to examine.
7. Exercise a robot command after `opened`, then stop/restart the proxy and test
   an explicit subsequent connection request. Also reproduce the UI action
   suspected of recreating the VM. Multiple instance IDs and a live previous
   socket identify the shared-global ownership issue; one attempt failing
   before HTTP with a browser policy message points elsewhere.

The distinguishing evidence is: same-frame automatic versus manual timing,
number of extension instances, any socket replacement, browser policy messages,
actual document/frame policies, and matching proxy handshake metadata. Until
that evidence identifies the cause, a lifecycle rewrite would be speculative.

## Controlled browser evidence

In the onboarding environment, a Chromium test served the compiled VM from a
locally fulfilled HTTPS test document (`https://editor.tinkimo.test`) and used
a real loopback WebSocket server. With default browser permissions, automatic
connection failed with `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`; the server
received no successful WebSocket connection. With `local-network-access` granted
to the browser context, the same VM established exactly one connection to
`ws://127.0.0.1:9006/`, with the HTTPS test origin in the handshake. No web-security
disable flag, TLS proxy, or robot protocol change was used.

This demonstrates a permission-dependent failure mode, not the production root
cause. It does not reproduce the deployed wrapper, user permission history, real
Python server, or robot communication. Compare automatic and manual connections
in the same deployed frame to establish whether that mode applies.

## Automated coverage

From `packages/scratch-vm`, run:

```sh
../../node_modules/.bin/tap --disable-coverage test/unit/extension_tinkibot*.js
```

The connection tests cover initial open, simultaneous calls sharing one handshake,
error/close before open, explicit retry after unexpected close, VM recreation,
constructor rejection, attribution after global socket replacement, and reporting
`CLOSING` without mutating the connection. Other Tinkibot suites verify robot
commands and response correlation. Deliberate disconnect, automatic reconnect,
and extension destruction cannot be tested as supported APIs in this checkout:
those lifecycle hooks do not exist and this diagnostic change does not add them.
