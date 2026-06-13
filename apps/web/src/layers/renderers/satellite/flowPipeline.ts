/** GPU pyramid optical-flow pipeline for satellite frame pairs.
 *
 * Replaces the single coarse-seed + same-resolution refinement in
 * satelliteComposite.ts with:
 *  - a true coarse-to-fine pyramid (levels capped at native resolution by
 *    flowPlan.pyramidLevelsFor, killing hallucinated fine-scale motion),
 *  - a confidence-weighted smoothing pass after each level,
 *  - forward-backward consistency at the finest level → occlusion mask,
 *  - a per-sequence clear-sky background composite + per-pair cloud mask so
 *    static terrain and lakes are never advected.
 *
 * Work is scheduled in an idle-priority queue: one pyramid level per pump(),
 * pairs ahead of the playhead first. Draw never waits for flow.
 */

import { Geometry, Model } from "@luma.gl/engine";
import type { Device, Framebuffer, Texture } from "@luma.gl/core";

import { logManager } from "../../../lib/logging";
import { pyramidLevelsFor } from "./flowPlan";

export const MAX_FLOW_UV = 0.25;

const FLOW_VS = `\
#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vUv = aPosition * 0.5 + 0.5;
}
`;

/** Lucas-Kanade refinement of an upsampled initial flow estimate.
 * Identical math to the proven satelliteComposite.ts pass, parameterized by
 * level texel size. Output: rg = encoded flow, b = confidence. */
