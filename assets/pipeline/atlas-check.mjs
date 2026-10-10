export function checkAtlases(atlases, render, directions, label = "atlas") {
  const pages = Array.isArray(atlases) ? atlases : [atlases];
  const problems = [];
  const expectedAnimations = Object.keys(render.animations ?? {});
  const expectedDirections = Object.keys(directions);
  const found = new Map();
  for (const [index, atlas] of pages.entries()) {
    const pageLabel = pages.length === 1 ? label : `${label}-${index}`;
    if (!atlas?.frames || !atlas.animations || atlas.meta?.scale !== 2) {
      problems.push(`${pageLabel}: not a Pixi v8 atlas with meta.scale 2`);
      continue;
    }
    for (const [name, frames] of Object.entries(atlas.animations)) {
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
      const variants = [name, ...(render.masks ?? []).map((mask) => `${name}-${mask}`)];
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
