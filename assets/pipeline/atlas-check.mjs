export function checkAtlases(atlases, render, directions, label = "atlas") {
  const pages = Array.isArray(atlases) ? atlases : [atlases];
  const problems = [];
  const expectedAnimations = Object.keys(render.animations ?? {});
  const expectedDirections = Object.keys(directions);
  const masks = Array.isArray(render.masks) ? render.masks : Object.keys(render.masks ?? {});
  const expectedClips = new Map();
  for (const [animation, details] of Object.entries(render.animations ?? {})) {
    const frames = details?.frames;
    if (!Array.isArray(frames) || frames.length !== 2 || !frames.every(Number.isInteger)
      || frames[0] > frames[1] || !["cycle", "pingpong"].includes(details.loop)) {
      continue; // Invalid animation entries are reported by manifest validation.
    }
    const indices = [];
    for (let index = 0; index <= frames[1] - frames[0]; index += 1) {
      indices.push(index);
    }
    if (details.loop === "pingpong") {
      for (let index = indices.length - 2; index > 0; index -= 1) {
        indices.push(index);
      }
    }
    for (const direction of expectedDirections) {
      const name = `${animation}/${direction}`;
      for (const mask of [null, ...masks]) {
        const suffix = mask === null ? "" : `-${mask}`;
        const sequence = indices.map((index) => `${name}/frame-${String(index).padStart(3, "0")}${suffix}`);
        expectedClips.set(`${name}${suffix}`, { sequence, fps: details.fps });
      }
    }
  }
  const found = new Map();
  for (const [index, atlas] of pages.entries()) {
    const pageLabel = pages.length === 1 ? label : `${label}-${index}`;
    if (!atlas?.frames || !atlas.animations || atlas.meta?.scale !== 2) {
      problems.push(`${pageLabel}: not a Pixi v8 atlas with meta.scale 2`);
      continue;
    }
    for (const [name, frames] of Object.entries(atlas.animations)) {
      const expected = expectedClips.get(name);
      if (expected) {
        if (!Array.isArray(frames) || frames.length !== expected.sequence.length
          || frames.some((frame, index) => frame !== expected.sequence[index])) {
          problems.push(`${pageLabel}: animation ${name} frame sequence must be ${JSON.stringify(expected.sequence)}; got ${JSON.stringify(frames)}`);
        }
        if (atlas.meta.fps?.[name] !== expected.fps) {
          problems.push(`${pageLabel}: animation ${name} meta.fps must be ${expected.fps}; got ${atlas.meta.fps?.[name]}`);
        }
      }
      if (!Array.isArray(frames) || frames.length === 0) {
        problems.push(`${pageLabel}: animation ${name} needs a list of frames`);
        continue;
      }
      for (const frame of frames) {
        if (!(frame in atlas.frames)) {
          problems.push(`${pageLabel}: animation ${name} names missing frame ${frame}`);
        }
      }
      found.set(name, [...(found.get(name) ?? []), pageLabel]);
    }
  }
  for (const animation of expectedAnimations) {
    for (const direction of expectedDirections) {
      const name = `${animation}/${direction}`;
      const variants = [name, ...masks.map((mask) => `${name}-${mask}`)];
      for (const variant of variants) {
        const pagesForAnimation = found.get(variant) ?? [];
        if (pagesForAnimation.length === 0) {
          problems.push(`${label}: missing animation ${variant}`);
        }
        if (pagesForAnimation.length > 1) {
          problems.push(`${label}: animation ${variant} is in more than one page`);
        }
      }
    }
  }
  return problems;
}