const LK_FS = `\
#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uFlowPrevTex;
uniform sampler2D uFlowNextTex;
uniform sampler2D uInitialFlowTex;
uniform vec2 uTexelSize;
uniform float uFlowEncodeScale;
uniform float uHasInitialFlow;
uniform vec2 uGlobalInitialFlow;
uniform float uGlobalInitialConfidence;

vec4 safeSample(sampler2D tex, vec2 uv) {
  return texture(tex, clamp(uv, vec2(0.0), vec2(1.0)));
}

float lumaOf(vec3 rgb) {
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

float validSignal(vec4 texel) {
  float luma = lumaOf(texel.rgb);
  float chroma = max(max(texel.r, texel.g), texel.b) - min(min(texel.r, texel.g), texel.b);
  float visible = smoothstep(0.010, 0.045, luma) + smoothstep(0.012, 0.070, chroma);
  return texel.a * clamp(visible, 0.0, 1.0);
}

float lumaAt(sampler2D tex, vec2 uv) {
  return lumaOf(safeSample(tex, uv).rgb);
}

void main() {
  vec2 initialFlow = clamp(uGlobalInitialFlow, vec2(-uFlowEncodeScale), vec2(uFlowEncodeScale));
  float initialConfidence = clamp(uGlobalInitialConfidence, 0.0, 1.0) * 0.45;

  if (uHasInitialFlow > 0.5) {
    vec4 seed = safeSample(uInitialFlowTex, vUv);
    vec2 seedFlow = (seed.rg - vec2(0.5)) * (uFlowEncodeScale * 2.0);
    float seedConfidence = clamp(seed.b, 0.0, 1.0);
    float seedTrust = smoothstep(0.10, 0.50, seedConfidence);
    initialFlow = mix(initialFlow, seedFlow, seedTrust);
    initialConfidence = max(initialConfidence, seedConfidence * 0.85);
  }

  vec2 warpedPrevBase = vUv - initialFlow;

  float a00 = 0.0;
  float a01 = 0.0;
  float a11 = 0.0;
  float b0 = 0.0;
  float b1 = 0.0;
  float validitySum = 0.0;

  for (int y = -3; y <= 3; y++) {
    for (int x = -3; x <= 3; x++) {
      vec2 offset = vec2(float(x), float(y)) * uTexelSize;
      vec2 prevUv = warpedPrevBase + offset;
      vec2 nextUv = vUv + offset;
      vec4 prevTexel = safeSample(uFlowPrevTex, prevUv);
      vec4 nextTexel = safeSample(uFlowNextTex, nextUv);

      float radius2 = float(x * x + y * y);
      float gaussian = exp(-radius2 / 8.0);
      float validity = gaussian * min(validSignal(prevTexel), validSignal(nextTexel));

      float left = lumaAt(uFlowPrevTex, prevUv - vec2(uTexelSize.x, 0.0));
      float right = lumaAt(uFlowPrevTex, prevUv + vec2(uTexelSize.x, 0.0));
      float down = lumaAt(uFlowPrevTex, prevUv - vec2(0.0, uTexelSize.y));
      float up = lumaAt(uFlowPrevTex, prevUv + vec2(0.0, uTexelSize.y));

      float ix = (right - left) * 0.5;
      float iy = (up - down) * 0.5;
      float it = lumaOf(nextTexel.rgb) - lumaOf(prevTexel.rgb);

      float robust = inversesqrt(0.0004 + it * it);
      float w = validity * robust;

      a00 += ix * ix * w;
      a01 += ix * iy * w;
      a11 += iy * iy * w;
      b0 += -it * ix * w;
      b1 += -it * iy * w;
      validitySum += validity;
    }
  }

  float det = a00 * a11 - a01 * a01;
  float trace = a00 + a11;
  float cornerness = det / max(trace, 1e-6);

  float centerValidity = min(
    validSignal(safeSample(uFlowPrevTex, warpedPrevBase)),
    validSignal(safeSample(uFlowNextTex, vUv))
  );

  float confidence = centerValidity
    * smoothstep(0.0002, 0.012, trace)
    * smoothstep(0.000002, 0.00008, cornerness)
    * smoothstep(3.0, 18.0, validitySum)
    * step(0.0000005, abs(det));

  vec2 residualPx = vec2(0.0);
  if (confidence > 0.0) {
    residualPx = vec2((a11 * b0 - a01 * b1) / det, (-a01 * b0 + a00 * b1) / det);
  }

  vec2 residualUv = residualPx * uTexelSize;
  vec2 flowUv = clamp(initialFlow + residualUv, vec2(-uFlowEncodeScale), vec2(uFlowEncodeScale));

  if (uHasInitialFlow > 0.5 && initialConfidence > 0.25) {
    confidence = max(confidence, initialConfidence * 0.55);
  }

  if (confidence > 0.20) {
    float nextCenter = lumaAt(uFlowNextTex, vUv);
    float forwardError = abs(lumaAt(uFlowPrevTex, vUv - flowUv) - nextCenter);
    // GLSL smoothstep is undefined when edge0 >= edge1; explicit decreasing
    // trust curve keeps WebGL drivers in agreement on confidence gating.
    confidence *= 1.0 - smoothstep(0.018, 0.18, forwardError);
  }

  vec2 encoded = flowUv / (uFlowEncodeScale * 2.0) + vec2(0.5);
  fragColor = vec4(clamp(encoded, vec2(0.0), vec2(1.0)), clamp(confidence, 0.0, 1.0), 1.0);
}
`;

/** Confidence-weighted 3x3 vector smoothing. Removes residual swirl noise
 * that single-pixel LK estimates pick up from resampled imagery. */
const SMOOTH_FS = `\
#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uFlowTex;
uniform vec2 uTexelSize;
uniform float uFlowEncodeScale;

void main() {
  vec2 sum = vec2(0.0);
  float wsum = 0.0;
  float cmax = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec4 t = texture(uFlowTex, clamp(vUv + vec2(float(x), float(y)) * uTexelSize, vec2(0.0), vec2(1.0)));
      float c = t.b;
      if (c < 0.15) continue;
      vec2 f = (t.rg - vec2(0.5)) * (uFlowEncodeScale * 2.0);
      sum += f * c;
      wsum += c;
      cmax = max(cmax, c);
    }
  }
  vec2 smoothed = wsum > 1e-4 ? sum / wsum : vec2(0.0);
  fragColor = vec4(smoothed / (uFlowEncodeScale * 2.0) + vec2(0.5), cmax * 0.95, 1.0);
}
`;

