import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { MaxRectsPacker } from "maxrects-packer/dist/maxrects-packer.mjs";

export function toLinear(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function toSrgb(value) {
  const clamped = Math.min(1, Math.max(0, value));
  const channel = clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(channel * 255);
}

/** Crop transparent pixels while retaining original source dimensions. */
export function trimPng(png) {
  let left = png.width;
  let top = png.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (png.data[(y * png.width + x) * 4 + 3] === 0) {
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) {
    return { png: new PNG({ width: 1, height: 1 }), x: 0, y: 0, width: 1, height: 1 };
  }
  const result = new PNG({ width: right - left + 1, height: bottom - top + 1 });
  PNG.bitblt(png, result, left, top, result.width, result.height, 0, 0);
  return { png: result, x: left, y: top, width: result.width, height: result.height };
}

/** Derive a tint layer from beauty colour and a linear-light mask. */
export function deriveMaskFrame(beauty, mask, neutral) {
  const result = new PNG({ width: beauty.width, height: beauty.height });
  for (let i = 0; i < beauty.data.length; i += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      result.data[i + channel] = toSrgb(toLinear(beauty.data[i + channel]) / neutral[channel]);
    }
    const luminance = 0.2126 * toLinear(mask.data[i])
      + 0.7152 * toLinear(mask.data[i + 1])
      + 0.0722 * toLinear(mask.data[i + 2]);
    result.data[i + 3] = Math.round(luminance * mask.data[i + 3]);
  }
  return result;
}

function frameKey(png) {
  return createHash("sha256").update(PNG.sync.write(png)).digest("hex");
}

function addFrame(state, name, png, anchor) {
  const trimmed = trimPng(png);
  const key = frameKey(trimmed.png);
  let image = state.images.get(key);
  if (!image) {
    image = { key, png: trimmed.png };
    state.images.set(key, image);
  }
  return (state.frames[name] = {
    image,
    rotated: false,
    trimmed: true,
    spriteSourceSize: { x: trimmed.x, y: trimmed.y, w: trimmed.width, h: trimmed.height },
    sourceSize: { w: png.width, h: png.height },
    anchor,
  });
}

function packImages(images, maxSize, padding) {
  const packer = new MaxRectsPacker(maxSize, maxSize, padding, {
    smart: true,
    pot: false,
    square: false,
    border: 0,
    allowRotation: false,
  });
  for (const image of images) {
    packer.add({ width: image.png.width, height: image.png.height, name: image.key, image, hash: image.key });
  }
  return (packer.bins ?? []).map((bin) => {
    const width = Math.max(1, ...bin.rects.map((rect) => rect.x + rect.width));
    const height = Math.max(1, ...bin.rects.map((rect) => rect.y + rect.height));
    const png = new PNG({ width, height });
    for (const rect of bin.rects) {
      PNG.bitblt(rect.image.png, png, 0, 0, rect.image.png.width, rect.image.png.height, rect.x, rect.y);
      rect.image.frame = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    }
    return { png, images: bin.rects.map((rect) => rect.image) };
  });
}

function readInput(input, objectField, bytesField) {
  return input[objectField] ?? PNG.sync.read(input[bytesField]);
}

function buildClips(clips, masks, state, anchor) {
  const animations = {};
  const groups = [];
  for (const clip of [...clips].sort((a, b) => a.name.localeCompare(b.name))) {
    const group = new Set();
    const beautyNames = [];
    const maskNames = Object.fromEntries(masks.map((mask) => [mask, []]));
    for (const input of clip.frames) {
      const beauty = readInput(input, "beauty", "beautyBytes");
      const baseName = `${clip.name}/frame-${String(input.frame).padStart(3, "0")}`;
      const beautyFrame = addFrame(state, baseName, beauty, anchor);
      beautyNames.push(baseName);
      group.add(beautyFrame.image);
      for (const mask of masks) {
        const maskInput = input.masks?.[mask] ?? input.mask?.[mask] ?? input.maskBytes?.[mask];
        if (!maskInput) {
          throw new Error(`Missing ${mask} frame for ${baseName}`);
        }
        const maskPng = Buffer.isBuffer(maskInput) ? PNG.sync.read(maskInput) : maskInput;
        const derived = deriveMaskFrame(beauty, maskPng, state.neutral);
        const name = `${baseName}-${mask}`;
        const maskFrame = addFrame(state, name, derived, anchor);
        maskNames[mask].push(name);
        group.add(maskFrame.image);
      }
    }
    animations[clip.name] = beautyNames;
    for (const mask of masks) {
      animations[`${clip.name}-${mask}`] = maskNames[mask];
    }
    groups.push([...group]);
  }
  return { animations, groups };
}

