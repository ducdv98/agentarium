import { applyPatch, emptyWorld, visibleAgents, type WorldState } from "@agentarium/core";
import { layoutWorld, type Layout } from "./layout";
import { needsInputMarkers, type NeedsInputMarker, type RenderUpdate, type Renderer } from "./renderer";
import type { Animation, Theme } from "./theme";
import { dotGrid } from "./themes/dot-grid";

const CELL = 28;
const MARGIN = 24;
const HEADER = 28;
const RADIUS = 8;

/** Canvas 2D dot-grid renderer. Draws only while something animates or the state changed. */
export function createDotGridRenderer(initial: Theme = dotGrid): Renderer {
  let theme = initial;
  let world: WorldState = emptyWorld();
  let canvas: HTMLCanvasElement | null = null;
  let host: HTMLElement | null = null;
  let layout: Layout = { lanes: [], dots: [], cols: 0, rows: 0 };
  let markers: NeedsInputMarker[] = [];
  let frame = 0;

  const animated = (a: Animation): boolean => a === "pulse" || a === "blink";

  function relayout(): void {
    layout = layoutWorld(theme, world, visibleAgents(world));
    markers = needsInputMarkers(theme, world);
    schedule();
  }

  function schedule(): void {
    if (!canvas || frame) return;
    frame = requestAnimationFrame(draw);
  }

  function draw(now: number): void {
    frame = 0;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.fillStyle = theme.palette.background;
    ctx.fillRect(0, 0, w, h);

    const px = (col: number) => MARGIN + col * CELL + CELL / 2;
    const py = (row: number) => MARGIN + HEADER + row * CELL + CELL / 2;

    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = theme.palette.ink;
    ctx.textBaseline = "top";
    for (const lane of layout.lanes) ctx.fillText(lane.label, MARGIN + lane.col * CELL, MARGIN);

    // Spawn links first so dots draw over them.
    const pos = new Map(layout.dots.map((d) => [d.key, d]));
    ctx.strokeStyle = theme.palette.ink;
    ctx.globalAlpha = 0.25;
    for (const d of layout.dots) {
      const parent = d.agent.parent ? pos.get(d.agent.parent) : undefined;
      if (!parent) continue;
      ctx.beginPath();
      ctx.moveTo(px(d.col), py(d.row));
      ctx.lineTo(px(parent.col), py(parent.row));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const t = now / 1000;
    let animating = markers.length > 0;
    for (const d of layout.dots) {
      const { style } = d.resolved;
      let alpha = 1;
      if (style.animation === "blink") alpha = Math.sin(t * 6) > 0 ? 1 : 0.35;
      else if (style.animation === "fade") alpha = 0.5;
      else if (style.animation === "pulse") alpha = 0.7 + 0.3 * Math.sin(t * 4);
      animating ||= animated(style.animation);

      ctx.globalAlpha = alpha;
      ctx.fillStyle = style.color;
      ctx.beginPath();
      ctx.arc(px(d.col), py(d.row), RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    // Needs-input markers last and fully opaque, so no theme style can hide them.
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    for (const m of markers) {
      const d = pos.get(m.key);
      if (!d) continue;
      ctx.strokeStyle = m.color;
      ctx.beginPath();
      ctx.arc(px(d.col), py(d.row), RADIUS + 4 + 2 * Math.sin(t * 5), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    if (animating) schedule();
  }

  return {
    mount(element) {
      host = element;
      canvas = document.createElement("canvas");
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      element.appendChild(canvas);
      this.resize();
      relayout();
    },
    applyState(update: RenderUpdate) {
      world = update.kind === "snapshot" ? update.world : applyPatch(world, update.patch);
      relayout();
    },
    setTheme(next) {
      theme = next;
      relayout();
    },
    resize() {
      if (!canvas || !host) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(host.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(host.clientHeight * dpr));
      schedule();
    },
    markers() {
      return markers;
    },
    dispose() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      canvas?.remove();
      canvas = null;
      host = null;
    },
  };
}