/** Forward-backward consistency packed into the final flow texture.
 * rg: forward flow, b: min(fwd, bwd) confidence, a: occlusion (1 where the
 * two directions disagree → cloud forming/dissipating, must cross-dissolve
 * instead of warp). Packing keeps the composite shader at one flow sampler
 * per satellite slot. */
const CONSISTENCY_FS = `\
#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uForwardFlowTex;
uniform sampler2D uBackwardFlowTex;
uniform float uFlowEncodeScale;

void main() {
  vec4 fwd = texture(uForwardFlowTex, vUv);
  vec2 f = (fwd.rg - vec2(0.5)) * (uFlowEncodeScale * 2.0);
  vec4 bwd = texture(uBackwardFlowTex, clamp(vUv + f, vec2(0.0), vec2(1.0)));
  vec2 b = (bwd.rg - vec2(0.5)) * (uFlowEncodeScale * 2.0);

  float mismatch = length(f + b);
  float tolerance = max(0.01, 0.3 * length(f));
  float occlusion = smoothstep(tolerance, tolerance * 2.0, mismatch);
  fragColor = vec4(fwd.rg, min(fwd.b, bwd.b), occlusion);
}
`;

/** Clear-sky background accumulation.
 * Visible products (mode 0): temporal-minimum with slow decay — moving bright
 * clouds drop out, static terrain persists. IR products (mode 1): bounded-step
 * median approximation, since coldest-pixel-wins selects cloud tops, not
 * ground. */
const BACKGROUND_FS = `\
#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uBackgroundTex;
uniform sampler2D uFrameTex;
uniform float uHasBackground;
uniform float uBackgroundMode;

void main() {
  vec4 frame = texture(uFrameTex, vUv);
  if (uHasBackground < 0.5) {
    fragColor = frame;
    return;
  }
  vec4 bg = texture(uBackgroundTex, vUv);
  if (uBackgroundMode < 0.5) {
    vec3 darker = min(bg.rgb, frame.rgb);
    fragColor = vec4(mix(bg.rgb, darker, 0.7) + (frame.rgb - bg.rgb) * 0.02, max(bg.a, frame.a));
  } else {
    vec3 step = vec3(0.012);
    vec3 moved = bg.rgb + sign(frame.rgb - bg.rgb) * min(abs(frame.rgb - bg.rgb), step);
    fragColor = vec4(moved, max(bg.a, frame.a));
  }
}
`;

/** Background + cloud probability packed into one texture: rgb = clear-sky
 * background color (never advected — lakes and terrain stay pinned), a =
 * per-pixel cloud probability with hysteresis from the previous mask so
 * edges don't flicker frame to frame. */
const CLOUDMASK_FS = `\
#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uFrameTex;
uniform sampler2D uBackgroundTex;
uniform sampler2D uPrevMaskTex;
uniform float uHasPrevMask;

float lumaOf(vec3 rgb) {
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 frame = texture(uFrameTex, vUv);
  vec4 bg = texture(uBackgroundTex, vUv);
  float departure = abs(lumaOf(frame.rgb) - lumaOf(bg.rgb));
  float chroma = length(frame.rgb - bg.rgb);
  float raw = smoothstep(0.030, 0.085, max(departure, chroma * 0.6)) * frame.a;
  if (uHasPrevMask > 0.5) {
    float prev = texture(uPrevMaskTex, vUv).a;
    raw = max(raw, prev * 0.6 * frame.a);
  }
  fragColor = vec4(bg.rgb, raw);
}
`;

export const FLOW_SHADER_SOURCES = {
  FLOW_VS,
  LK_FS,
  SMOOTH_FS,
  CONSISTENCY_FS,
  BACKGROUND_FS,
  CLOUDMASK_FS,
} as const;

