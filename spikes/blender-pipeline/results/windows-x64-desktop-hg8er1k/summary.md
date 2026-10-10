# Blender pipeline spike: windows-x64-desktop-hg8er1k

2026-10-10T15:55:28.535Z · win32-x64 · 16 x AMD Ryzen 7 8745H with Radeon 780M Graphics · 31 GB RAM

| run | Blender | pinned | GL | beauty s/frame (mean, max) | mask s/frame | wall s | peak MB (in-process / process tree, sampled) |
|---|---|---|---|---|---|---|---|
| cycles | 5.2.2 LTS d13f752e3b9c | yes | GPU functions for drawing requires the gpu module to be initialized. See gpu.init. | 1.61, 2.058 | 1.169 | 333 | 0 / 636 |
| desktop-cycles | 5.2.2 LTS d13f752e3b9c | yes | NVIDIA GeForce RTX 4050 Laptop GPU/PCIe/SSE2 | 1.603, 1.808 | 1.228 | 38 | 0 / 802 |
| desktop-eevee | 5.2.2 LTS d13f752e3b9c | yes | NVIDIA GeForce RTX 4050 Laptop GPU/PCIe/SSE2 | 0.446, 0.928 | 0.341 | 264 | 0 / 780 |
| eevee | 5.2.2 LTS d13f752e3b9c | yes | NVIDIA GeForce RTX 4050 Laptop GPU/PCIe/SSE2 | 0.368, 2.153 | 0.343 | 99 | 0 / 779 |

Match = no visible difference: mean <= 1 and p99 <= 8 (0-255). EEVEE vs Cycles is informational only (Cycles has no toon shading).

| compare | layer | frames | mean diff /255 | worst p99 /255 | match | problems |
|---|---|---|---|---|---|---|
| out\eevee vs out\desktop-eevee | beauty | 7 | 0 | 0 | yes |  |
| out\eevee vs out\desktop-eevee | mask | 7 | 0 | 0 | yes |  |
| out\cycles vs out\desktop-cycles | beauty | 7 | 0 | 0 | yes |  |
| out\cycles vs out\desktop-cycles | mask | 7 | 0 | 0 | yes |  |
| out\eevee vs out\cycles | beauty | 112 | 74.77 | 175 | **no** |  |
| out\eevee vs out\cycles | mask | 112 | 0.75 | 13 | **no** |  |
