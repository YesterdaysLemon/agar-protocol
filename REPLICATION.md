# Fluoddity reproduction

This checkout tracks the author's MIT-licensed `Fluoddity-Web` source at commit
`e072983b7b8bda36d3259be669fa817a0b53f2fc`, the revision whose production
JavaScript is currently served by <https://fluoddity.com/>.

## Run Corally locally

```powershell
npm ci
npm run dev
```

Open the original Corally URL against the local origin, preserving its query and
`#b=` fragment. The fragment is the complete version-8 project payload; it does
not require a server-side save.

## Produce and verify the deployed bytes

```powershell
npm run build:replica
npm run verify:live
```

`build:replica` performs the upstream production build and then normalizes copied
text assets to LF. That final normalization is necessary on Windows because Git
may check JSON and HTML out with CRLF while GitHub Pages builds the same files on
Linux. `verify:live` fetches every path in `dist/` and requires the local and live
SHA-256 digests to match exactly.

Verified on 2026-09-01: all 145 deployed files matched exactly, and the upstream
test suite passed all 893 tests.

## What the Corally link contains

The `#b=` fragment is 479 bytes of base64url-encoded binary data: share-codec
version 1 carrying a version-8 project. It contains one 80-float behavior rule,
16 physics/control scalars, four cohort flags/settings, and the shared trail
world settings. It does not contain the instantaneous particle positions,
velocities, trail texture, frame counter, display preferences, or calibration.

Corally uses four cohorts arranged on a grid. Each cohort receives a stable,
seeded mutation of the same 80-float rule at mutation scale `0.133`. The world
uses wrapping boundaries, trail persistence `0.9430000185966492`, and maximum
trail diffusion. Its hazard rate is zero, so the striking apparent splitting is
the trail-feedback dynamics reorganizing a fixed population, not particles
being born or killed.

The comparison establishes artifact parity with the live deployment at the time
it is run. It does not promise identical simulation frames across different GPU
drivers: WebGPU floating-point execution, timing, and user preferences can still
change the evolving state even when the program bytes and starting payload are
identical.

`npm audit --omit=dev` reports no production vulnerabilities. The full audit
flags the pinned development toolchain's transitive `nanoid@3.3.16`; it is left
unchanged here because upgrading the build dependency would forfeit artifact
parity with the live deployment.