export interface FlowPairRequest {
  key: string;
  sequenceKey: string;
  prevTexture: Texture;
  nextTexture: Texture;
  prevTimeMs: number;
  nextTimeMs: number;
  /** Mercator width of the frame BBOX, for the native-resolution cap. */
  mercWidthM: number;
  /** Global motion seed [u, v, confidence]; zeros when not yet estimated. */
  globalFlow: [number, number, number];
  visibleProduct: boolean;
}

export interface FlowResult {
  /** rg = flow, b = confidence, a = forward-backward occlusion. */
  flowTexture: Texture;
  /** rgb = clear-sky background (static), a = cloud probability. Null until
   *  the sequence background has accumulated. */
  bgMaskTexture: Texture | null;
  confidence: number;
}

type PairStatus = "pending" | "computing" | "ready" | "failed";

interface RenderTarget {
  texture: Texture;
  framebuffer: Framebuffer;
  width: number;
  height: number;
}

interface PairState {
  request: FlowPairRequest;
  status: PairStatus;
  levels: number[];
  nextLevelIndex: number;
  /** Output of the last completed pyramid level (read-only seed for the next). */
  forward: RenderTarget | null;
  /** LK output before smoothing. */
  scratch: RenderTarget | null;
  /** Smoothing output; rotated into `forward` after each level so a pass never
   * samples the texture it renders into (WebGL feedback loop) and the seed is
   * never destroyed mid-level. */
  scratch2: RenderTarget | null;
  backward: RenderTarget | null;
  occlusion: RenderTarget | null;
  cloudMask: RenderTarget | null;
  lastError: string | null;
  /** True once a server-computed field replaced local estimation. */
  serverFieldAdopted?: boolean;
}

interface SequenceBackground {
  current: RenderTarget;
  scratch: RenderTarget;
  initialized: boolean;
  lastFrameTimeMs: number | null;
}

export interface FlowPassInvocation {
  kind: "lk" | "smooth" | "consistency" | "background" | "cloudmask";
  pairKey?: string;
  level?: number;
  backward?: boolean;
}

export class FlowPipeline {
  private pairs = new Map<string, PairState>();
  private backgrounds = new Map<string, SequenceBackground>();
  private models: Record<string, Model> | null = null;
  private modelsFailed = false;
  /** Test hook: invoked instead of GPU passes when provided. */
  private passRunner: ((invocation: FlowPassInvocation) => void) | null;

  constructor(
    private device: Device | null,
    opts: { passRunner?: (invocation: FlowPassInvocation) => void } = {},
  ) {
    this.passRunner = opts.passRunner ?? null;
  }

  schedule(requests: FlowPairRequest[], playheadMs: number): void {
    const wanted = new Set(requests.map((r) => r.key));
    for (const [key, state] of Array.from(this.pairs)) {
      if (!wanted.has(key) && state.status !== "ready") {
        this.destroyPair(state);
        this.pairs.delete(key);
      }
    }

    const ordered = [...requests].sort((a, b) => {
      const aAhead = a.prevTimeMs >= playheadMs ? 0 : 1;
      const bAhead = b.prevTimeMs >= playheadMs ? 0 : 1;
      if (aAhead !== bAhead) return aAhead - bAhead;
      return Math.abs(a.prevTimeMs - playheadMs) - Math.abs(b.prevTimeMs - playheadMs);
    });

    for (const request of ordered) {
      if (!this.pairs.has(request.key)) {
        this.pairs.set(request.key, {
          request,
          status: "pending",
          levels: pyramidLevelsFor({
            mercWidthM: request.mercWidthM,
            texWidthPx: request.nextTexture.width,
          }),
          nextLevelIndex: 0,
          forward: null,
          scratch: null,
          scratch2: null,
          backward: null,
          occlusion: null,
          cloudMask: null,
          lastError: null,
        });
      } else {
        // Refresh textures/seed; the GPU buffers stay valid.
        this.pairs.get(request.key)!.request = request;
      }
    }

    this.queueOrder = ordered.map((r) => r.key);
  }

