# Renderer spike: desktop-hg8er1k-low-power-cpu4x

2026-10-10T16:32:37.182Z · win32-x64 · 16 x AMD Ryzen 7 8745H with Radeon 780M Graphics · 31 GB · Chrome 155.0.8059.40
GPU flag `low-power` → `ANGLE (AMD, AMD Radeon(TM) 780M (0x00001900) Direct3D11 vs_5_0 ps_5_0, D3D11)` · CPU throttle 4x · Pixi 8.21.0 · max batchable textures 16 · GPU timer EXT_disjoint_timer_query_webgl2

Window 10 s after 5 s warm-up, 1280×720, 1x device pixels. CPU columns are % of one core over the window. Canvas "draws" are 2D context calls (drawImage, fill, stroke, fillRect), not GPU draw calls.

| case | fps | frame ms p50 / p95 / max | GPU ms p50 | draws/frame | main thread % | renderer CPU % | GPU process CPU % | browser CPU % | errors |
|---|---:|---|---:|---:|---:|---:|---:|---:|---|
| pixi plain 200 no-desks | 60.0 | 3.20 / 5.80 / 10.40 | 1.18 | 1.0 | 37.1 | 110.8 | 18.1 | 0.5 |  |
| pixi tint 200 no-desks | 60.0 | 2.90 / 4.30 / 6.60 | 1.17 | 1.0 | 30.0 | 109.6 | 15.8 | 0.6 |  |
| pixi mask 200 no-desks | 60.0 | 3.30 / 4.80 / 7.10 | 1.51 | 1.0 | 32.8 | 110.0 | 15.6 | 0.3 |  |
| pixi filter 200 no-desks | 60.0 | 3.30 / 4.80 / 8.90 | 1.24 | 3.0 | 32.6 | 110.1 | 16.1 | 0.4 |  |
| pixi mask 200 | 60.0 | 3.50 / 5.20 / 8.90 | 1.60 | 2.0 | 34.0 | 110.6 | 16.3 | 0.3 |  |
| pixi mask 5 | 60.0 | 1.50 / 2.10 / 3.10 | 0.30 | 2.0 | 24.9 | 108.7 | 16.9 | 18.5 |  |
| pixi mask 200 30fps | 30.0 | 2.90 / 4.30 / 10.10 | 0.61 | 2.0 | 19.9 | 105.9 | 8.2 | 0.3 |  |
| pixi mask 200 idle | 0.0 | – / – / – | – | – | 7.6 | 102.1 | 2.3 | 0.2 |  |
| pixi mask 200 idle + Ticker.system stopped | 0.0 | – / – / – | – | – | 0.0 | 98.3 | 0.0 | 0.2 |  |
| canvas plain 200 no-desks | 60.0 | 2.10 / 3.40 / 6.10 | – | 202.0 | 45.2 | 112.2 | 24.0 | 0.3 |  |
| canvas tint 200 no-desks | 60.0 | 4.30 / 7.50 / 14.30 | – | 202.0 | 69.6 | 118.0 | 43.5 | 0.5 |  |
| canvas mask 200 no-desks | 57.6 | 6.90 / 9.70 / 22.50 | – | 402.0 | 96.9 | 124.5 | 54.8 | 0.3 |  |
| canvas mask 200 | 55.5 | 14.80 / 20.70 / 38.30 | – | 415.0 | 97.3 | 124.7 | 54.5 | 0.3 |  |
| canvas mask 5 | 60.0 | 0.80 / 2.00 / 3.10 | – | 25.0 | 23.9 | 107.6 | 17.5 | 0.3 |  |
| canvas mask 200 30fps | 30.0 | 14.90 / 18.30 / 28.00 | – | 415.0 | 55.9 | 114.2 | 31.6 | 0.4 |  |
| canvas mask 200 idle | 0.0 | – / – / – | – | – | 0.0 | 99.1 | 0.1 | 0.2 |  |
| pixi mask 200 desks as Graphics | 60.0 | 3.30 / 4.90 / 8.40 | 1.51 | 1.0 | 32.5 | 110.0 | 15.7 | 0.3 |  |

Canvas tinted copies after the mask case: 672 frames, 28.4 MB, 390 ms to build.

cacheAsTexture check (paused frames compared with the uncached reference; differing = any channel off by more than 8/255; order errors = differing pixels inside a solid differing area, not a 1-2 px resampled edge (a heuristic; check the diff PNGs); red in the cache-diff PNGs, edges in yellow):

| t | renderer | desks | vs | mean max-channel diff /255 | pixels differing % | order-error pixels |
|---:|---|---|---|---:|---:|---:|
| 4.2 | pixi | single | none | 0.341 | 0.43 | 1111 |
| 4.2 | pixi | bands | none | 0.073 | 0.21 | 0 |
| 4.2 | canvas | single | none | 0.352 | 0.60 | 1261 |
| 4.2 | canvas | bands | none | 0.161 | 0.61 | 14 |
| 4.2 | pixi vs canvas | none | canvas none | 0.612 | 2.38 | 10 |
| 9.7 | pixi | single | none | 0.392 | 0.46 | 1384 |
| 9.7 | pixi | bands | none | 0.070 | 0.21 | 0 |
| 9.7 | canvas | single | none | 0.404 | 0.63 | 1533 |
| 9.7 | canvas | bands | none | 0.166 | 0.63 | 13 |
| 9.7 | pixi vs canvas | none | canvas none | 0.599 | 2.34 | 11 |
| 15.1 | pixi | single | none | 0.434 | 0.51 | 1608 |
| 15.1 | pixi | bands | none | 0.072 | 0.22 | 0 |
| 15.1 | canvas | single | none | 0.445 | 0.68 | 1798 |
| 15.1 | canvas | bands | none | 0.165 | 0.62 | 18 |
| 15.1 | pixi vs canvas | none | canvas none | 0.601 | 2.34 | 13 |
