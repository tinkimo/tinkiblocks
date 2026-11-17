# Project image editor

The Images tab follows Connections (tab index 4). Its reusable SVG uses the same
current-colour stroke and sizing class as the Connections icon. It is mounted
only while selected, so its keyboard shortcuts do not capture Code-tab keys.

## Editing

`packages/scratch-gui/src/components/images-tab/` contains the React editor,
localized labels, styling, screen icon and pure RGB pixel operations. The model
is always 128 × 140 RGB888, with a 256 × 280 nearest-neighbour drawing canvas and
128 × 140 robot preview beneath the existing 20-pixel status bar. The robot LCD
stays at its normal 128 × 160 portrait orientation. Native PNG exports preserve
all 128 × 140 artwork pixels. The drawing surface can shrink while keeping its aspect ratio. No status pixels or editing overlays enter image data. Drawing, shapes, selection,
image editing, image actions and export/upload controls have labeled groups.
Duplicate and Delete sit beneath the canvas beside Export and Upload.
There is no pixel grid control. The Paint-style ribbon groups Selection (with
Cut/Copy/Paste), Tools and Shapes using consistent SVG icons and visible names.
Rectangle and Ellipse share a Fill shape option rather than separate filled
buttons. Undo/Redo/Clear image sit above the ribbon; active-tool instructions
and relevant size/text controls appear below it. Colours have separate drawing
and paper wells, a compact swatch grid and an explanation that paper colour is
used by Eraser and Clear image without recolouring existing pixels.

The preview sits inside a clean vector illustration of the yellow robot top,
with a tall raised centre cover, silver button mounts, black switches, corner
screws, a portrait screen bezel and a separate status strip.
Only the native artwork is exported or uploaded. The editing area has a bounded
width and compact wrapping control groups, so wide windows do not stretch the
tools or export controls across the screen.

Pencil, adjustable brush/eraser, bounded flood fill, line, outlined/filled
rectangle and ellipse, thresholded monospace text, colour sampling, region
copy/cut/paste/move, palette and custom colour input work without a robot.
Dragging interpolates strokes; shapes and text preview before committing.
The A/Text tool opens a focused text box directly on the image. Typing previews
native pixels on the canvas and robot screen; Enter inserts a line and text wraps
at the picture edge. Font size and colour remain editable while the box is open.
Done, Ctrl/Cmd-Enter, clicking outside, export/upload or leaving the Images tab
finishes the text as one undo step. Escape discards it. Loading another project
clears the old draft. Text boxes and carets are overlays and never enter PNG or
robot pixels; finished text is flattened into the existing RGB model.

Ctrl/Cmd-Z, Shift-Z/Y, C/X/V and arrow-key selection movement are scoped to the
editor. Inputs retain native text-editing shortcuts. Pointer cancellation restores
the uncommitted image. Undo history persists across image/tab switches, holds
30 operations per image and at most 140 RGB snapshots across the collection
(about 8 MiB). History is intentionally not part of the saved project.

Create, rename, duplicate and confirmed delete use `ImageCollection`, with stable
UUIDs, case-insensitive unique filenames, and a 64-image project limit. Filenames
are 1–64 lowercase ASCII letters/digits/hyphens, starting with a letter or digit.
Filename rules appear above the input; capitals become lowercase and spaces or
underscores become hyphens. Empty or duplicate names show an error beside the
field and block upload until corrected. Restored legacy names are normalized,
with numbered suffixes for collisions, preserving all IDs, selection and RGB data.
New images use the next available `imageN` name. Image dimensions cannot change.
Import accepts PNG/JPEG, previews contain or centre-crop onto the chosen opaque
background, then creates a new image. PNG export writes the native image only.

## Persistence and project lifecycle

`src/tinkibot-images/collection.js` owns RGB buffers, filenames and selection.
The VM exposes `projectImages` and emits `TINKIBOT_IMAGES_CHANGED`; edits and
selection changes emit `PROJECT_CHANGED` for existing dirty/autosave handling.
`sb3.serialize` adds `meta.tinkibotImages`:

```json
{"version":1,"selectedId":"<uuid>","images":[
  {"id":"<uuid>","name":"image1","width":160,"height":118,"rgb":"<base64 RGB888>"}
]}
```

The data lives in `project.json` inside the normal `.sb3` archive. This compatible
metadata extension is deliberate: GUI server autosave uploads `vm.toJSON()` and
the VM's existing costume/sound asset list separately. Embedding bounded lossless
RGB data covers both archive downloads and JSON server autosave without adding
an unknown asset type, a separate remote store, asynchronous PNG encoding or
extra browser persistence. ZIP compression still applies. Each image is 56,640
RGB bytes, represented by 75,520 base64 characters before ZIP compression.
The full project does not depend on external files or local storage.