  private queueOrder: string[] = [];

  /** Process one unit of work (one pyramid level or one post pass).
   * Returns true when work was done; callers keep pumping on idle. */
  pump(): boolean {
    const state = this.nextWorkItem();
    if (!state) return false;

    try {
      this.advance(state);
    } catch (err) {
      state.status = "failed";
      state.lastError = err instanceof Error ? err.message : String(err);
      this.destroyPair(state, { keepRecord: true });
      logManager.warn("satellite", "Dense optical-flow pass failed", { error: state.lastError });
    }
    return true;
  }

  private nextWorkItem(): PairState | null {
    for (const key of this.queueOrder) {
      const state = this.pairs.get(key);
      if (state && (state.status === "pending" || state.status === "computing")) return state;
    }
    return null;
  }

  private advance(state: PairState): void {
    state.status = "computing";
    const levels = state.levels;

    if (state.nextLevelIndex < levels.length) {
      const level = levels[state.nextLevelIndex];
      this.runLkAndSmooth(state, level, false);
      state.nextLevelIndex += 1;
      return;
    }

    if (state.nextLevelIndex === levels.length) {
      // Backward flow at the finest level only, then consistency.
      const finest = levels[levels.length - 1];
      this.runLkAndSmooth(state, finest, true);
      this.runConsistency(state, finest);
      state.nextLevelIndex += 1;
      return;
    }

    // Background + cloud mask, then done.
    this.updateBackgroundAndMask(state);
    state.status = "ready";
  }

  private runLkAndSmooth(state: PairState, level: number, backward: boolean): void {
    if (this.passRunner) {
      this.passRunner({ kind: "lk", pairKey: state.request.key, level, backward });
      this.passRunner({ kind: "smooth", pairKey: state.request.key, level, backward });
      return;
    }

    const models = this.ensureModels();
    if (!models || !this.device) throw new Error("Flow models unavailable");

    const aspect = state.request.nextTexture.height / Math.max(1, state.request.nextTexture.width);
    const w = level;
    const h = Math.max(16, Math.round(level * aspect));

    // Three-buffer rotation: the previous level's output stays alive as the
    // read-only seed while LK writes `scratch` and smoothing writes `scratch2`.
    // Sampling a texture bound to the active framebuffer is a WebGL feedback
    // loop, and destroying the seed mid-level binds a deleted object.
    const seed = backward ? null : state.forward;
    const lkOut = this.ensureTarget(state, "scratch", w, h);
    const smoothOut = this.ensureTarget(state, "scratch2", w, h);

    const prevTex = backward ? state.request.nextTexture : state.request.prevTexture;
    const nextTex = backward ? state.request.prevTexture : state.request.nextTexture;
    const [gu, gv, gc] = state.request.globalFlow;

    this.drawPass(models.lk, lkOut, {
      uTexelSize: [1 / w, 1 / h],
      uFlowEncodeScale: MAX_FLOW_UV,
      uHasInitialFlow: seed && !backward && state.nextLevelIndex > 0 ? 1 : 0,
      uGlobalInitialFlow: backward ? [-gu, -gv] : [gu, gv],
      uGlobalInitialConfidence: gc,
    }, {
      uFlowPrevTex: prevTex,
      uFlowNextTex: nextTex,
      uInitialFlowTex: seed?.texture ?? lkOut.texture,
    });

    this.drawPass(models.smooth, smoothOut, {
      uTexelSize: [1 / w, 1 / h],
      uFlowEncodeScale: MAX_FLOW_UV,
    }, {
      uFlowTex: lkOut.texture,
    });

    if (backward) {
      this.destroyTarget(state.backward);
      state.backward = smoothOut;
      state.scratch2 = null;
    } else {
      // Rotate: smoothed output becomes the new forward; the old forward is
      // recycled as next level's scratch2 (resized by ensureTarget).
      const oldForward = state.forward;
      state.forward = smoothOut;
      state.scratch2 = oldForward;
    }
  }

