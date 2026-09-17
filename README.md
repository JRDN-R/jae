# Just Animate Everything

A local video studio with beat-timed cuts, speed ramps, zoom motion, portable projects, and frame-by-frame export.

**Open:** https://jrdn-r.github.io/jae/

Defaults: 130 BPM, two bars per clip, 24 fps, 2160 × 3840 portrait output. Add up to 20 clips. Each clip can have its own duration, motion, trim, framing, and focal point. Export one clip, every clip separately, or the whole arrangement.

`index.html` contains the application and pinned Mediabunny runtime. Branding loads from the adjacent `logo.png`, as a normal image file. No install, API key, or media upload is required. Keep both files together for an offline copy. Use a current full browser with WebCodecs support; available export codecs and resolutions depend on the device. Unsupported settings are reported rather than silently downgraded.

## Save your work

Save project creates a `.jae` file containing the original videos, optional soundtrack, arrangement, and motion settings. Open restores it. Prepare portable project reads and checks the original bytes first, then offers Download or Save file in Ready to keep. The Save file action checks the written byte count and final file size. Ordinary browser downloads cannot be confirmed by the page, so check the downloaded size before closing.

Save settings only creates a small `.jae-edit.json` backup without reading original media. Open it and choose the original videos and soundtrack to restore the edit. Reconnect original files repairs media access in the current edit. A settings snapshot is also stored locally before each complete save or render attempt when browser storage is available.

Recovery copies use browser storage and may be cleared by the browser; a downloaded project is the lasting backup. If saving or rendering fails, keep the current tab open until a backup succeeds. Older open tabs do not receive deployed fixes automatically.

Original clip audio is muted. An optional soundtrack retains its normal speed, and the metronome is preview-only. Keep the page visible during rendering. There is no optical-flow interpolation, HDR grading, or server rendering.

## Source and reproducible build

The editable files are in `src/`. Building is a developer task; these tools are not needed to use the app.

```sh
mkdir -p runtime
npm pack mediabunny@1.57.0 --pack-destination runtime
tar -xzf runtime/mediabunny-1.57.0.tgz -C runtime
python3 build.py
node tests/core.test.cjs
node tests/runtime.test.cjs
node tests/app.test.cjs
node tests/project.test.cjs
node tests/player.test.cjs
node tests/edit-backup.test.cjs
node tests/storage.test.cjs
node tests/save.test.cjs
```

The build verifies the runtime SHA-256 hash. It also creates the corresponding unmodified Mediabunny source archive and MPL-2.0 license in `vendor/`. The legacy `bootstrap/` archive is retained for provenance.

## Release 1.0.4

- Fully read and stage portable/recovery projects before reporting them ready; verify native writes and reject empty output.
- Retain private source copies for the live edit and Undo when the opened disk project is overwritten.
- Add settings-only backup and restoration with original-file reconnection.
- Check source access before rendering and keep failure details visible with recovery actions.
- Keep unsaved-change protection after an unverified browser download or when an older prepared file does not contain the latest changes.

## Release 1.0.3

Each clip now has an X button. A named-clip confirmation offers Cancel or Delete clip, and Undo restores deleted clips. The arrangement Remove button uses the same confirmation.

## Release 1.0.2

- Keep the brand and project actions on the same top row, including narrow screens.
- Load the repository's `logo.png` in the header and favicon without an embedded image URI.
- Add a JAA-style floating preview with drag, resize, return, and dismiss controls.
- Double-tap the left or right side to skip five seconds without changing the playing/paused state. Focus the preview and use arrow keys for the same jumps.
- Use the framing sliders or Alt-click the preview to position the zoom center.

## Release 1.0.1

- Refresh paused previews when source metadata and decoded frames become available.
- Keep rapid scrubbing on the latest requested frame and stop held footage at the trim boundary.
- Restart metronome subdivisions correctly for loops containing fractional bars.
- Honor cancellation during export finalization and clean up temporary output.
- Restore editable source, reproducible build, bundled-library source/license, and regression tests.

All 18 timing, preview, metronome, decoder-loop, and project-file test groups pass. A real 2160 × 3840, 24 fps H.264 MP4 was encoded and inspected. See `tests/VERIFICATION.md` for test scope and remaining device checks.