/** Pack clips without deleting unrelated files in the output directory. */
export function packFrames({
  clips,
  outputDir,
  atlas,
  frameSize = [160, 208],
  anchor = [80, 184],
  scale = 2,
  neutral = [0.8, 0.8, 0.8],
  masks = [],
  maxSize = 4096,
  padding = 2,
}) {
  mkdirSync(outputDir, { recursive: true });
  const state = { frames: {}, images: new Map(), neutral };
  const { animations, groups } = buildClips(clips, masks, state, {
    x: anchor[0] / frameSize[0],
    y: anchor[1] / frameSize[1],
  });
  const pages = [];
  let pending = [];
  for (const group of groups) {
    const candidate = packImages([...new Set([...pending, ...group])], maxSize, padding);
    const groupPages = packImages(group, maxSize, padding);
    if (groupPages.length > 1) {
      throw new Error("A clip is too large to fit on one atlas page.");
    }
    if (candidate.length > 1 && pending.length) {
      pages.push(packImages(pending, maxSize, padding)[0]);
      pending = group;
    } else {
      pending = [...new Set([...pending, ...group])];
    }
  }
  if (pending.length) {
    pages.push(...packImages(pending, maxSize, padding));
  }
  if (!pages.length) {
    pages.push({ png: new PNG({ width: 1, height: 1 }), images: [] });
  }

  const imagePage = new Map();
  pages.forEach((page, index) => {
    for (const image of page.images) {
      imagePage.set(image, index);
    }
  });
  pages.forEach((page, index) => {
    const suffix = pages.length === 1 ? "" : `-${index}`;
    const imageName = `${atlas}${suffix}.png`;
    const jsonName = `${atlas}${suffix}.json`;
    const pageFrames = {};
    for (const [name, frame] of Object.entries(state.frames)) {
      if (imagePage.get(frame.image) !== index) {
        continue;
      }
      pageFrames[name] = { ...frame, frame: frame.image.frame };
      delete pageFrames[name].image;
    }
    const pageAnimations = {};
    for (const [name, frameNames] of Object.entries(animations)) {
      const names = frameNames.filter((frameName) => frameName in pageFrames);
      if (names.length) {
        pageAnimations[name] = names;
      }
    }
    const sheet = {
      frames: pageFrames,
      animations: pageAnimations,
      meta: {
        image: imageName,
        format: "RGBA8888",
        size: { w: page.png.width, h: page.png.height },
        scale,
        app: "agentarium assets pipeline",
      },
    };
    writeFileSync(join(outputDir, imageName), PNG.sync.write(page.png));
    writeFileSync(join(outputDir, jsonName), `${JSON.stringify(sheet, null, 1)}\n`);
  });
  return pages.map((_, index) => `${atlas}${pages.length === 1 ? "" : `-${index}`}.json`);
}

function frameFiles(renderDir, layer, animation, direction, expected) {
  const directory = join(renderDir, "frames", layer, animation, direction);
  const files = [];
  for (let index = 0; index < expected; index += 1) {
    const file = join(directory, `frame-${String(index).padStart(3, "0")}.png`);
    if (!existsSync(file)) {
      throw new Error(`Missing render frame ${file}`);
    }
    files.push(file);
  }
  return files;
}

export function packRender(renderDir, outputDir, manifest, settings) {
  const meta = JSON.parse(readFileSync(join(renderDir, "render-log.json"), "utf8")).meta;
  const masks = meta.masks ?? [];
  const clips = [];
  for (const [animation, details] of Object.entries(meta.animations)) {
    for (const direction of meta.dirs) {
      const beautyFiles = frameFiles(renderDir, "beauty", animation, direction, details.frames);
      const frames = beautyFiles.map((beautyFile, index) => {
        const input = { frame: index, beautyBytes: readFileSync(beautyFile), masks: {} };
        for (const mask of masks) {
          const files = frameFiles(renderDir, `mask-${mask}`, animation, direction, details.frames);
          input.masks[mask] = PNG.sync.read(readFileSync(files[index]));
        }
        return input;
      });
      clips.push({ name: `${animation}/${direction}`, frames });
    }
  }
  return packFrames({
    clips,
    outputDir,
    atlas: manifest.render.atlas,
    frameSize: meta.frame_1x,
    anchor: meta.anchor_1x,
    scale: meta.scale,
    neutral: meta.neutral_tint,
    masks,
    maxSize: settings.packing.maxSize,
    padding: settings.packing.padding,
  });
}