  private runConsistency(state: PairState, level: number): void {
    if (this.passRunner) {
      this.passRunner({ kind: "consistency", pairKey: state.request.key, level });
      return;
    }
    const models = this.ensureModels();
    if (!models || !state.forward || !state.backward) throw new Error("Consistency inputs missing");

    const target = this.ensureTarget(state, "occlusion", state.forward.width, state.forward.height);
    this.drawPass(models.consistency, target, {
      uFlowEncodeScale: MAX_FLOW_UV,
    }, {
      uForwardFlowTex: state.forward.texture,
      uBackwardFlowTex: state.backward.texture,
    });
  }

  private updateBackgroundAndMask(state: PairState): void {
    if (this.passRunner) {
      this.passRunner({ kind: "background", pairKey: state.request.key });
      this.passRunner({ kind: "cloudmask", pairKey: state.request.key });
      return;
    }
    const models = this.ensureModels();
    if (!models || !this.device) throw new Error("Flow models unavailable");

    const request = state.request;
    const bgW = 256;
    const bgH = Math.max(16, Math.round(256 * (request.nextTexture.height / Math.max(1, request.nextTexture.width))));
    let bg = this.backgrounds.get(request.sequenceKey);
    if (!bg) {
      bg = {
        current: this.createTarget(bgW, bgH),
        scratch: this.createTarget(bgW, bgH),
        initialized: false,
        lastFrameTimeMs: null,
      };
      this.backgrounds.set(request.sequenceKey, bg);
    }

    // Fold the pair's next frame into the running background (skip if this
    // frame time was already folded in).
    if (bg.lastFrameTimeMs !== request.nextTimeMs) {
      this.drawPass(models.background, bg.scratch, {
        uHasBackground: bg.initialized ? 1 : 0,
        uBackgroundMode: request.visibleProduct ? 0 : 1,
      }, {
        uBackgroundTex: bg.current.texture,
        uFrameTex: request.nextTexture,
      });
      const swap = bg.current;
      bg.current = bg.scratch;
      bg.scratch = swap;
      bg.initialized = true;
      bg.lastFrameTimeMs = request.nextTimeMs;
    }

    const mask = this.ensureTarget(state, "cloudMask", bgW, bgH);
    this.drawPass(models.cloudmask, mask, {
      uHasPrevMask: 0,
    }, {
      uFrameTex: request.nextTexture,
      uBackgroundTex: bg.current.texture,
      uPrevMaskTex: bg.current.texture,
    });
  }

