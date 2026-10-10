# Renderer spike: desktop-hg8er1k-default-cpu1x

2026-10-10T16:27:44.591Z · win32-x64 · 16 x AMD Ryzen 7 8745H with Radeon 780M Graphics · 31 GB · Chrome 155.0.8059.40
GPU flag `default` → `ANGLE (NVIDIA, NVIDIA GeForce RTX 4050 Laptop GPU (0x000028E1) Direct3D11 vs_5_0 ps_5_0, D3D11)` · CPU throttle 1x · Pixi 8.21.0 · max batchable textures 16 · GPU timer EXT_disjoint_timer_query_webgl2

Window 10 s after 5 s warm-up, 1280×720, 1x device pixels. CPU columns are % of one core over the window. Canvas "draws" are 2D context calls (drawImage, fill, stroke, fillRect), not GPU draw calls.

| case | fps | frame ms p50 / p95 / max | GPU ms p50 | draws/frame | main thread % | renderer CPU % | GPU process CPU % | browser CPU % | errors |
|---|---:|---|---:|---:|---:|---:|---:|---:|---|
| pixi plain 200 no-desks | 60.0 | 0.40 / 0.80 / 2.50 | 0.14 | 1.0 | 6.6 | 12.8 | 17.3 | 14.8 |  |
| pixi tint 200 no-desks | 60.0 | 0.50 / 0.80 / 2.40 | 0.16 | 1.0 | 6.9 | 13.3 | 18.0 | 1.0 |  |
| pixi mask 200 no-desks | 60.0 | 0.50 / 0.90 / 1.80 | 0.18 | 1.0 | 7.3 | 13.8 | 17.9 | 0.6 |  |
| pixi filter 200 no-desks | 60.0 | 0.60 / 1.00 / 2.50 | 0.20 | 3.0 | 7.8 | 14.4 | 18.3 | 0.4 |  |
| pixi mask 200 | 60.0 | 0.70 / 1.00 / 2.00 | 0.19 | 2.0 | 8.0 | 14.7 | 18.6 | 0.4 |  |
| pixi mask 5 | 60.0 | 0.20 / 0.40 / 1.20 | 0.08 | 2.0 | 5.2 | 12.0 | 18.1 | 0.3 |  |
| pixi mask 200 30fps | 30.0 | 0.70 / 1.10 / 2.30 | 0.18 | 2.0 | 5.8 | 10.9 | 11.5 | 0.3 |  |
| pixi mask 200 idle | 0.0 | – / – / – | – | – | 3.0 | 6.7 | 4.0 | 0.4 |  |
| pixi mask 200 idle + Ticker.system stopped | 0.0 | – / – / – | – | – | 0.9 | 1.7 | 1.3 | 3.4 |  |
| canvas plain 200 no-desks | 60.0 | 0.30 / 0.50 / 0.90 | – | 202.0 | 7.7 | 12.2 | 18.2 | 0.9 |  |
| canvas tint 200 no-desks | 60.0 | 0.70 / 1.10 / 2.10 | – | 202.0 | 12.6 | 17.2 | 34.3 | 1.3 |  |
| canvas mask 200 no-desks | 60.0 | 0.80 / 1.30 / 2.20 | – | 402.0 | 15.1 | 18.8 | 37.4 | 0.2 |  |
| canvas mask 200 | 60.0 | 1.90 / 2.70 / 4.60 | – | 415.0 | 14.5 | 18.1 | 38.3 | 0.2 |  |
| canvas mask 5 | 60.0 | 0.10 / 0.30 / 0.80 | – | 25.0 | 4.2 | 8.1 | 13.9 | 0.3 |  |
| canvas mask 200 30fps | 30.0 | 2.10 / 2.80 / 3.90 | – | 415.0 | 8.9 | 12.1 | 22.2 | 0.3 |  |
| canvas mask 200 idle | 0.0 | – / – / – | – | – | 0.0 | 0.0 | 0.0 | 0.2 |  |
| pixi mask 200 desks as Graphics | 60.0 | 0.50 / 0.90 / 1.40 | 1.21 | 1.0 | 5.9 | 9.9 | 13.0 | 0.2 |  |

Canvas tinted copies after the mask case: 672 frames, 28.4 MB, 63 ms to build.

cacheAsTexture check (paused frames compared with the uncached reference; differing = any channel off by more than 8/255; order errors = differing pixels inside a solid differing area, not a 1-2 px resampled edge (a heuristic; check the diff PNGs); red in the cache-diff PNGs, edges in yellow):

| t | renderer | desks | vs | mean max-channel diff /255 | pixels differing % | order-error pixels |
|---:|---|---|---|---:|---:|---:|
| 4.2 | pixi | single | none | 0.341 | 0.43 | 1109 |
| 4.2 | pixi | bands | none | 0.073 | 0.21 | 0 |
| 4.2 | canvas | single | none | 0.352 | 0.60 | 1261 |
| 4.2 | canvas | bands | none | 0.161 | 0.61 | 12 |
| 4.2 | pixi vs canvas | none | canvas none | 0.611 | 2.38 | 10 |
| 9.7 | pixi | single | none | 0.392 | 0.46 | 1383 |
| 9.7 | pixi | bands | none | 0.070 | 0.21 | 0 |
| 9.7 | canvas | single | none | 0.404 | 0.63 | 1534 |
| 9.7 | canvas | bands | none | 0.166 | 0.63 | 13 |
| 9.7 | pixi vs canvas | none | canvas none | 0.599 | 2.34 | 11 |
| 15.1 | pixi | single | none | 0.434 | 0.51 | 1606 |
| 15.1 | pixi | bands | none | 0.072 | 0.22 | 0 |
| 15.1 | canvas | single | none | 0.445 | 0.68 | 1796 |
| 15.1 | canvas | bands | none | 0.166 | 0.62 | 16 |
| 15.1 | pixi vs canvas | none | canvas none | 0.600 | 2.34 | 13 |