Load validates version, IDs, dimensions, data length, names and duplicate names
before replacing the collection. Old projects get an empty gallery. Clear/new
project resets it. A load generation prevents older asynchronous validation or
target deserialization from overwriting a newer project. Restore assigns the
collection synchronously; it never races an asynchronous image decoder. Sprite
exports do not include project images. Scratch targets and assets are unchanged.

## Robot format and upload

`rgb565.js` converts to the existing headerless, row-major big-endian RGB565
format, 40,960 bytes (128 × 160). The first 140 rows contain the artwork;
the final 20 rows are black padding clipped by the existing application view. Only upload quantizes RGB888 to the hardware's RGB565; project
storage and PNG export preserve the original colours. Upload and project saving
are independent. Display has a separate “display my image” command whose
dropdown contains only
current project filenames. It is disabled with “no images” when the gallery is
empty, including existing workspace instances. Disabled custom-image blocks keep
their normal category colour while the label and dropdown text turn grey. Successfully uploading an image enables it. New images, renames and edits remain
unavailable until their current version is uploaded. Removing an image refreshes
the dropdown and repairs missing selections.
Literal user-image choices in older project scripts migrate to the new block
on load, preserving block IDs and connections. Built-in choices and reporter
inputs remain unchanged. The original display-image dropdown contains only
built-ins. Preload continues
to include both built-ins and uploaded project filenames. Empty/stale user-image values
are no-ops and cannot send robot commands. Filename and upload-availability changes refresh block metadata. Editing an uploaded
image removes it from the menu once; further pixel edits do not rebuild the toolbox. Image uploads use
`<name>.rgb565` under `/files/user/`.

Upload requires one connected robot claimed by this client. It shares the existing
command queue and prevents concurrent image uploads. Transport switching uses the
existing busy checks. Errors are surfaced and no success is shown before verified
completion. Progress callbacks update the UI; FILE_PENDING asks the student to
confirm replacement on the robot. Protected system names remain protected by the
robot's storage validation.

* **Local Proxy:** the bounded `upload_image` JSON command carries the RGB565
  filename and base64 bytes. The updated proxy validates the exact dimensions and
  claim owner, uses a private temporary file and its existing TFP FileSender,
  and broadcasts correlated progress events. Existing BLE and modem/ESP-NOW
  connection/capacity negotiation, retries, SHA-256 verification, overwrite
  confirmation and cleanup are reused.
* **Web Serial:** the existing serial reader now retains binary frame bodies and
  its serialized writer accepts byte arrays. `serial-upload.js` requires a
  positive `TFP1-MODEM <nonce> <capacity>` response to the documented route-open
  request before binary output. `tfp.js` implements the same CRC32/COBS, SHA-256,
  negotiated chunk sizes, stop-and-wait retry, pending/ready, ACK, completion and
  cancel contract. It never opens a second serial connection.

## Firmware and compatibility

The robot firmware defaults to portrait 128 × 160 with a 20-pixel status strip.
Editor uploads use the existing full-screen 40,960-byte RGB565 file format:
128 × 140 artwork pixels first, followed by 20 black padding rows. The unchanged
loader validates 128 × 160, then clips drawing to the 140-row application view.
Padding goes at the end, not before the artwork: the display manager already
positions application pixels beneath the status bar. No rotation, status height,
scaling or firmware update is needed for these files. Re-upload previously sent
35,840-byte files to replace them with compatible padded files. The companion
firmware loader additionally supports those earlier short draft files.

Earlier landscape draft projects (160 × 118) are fitted upright into the new
portrait canvas on load using nearest-neighbour sampling and white padding.
Their IDs, names and selection remain intact; new saves use portrait dimensions.

**Modem prerequisite:** older text-only Tinkimodem firmware cannot forward TFP.
The consolidated byte-safe Web Serial gateway now implements that forwarding in
https://github.com/tinkimo/tinkimoden-proxy/pull/1, including ESP-NOW and
confirmed-MTU BLE routes. Use matching TFP-capable robot and gateway firmware.
The desktop proxy still uses its existing direct BLE/original-modem interfaces;
the consolidated JSON gateway is selected through Web Serial. Negotiation fails
without binary output if a modem cannot positively confirm support. Host protocol
tests, reference receiver checks and browser tests do not prove physical modem,
BLE, ESP-NOW or LCD interoperability.

## Validation

GUI tests cover the tab editor, pointer mapping, tools, colour accuracy, text,
selection operations, CRUD, undo/redo, import layout, isolation and upload feedback.
VM tests include a real archive round trip with multiple images, selected ID and
exact RGB comparison, byte-for-byte original Scratch asset comparisons, JSON
autosave, old projects, new projects, concurrent loads, dynamic menus, RGB565
encoding, a Python-generated TFP wire fixture, upload success/failure, overwrite
acceptance and existing-serial-channel negotiation/cleanup.