  /** Install a server-computed motion field for a pair. Server fields are
   * authoritative (IR-derived, native-grid, computed once): they mark the
   * pair ready immediately and any queued GPU passes for it are skipped.
   * Local cloud-mask/background passes still run via the normal queue. */
  adoptServerField(pairKey: string, field: { width: number; height: number; data: Uint8Array }): boolean {
    const state = this.pairs.get(pairKey);
    if (!state || !this.device) return false;
    if (state.serverFieldAdopted) return true;

    try {
      const texture = this.device.createTexture({
        data: field.data,
        width: field.width,
        height: field.height,
        format: "rgba8unorm" as never,
        sampler: {
          minFilter: "linear" as never,
          magFilter: "linear" as never,
          addressModeU: "clamp-to-edge" as never,
          addressModeV: "clamp-to-edge" as never,
        },
      });
      // Replace whatever the GPU pipeline produced; the packed final lives in
      // the occlusion slot (see get()).
      this.destroyTarget(state.occlusion);
      this.destroyTarget(state.forward);
      this.destroyTarget(state.backward);
      state.forward = null;
      state.backward = null;
      state.occlusion = {
        texture,
        framebuffer: null as never,
        width: field.width,
        height: field.height,
      };
      state.serverFieldAdopted = true;
      // Run only the cheap background/cloud-mask tail if it hasn't happened.
      if (state.status !== "ready") {
        state.nextLevelIndex = state.levels.length + 1;
        state.status = "computing";
      }
      // Probe/vector read-back comes free: the server bytes ARE the field.
      this.readbackCache.set(pairKey, { data: field.data, cloud: null });
      return true;
    } catch (err) {
      logManager.warn("satellite", "Server motion field adoption failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  isReady(pairKey: string): boolean {
    return this.pairs.get(pairKey)?.status === "ready";
  }

  status(pairKey: string): PairStatus | null {
    return this.pairs.get(pairKey)?.status ?? null;
  }

  /** True once a server-computed motion field replaced local estimation. */
  isServerField(pairKey: string): boolean {
    return this.pairs.get(pairKey)?.serverFieldAdopted === true;
  }

  get(pairKey: string): FlowResult | null {
    const state = this.pairs.get(pairKey);
    if (!state || state.status !== "ready") return null;
    // Occlusion target holds the final packed flow (rg flow, b conf, a occl);
    // fall back to the forward target if consistency never ran.
    const flow = state.occlusion ?? state.forward;
    if (!flow) return null;
    return {
      flowTexture: flow.texture,
      bgMaskTexture: state.cloudMask?.texture ?? null,
      confidence: state.request.globalFlow[2],
    };
  }

  hasPendingWork(): boolean {
    return this.nextWorkItem() !== null;
  }

  private readbackCache = new Map<string, { data: Uint8Array; cloud: Uint8Array | null }>();
  private readbackFailed = false;

  /** CPU read-back of a ready pair's packed flow + bgMask pixels, cached per
   * pair. Raw GL path: luma v9 exposes no readPixels helper, but the WebGL
   * device and framebuffers expose their native handles. */
  readMotionPixels(pairKey: string): {
    width: number;
    height: number;
    data: Uint8Array;
    cloud: Uint8Array | null;
    cloudWidth: number;
    cloudHeight: number;
  } | null {
    const state = this.pairs.get(pairKey);
    if (!state || state.status !== "ready") return null;
    const flow = state.occlusion ?? state.forward;
    if (!flow) return null;

    const cached = this.readbackCache.get(pairKey);
    if (cached) {
      return {
        width: flow.width,
        height: flow.height,
        data: cached.data,
        cloud: cached.cloud,
        cloudWidth: state.cloudMask?.width ?? flow.width,
        cloudHeight: state.cloudMask?.height ?? flow.height,
      };
    }

    if (this.readbackFailed) return null;
    const gl = (this.device as unknown as { gl?: WebGL2RenderingContext })?.gl;
    if (!gl) return null;

    const read = (target: RenderTarget): Uint8Array | null => {
      const handle = (target.framebuffer as unknown as { handle?: WebGLFramebuffer }).handle;
      if (!handle) return null;
      const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, handle);
        const out = new Uint8Array(target.width * target.height * 4);
        gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
        return out;
      } catch (err) {
        this.readbackFailed = true;
        logManager.warn("satellite", "Flow field read-back failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
      }
    };

    const data = read(flow);
    if (!data) return null;
    const cloud = state.cloudMask ? read(state.cloudMask) : null;

    this.readbackCache.set(pairKey, { data, cloud });
    if (this.readbackCache.size > 24) {
      const first = this.readbackCache.keys().next().value;
      if (first !== undefined) this.readbackCache.delete(first);
    }

    return {
      width: flow.width,
      height: flow.height,
      data,
      cloud,
      cloudWidth: state.cloudMask?.width ?? flow.width,
      cloudHeight: state.cloudMask?.height ?? flow.height,
    };
  }

  prune(keepPairKeys: Set<string>, keepSequenceKeys: Set<string>): void {
    for (const [key, state] of Array.from(this.pairs)) {
      if (!keepPairKeys.has(key)) {
        this.destroyPair(state);
        this.pairs.delete(key);
        this.readbackCache.delete(key);
      }
    }
    for (const [key, bg] of Array.from(this.backgrounds)) {
      if (!keepSequenceKeys.has(key)) {
        this.destroyTarget(bg.current);
        this.destroyTarget(bg.scratch);
        this.backgrounds.delete(key);
      }
    }
  }

  destroy(): void {
    this.prune(new Set(), new Set());
    if (this.models) {
      for (const model of Object.values(this.models)) model.destroy();
      this.models = null;
    }
  }

  // ── GPU plumbing ────────────────────────────────────────────────────────

  private ensureModels(): Record<string, Model> | null {
    if (this.models) return this.models;
    if (this.modelsFailed || !this.device) return null;

    try {
      const make = (id: string, fs: string) =>
        new Model(this.device!, {
          id: `satellite-flow-${id}`,
          vs: FLOW_VS,
          fs,
          topology: "triangle-strip" as never,
          vertexCount: 4,
          geometry: new Geometry({
            topology: "triangle-strip",
            vertexCount: 4,
            attributes: {
              aPosition: { size: 2, value: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) },
            },
          }),
          parameters: { depthWriteEnabled: false } as never,
        });

      this.models = {
        lk: make("lk", LK_FS),
        smooth: make("smooth", SMOOTH_FS),
        consistency: make("consistency", CONSISTENCY_FS),
        background: make("background", BACKGROUND_FS),
        cloudmask: make("cloudmask", CLOUDMASK_FS),
      };
      return this.models;
    } catch (err) {
      this.modelsFailed = true;
      logManager.warn("satellite", "Flow pipeline shaders failed to compile; global flow only", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private createTarget(width: number, height: number): RenderTarget {
    const texture = this.device!.createTexture({
      width,
      height,
      format: "rgba8unorm" as never,
      sampler: {
        minFilter: "linear" as never,
        magFilter: "linear" as never,
        addressModeU: "clamp-to-edge" as never,
        addressModeV: "clamp-to-edge" as never,
      },
    });
    const framebuffer = this.device!.createFramebuffer({ colorAttachments: [texture] });
    return { texture, framebuffer, width, height };
  }

  private destroyTarget(target: RenderTarget | null): void {
    // Server-adopted fields are texture-only (no framebuffer).
    target?.framebuffer?.destroy();
    target?.texture.destroy();
  }

  private ensureTarget(
    state: PairState,
    slot: "forward" | "scratch" | "scratch2" | "backward" | "occlusion" | "cloudMask",
    width: number,
    height: number,
  ): RenderTarget {
    const existing = state[slot];
    if (existing && existing.width === width && existing.height === height) return existing;
    this.destroyTarget(existing);
    const target = this.createTarget(width, height);
    state[slot] = target;
    return target;
  }

  private drawPass(
    model: Model,
    target: RenderTarget,
    uniforms: Record<string, unknown>,
    bindings: Record<string, Texture>,
  ): void {
    (model as never as { setUniforms?: (u: Record<string, unknown>) => void }).setUniforms?.(uniforms);
    model.setBindings(bindings as never);

    const encoder = this.device!.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      framebuffer: target.framebuffer,
      clearColor: [0.5, 0.5, 0, 1],
      parameters: {
        viewport: [0, 0, target.width, target.height],
        depthTest: false,
      } as never,
    });
    model.draw(pass);
    pass.end();
    this.device!.submit(encoder.finish());
  }

  private destroyPair(state: PairState, opts: { keepRecord?: boolean } = {}): void {
    this.destroyTarget(state.forward);
    this.destroyTarget(state.scratch);
    this.destroyTarget(state.scratch2);
    this.destroyTarget(state.backward);
    this.destroyTarget(state.occlusion);
    this.destroyTarget(state.cloudMask);
    state.forward = null;
    state.scratch = null;
    state.scratch2 = null;
    state.backward = null;
    state.occlusion = null;
    state.cloudMask = null;
    if (!opts.keepRecord) state.lastError = null;
  }
}
