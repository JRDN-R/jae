# Just Animate Everything

A local video studio with beat-timed cuts, speed ramps, zoom motion, portable projects, and frame-by-frame export.

**Open:** https://jrdn-r.github.io/jae/

Defaults: 130 BPM, two bars per clip, 24 fps, 2160 × 3840 portrait output. Add up to 20 clips. Each clip can have its own duration, motion, trim, framing, and focal point. Export one clip, every clip separately, or the whole arrangement.

`index.html` contains the application and pinned Mediabunny runtime. Branding loads from the adjacent `logo.png`, as a normal image file. No install, API key, or media upload is required. Keep both files together for an offline copy. Use a current full browser with WebCodecs support; available export codecs and resolutions depend on the device. Unsupported settings are reported rather than silently downgraded.

## Save your work

Save project creates a `.jae` file containing the original videos, optional soundtrack, arrangement, and motion settings. Open restores it. Recovery copies use browser storage and may be cleared by the browser; a downloaded project is the lasting backup.

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
```

The build verifies the runtime SHA-256 hash. It also creates the corresponding unmodified Mediabunny source archive and MPL-2.0 license in `vendor/`. The legacy `bootstrap/` archive is retained for provenance.

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