Run focused checks from the respective package directories:

```sh
# scratch-gui
../../node_modules/.bin/jest --runInBand --runTestsByPath test/unit/components/images-tab.test.jsx
# scratch-vm
../../node_modules/.bin/tap --disable-coverage test/unit/tinkibot_images.js
```

Companion proxy and firmware tests live in `tests/test_image_upload.py` and
`tests/test_editor_images.py`. Run each repository's full unittest suite.

### Results in the implementation environment

* GUI: all 50 unit suites passed (347 tests, one existing skip; 15 snapshots).
  The editor's 24 focused tests also pass independently.
* VM: all 100 image checks passed. The full unit run reported 2,860 passing
  checks and three failures in existing `project_changed_state.js` costume tests.
  The same missing-renderer `createSVGSkin` failure was reproduced with the
  unchanged VM source; it is independent of the image editor.
* Proxy: all 218 unittest tests passed, including upload cancellation cleanup.
* Robot firmware: all 557 unittest tests passed.
* VM build and GUI development/production/standalone builds completed. New image
  modules pass their focused lint checks. Translation source extraction completed.
* Real Chromium testing covered icon alignment, canvas dimensions, drawing,
  undo/redo, native PNG export without grid pixels, import preview, multiple
  images, saving an `.sb3`, reloading the application and reopening that project,
  retained pixels and responsive aspect ratio. Portrait preview checks cover
  upright asymmetric artwork, native pixels below the existing status bar and compact groups.
  Physical robot/modem testing is still required.

## Automatic project image sync

After a project finishes loading, or its active claimed robot connects, reconnects
or changes, the editor clears that robot's uploaded images and restores all images
from the current project. Loading an empty project clears uploaded images too.
Built-in images and non-image files are preserved. No work is sent to unclaimed
robots. Images and Connections show progress, failures and a Retry image sync
action. Custom image commands and manual uploads wait until restoration finishes.

The coordinator in `src/tinkibot-images/sync.js` serializes jobs and pins them to
the project generation and robot UUID. Superseded jobs stop at transfer boundaries;
the next job clears partial work before restoring its own snapshot. Each restore captures a fixed snapshot before any transfer starts. The editor is
blocked until the operation completes or a stopped failure is acknowledged. Ordinary edits after restoration
still use Upload to Robot.

Deploy the matching robot firmware and proxy or USB modem software: automatic
sync uses the accepted-claim `reset_images` RPC before existing 40,960-byte image
uploads. Older software reports a visible sync failure rather than leaving stale
images silently available. Robot display rotation is unchanged.


Upload availability belongs to the active project and claimed robot; it is not
saved in project metadata. The sync coordinator records each confirmed upload's
image ID, filename and immutable pixel-buffer identity. Tinkiblocks edits replace
that buffer, so tracking needs no pixel comparisons or remote file reads. A
changed filename or buffer requires upload again. Successful automatic restores
and manual uploads both update the record; failed, pending or superseded uploads
never mark newer edits available. Robot/project changes clear these records.

Leaving the Images tab with any new or edited image that still needs upload shows
an alert explaining Upload to Robot and the display my image block. Pending text
is committed before checking. The ready status also shows an upload reminder
while edits are pending; selecting images alone does not mark them changed.


## Blocking project restoration

The existing sync coordinator owns each automatic restoration's UUID, target,
private image snapshot, attempt number and acknowledged completion index. Capture
filenames and independent RGB buffers when the operation is requested, including
when another interrupted transfer must settle first. Do not rebuild its queue
from the live collection. Normal manual uploads remain independent.

The GUI mounts the standard styled Modal as “Uploading project images” for the
whole operation. It displays the current .rgb565 filename, acknowledged count and
available transfer progress. ReactModal traps focus and hides the app from
assistive technology; the workspace is inert and document shortcuts/outside
clicks are blocked. VM image mutations, green flag, project loading/export and
ordinary robot requests also reject during the lock. Modal focus cannot commit
pending editor text or filenames into a restoration snapshot.

Failure keeps the filename/error visible and the workspace locked. Retry resumes
at the failed snapshot image without clearing or repeating acknowledged uploads.
Close is available only after the active transfer has settled. There is no Cancel
button while transferring: the transports do not provide a common acknowledged
cancellation API. Disconnect and internal disposal/unmount invalidate callbacks,
stop further files and keep the VM locked until the current promise settles.
Late progress from failed/completed attempts cannot reopen the dialog. On success
or safe close, interaction, inert/ARIA attributes, document listeners and focus
are restored. Project data and the robot protocol are unchanged.
