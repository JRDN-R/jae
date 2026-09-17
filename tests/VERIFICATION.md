# Release verification

## Release 1.0.2

The 18 existing timing, preview, metronome, decoder, and project-file test groups pass after the player changes. Seven additional groups in `player.test.cjs` cover double-tap recognition, ignored single/drag/cancel/modified gestures, playback-preserving skips, timeline boundaries, busy/modal guards, viewport bounds, and canceled or superseded asynchronous audio startup. Total: 25 passing groups.

Code review confirms that the same live canvas moves between the page and floating player. It is reparented to `body` while floating, with aspect-preserving sizing, compact controls, return/dismiss behavior, and modal guards. The header and favicon reference the tracked `logo.png`; the header actions stay beside the brand through the responsive styles.

The test browser remained unresponsive, so visual desktop/mobile checks and physical touch-device checks of the new player were not completed in this session. The tests above isolate application behavior and do not certify browser layout or device gesture delivery.

## Release 1.0.1

Date: 2026-09-17.

## Passed

- Eight deterministic timing groups: defaults, zoom endpoints, integrated speed, tempo changes, short slots, trim modes, frame boundaries, and normalization.
- Four preview/metronome regression tests: media readiness, latest pending scrub, held trim endpoint, and fractional-bar loop scheduling.
- Two tests against the pinned Mediabunny decoder scheduler: repeated/backward timestamps and iterator cleanup.
- Four tests of actual portable-project serialization/import: byte-for-byte video and soundtrack preservation, settings/metadata, shared media deduplication, payload stability, invalid-file rejection, and staged-resource cleanup.
- Live browser smoke checks: page initialization, demo loading, clip length changes, and exact encoder capability feedback.
- Real browser H.264 MP4 export of a short selected demo clip at 2160 × 3840 and 24 fps. The resulting 1,249,400-byte file was inspected with ffprobe: H.264, 2160 × 3840, 24/1 frame rate, 0.458333-second duration. This render used the original export path; the release changes cancellation handling after finalization.
- GitHub Pages deployment succeeded. The served HTML SHA-256 matched the locally built release exactly: `12c246f4b0bb44f9c58e45c4ce9ada374046d8c30a9f65266971282f6f5100a5`.

## Scope limits

The project-file tests isolate browser decoding; they do not replace a physical-device import test. The live browser session stopped responding while handling a project-replacement confirmation, so real video-and-audio save/reopen, batch exports, MOV/WebM, and IndexedDB recovery were not completed end to end in this session. The prior integration script remains available as `browser.cjs` for a developer-controlled test environment.

Physical iPhone/Android 4K rendering, long-duration exports, HDR input, and device-specific codec support are not certified by these tests. The app checks the selected encoder configuration and retains explicit limits and unsupported-format messages.
