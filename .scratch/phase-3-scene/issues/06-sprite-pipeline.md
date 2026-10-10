# 06: Sprite pipeline

**What to build:** Turn the 02 spike into maintained tooling, as ADR 0007 describes:
- an `assets/` directory with `.blend` sources under Git LFS
- shared settings for camera, lights, colour management and palette
- the render scripts on the engine chosen in 02, and the packer script
- one command (for example `pnpm assets:build`) that rebuilds every atlas and its frame data

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `.gitattributes` sends `.blend` files to Git LFS. Caches and temporary renders are ignored
- [ ] The build refuses any Blender except the pinned version and checksum, and documents installing it on Ubuntu, Xvfb and Mesa included
- [ ] Every asset directory needs a licence manifest (source, author, URL, licence, changes). The build fails without one, and a combined `NOTICE` is generated
- [ ] CC BY 4.0 licence file for the art, and a README note separating it from the MIT code
- [ ] Generated atlases are committed. A CI check (no Blender) verifies each manifest's animations exist in its atlas
- [ ] `smoke:pack` reports the npm tarball size, with a limit we choose
