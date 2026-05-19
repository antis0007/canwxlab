# Satellite Optical-Flow Rendering Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-frame satellite texture destruction with a dual-texture optical-flow morphing pipeline that advects cloud pixels between discrete WMS frames, producing seamless animation with zero fade-to-black.

**Architecture:** The `SatelliteCompositeLayer` custom deck.gl layer gets a temporal dimension: each satellite entry now holds prev + next textures, an optical-flow FBO computes motion vectors at 1/4 resolution, and the main compositor shader advects previous-frame pixels toward next-frame positions using the flow field before cross-dissolving. Satellite WMS fetches are staggered and retried. WMS crossfade duration is minimized.

**Tech Stack:** TypeScript, deck.gl custom Layer, luma.gl Model/Texture/FBO, WebGL2 GLSL 3.00 ES, MapLibre GL JS

---

## File Structure

| File | Responsibility |
|------|---------------|
| `apps/web/src/layers/renderers/satelliteComposite.ts` | Dual-texture state, optical flow FBO + shaders, advected morph compositor, retry/stagger fetch logic |
| `apps/web/src/layers/renderers/maplibreRaster.ts` | Reduce WMS raster crossfade from 120ms to 50ms for non-satellite layers |
| `apps/web/src/components/MapView.tsx` | Wire `subFrameProgress` into satellite compositor via `setProps` (time progress uniform) |

---

### Task 1: Extend SatelliteComposite types for dual-texture + flow state

**Files:**
- Modify: `apps/web/src/layers/renderers/satelliteComposite.ts` (lines 39-58)

- [ ] **Step 1: Update SatEntry and CompositorState interfaces**

Replace the current `SatEntry` and `CompositorState` interfaces:

```typescript
interface SatEntry {
  config: SatelliteCompositeConfig;
  prevTexture: Texture | null;       // frame N
  nextTexture: Texture | null;       // frame N+1 (current target)
  prevMercBounds: [number, number, number, number] | null;
  nextMercBounds: [number, number, number, number] | null;
  flowTexture: Texture | null;       // optical flow field (RG = dx,dy; B = confidence)
  flowFbo: any | null;              // luma.gl Framebuffer for flow pass
  loadError: boolean;
  loading: boolean;
  abortController: AbortController | null;
  retryCount: number;
  retryTimeout: ReturnType<typeof setTimeout> | null;
}

interface CompositorState {
  model: Model | null;              // main compositor model
  flowModel: Model | null;          // optical flow computation model
  entries: SatEntry[];
  fallbackTexture: Texture | null;
  device: Device | null;
  lastFetchMercBounds: [number, number, number, number] | null;
  anyTextureLoaded: boolean;
  uniforms: Record<string, unknown> | null;
  flowUniforms: Record<string, unknown> | null;
  /** 0→1 progress from current frame toward next. Driven by subFrameProgress. */
  timeProgress: number;
}
```

### Task 2: Write the optical flow GLSL shaders

**Files:**
- Modify: `apps/web/src/layers/renderers/satelliteComposite.ts` (shader constants)

- [ ] **Step 1: Add optical flow vertex + fragment shaders**

Add these shader constants after the existing `VS`/`FS` (after line 207):

```glsl
const FLOW_VS = `\
#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vUv = aPosition * 0.5 + 0.5;
}
`;

const FLOW_FS = `\
#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPrevTex;
uniform sampler2D uNextTex;
uniform vec2 uTexSize;       // texture dimensions in pixels
uniform float uTimeProgress; // 0→1, for confidence weighting

const float SOBEL_KERNEL = 0.5;

void main() {
  vec2 px = 1.0 / uTexSize;

  // Luminance from RGB (BT.709)
  float luma(vec4 c) {
    return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  }

  // Spatial gradients via central differences on prev frame
  float l00 = luma(texture(uPrevTex, vUv + vec2(-px.x, -px.y)));
  float l10 = luma(texture(uPrevTex, vUv + vec2( px.x, -px.y)));
  float l01 = luma(texture(uPrevTex, vUv + vec2(-px.x,  px.y)));
  float l11 = luma(texture(uPrevTex, vUv + vec2( px.x,  px.y)));
  float lc  = luma(texture(uPrevTex, vUv));

  float Ix = (l10 - l00 + l11 - l01) * 0.25;
  float Iy = (l01 - l00 + l11 - l10) * 0.25;

  // Temporal gradient
  float It = luma(texture(uNextTex, vUv)) - lc;

  // Lucas-Kanade in a single pixel (degenerate to gradient descent step)
  // For 5×5 window we'd need multiple texture samples; single-pixel is
  // adequate for smooth cloud fields with our coarse resolution.
  float Ix2 = Ix * Ix;
  float Iy2 = Iy * Iy;
  float IxIy = Ix * Iy;
  float det = Ix2 * Iy2 - IxIy * IxIy;

  vec2 flow = vec2(0.0);
  float confidence = 0.0;

  if (det > 1e-6) {
    // ATA = [[Ix2, IxIy], [IxIy, Iy2]]
    // (ATA)^-1 = 1/det * [[Iy2, -IxIy], [-IxIy, Ix2]]
    // ATb = [Ix*It, Iy*It]
    float invDet = 1.0 / det;
    flow.x = -(Iy2 * Ix * It - IxIy * Iy * It) * invDet;
    flow.y = -(-IxIy * Ix * It + Ix2 * Iy * It) * invDet;
    // Clamp flow magnitude to reasonable range (max 5% of texture)
    float maxFlow = 0.05;
    float mag = length(flow);
    if (mag > maxFlow) flow *= maxFlow / mag;
    confidence = clamp(1.0 / (1.0 + abs(It) * 5.0), 0.0, 1.0);
  }

  // Scale flow from pixel space to UV space
  flow *= uTexSize;
  fragColor = vec4(flow * 0.05 + 0.5, confidence, 1.0);
  // Decode: actual flow = (fragColor.rg - 0.5) * 20.0 in UV space
}
`;
```

Since single-pixel Lucas-Kanade is too noisy, we'll use a **5×5 windowed LK** instead. Here's the robust version:

```glsl
const FLOW_FS_5X5 = `\
#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPrevTex;
uniform sampler2D uNextTex;
uniform vec2 uTexSize;

float luma(vec4 c) {
  return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 px = 1.0 / uTexSize;

  // Accumulate ATA and ATb over 5x5 window
  float A11 = 0.0, A12 = 0.0, A22 = 0.0;
  float b1 = 0.0, b2 = 0.0;

  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      vec2 off = vec2(float(dx), float(dy)) * px;
      vec2 uvSample = vUv + off;

      float lc  = luma(texture(uPrevTex, uvSample));
      float lxp = luma(texture(uPrevTex, uvSample + vec2(px.x, 0.0)));
      float lxm = luma(texture(uPrevTex, uvSample - vec2(px.x, 0.0)));
      float lyp = luma(texture(uPrevTex, uvSample + vec2(0.0, px.y)));
      float lym = luma(texture(uPrevTex, uvSample - vec2(0.0, px.y)));

      float Ix = (lxp - lxm) * 0.5;
      float Iy = (lyp - lym) * 0.5;
      float It = luma(texture(uNextTex, uvSample)) - lc;

      A11 += Ix * Ix;
      A12 += Ix * Iy;
      A22 += Iy * Iy;
      b1  += Ix * It;
      b2  += Iy * It;
    }
  }

  float det = A11 * A22 - A12 * A12;
  vec2 flow = vec2(0.0);
  float confidence = 0.0;

  if (det > 1e-5) {
    float invDet = 1.0 / det;
    flow.x = -(A22 * b1 - A12 * b2) * invDet;
    flow.y = -(-A12 * b1 + A11 * b2) * invDet;
    // Clamp to 8% of texture dimension
    float maxFlow = 0.08;
    float mag = length(flow);
    if (mag > maxFlow) flow *= maxFlow / mag;
    // Confidence: high when temporal gradient is consistent with spatial structure
    float trace = A11 + A22;
    confidence = clamp(trace / (trace + 0.01), 0.0, 1.0);
  }

  // Encode: store normalized flow (centered at 0.5) and confidence
  // Scale flow so 8% texture displacement maps to ±0.4 in channel
  float scale = 5.0; // 0.08 * 5.0 = 0.4 → fits in [0.1, 0.9] after +0.5
  fragColor = vec4(flow * scale + 0.5, confidence, 1.0);
}
`;
```

### Task 3: Update the main compositor fragment shader for advected morph

**Files:**
- Modify: `apps/web/src/layers/renderers/satelliteComposite.ts` (FS constant, lines 122-207)

- [ ] **Step 1: Add flow texture uniforms and advection logic to FS**

Replace the `FS` constant. Add these uniforms and modify `main()`:

```glsl
const FS = `\
#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex0;
uniform sampler2D uTex1;
uniform sampler2D uTex2;
uniform sampler2D uTex3;
uniform sampler2D uFlow0;
uniform sampler2D uFlow1;
uniform sampler2D uFlow2;
uniform sampler2D uFlow3;
uniform vec4 uMercBounds;
uniform float uEarthRadius;
uniform vec4 uSatParams[4];
uniform int uSatCount;
uniform float uSatOpacity[4];
uniform float uHasTex[4];
uniform float uHasFlow[4];
uniform float uTimeProgress;  // 0→1 sub-frame progress

const float PI = 3.141592653589793;
const float DEG_TO_RAD = PI / 180.0;
const float RAD_TO_DEG = 180.0 / PI;

float mercatorYToLat(float y) {
  return 2.0 * atan(exp(y / uEarthRadius)) * RAD_TO_DEG - 90.0;
}

float mercatorXToLon(float x) {
  return x / uEarthRadius * RAD_TO_DEG;
}

float greatCircleDistDeg(float lat1, float lon1, float lat2, float lon2) {
  float dLat = (lat2 - lat1) * DEG_TO_RAD;
  float dLon = (lon2 - lon1) * DEG_TO_RAD;
  float sinDLat = sin(dLat * 0.5);
  float sinDLon = sin(dLon * 0.5);
  float a = sinDLat * sinDLat +
            cos(lat1 * DEG_TO_RAD) * cos(lat2 * DEG_TO_RAD) *
            sinDLon * sinDLon;
  return 2.0 * atan(sqrt(a), sqrt(1.0 - a)) * RAD_TO_DEG;
}

vec4 sampleTex(int idx, vec2 uv) {
  if (idx == 0) return texture(uTex0, uv);
  if (idx == 1) return texture(uTex1, uv);
  if (idx == 2) return texture(uTex2, uv);
  return texture(uTex3, uv);
}

vec4 sampleFlow(int idx, vec2 uv) {
  if (idx == 0) return texture(uFlow0, uv);
  if (idx == 1) return texture(uFlow1, uv);
  if (idx == 2) return texture(uFlow2, uv);
  return texture(uFlow3, uv);
}

void main() {
  float xMerc = mix(uMercBounds.x, uMercBounds.z, vUv.x);
  float yMerc = mix(uMercBounds.y, uMercBounds.w, vUv.y);
  float lon = mercatorXToLon(xMerc);
  float lat = mercatorYToLat(yMerc);

  vec4 color = vec4(0.0);
  float totalWeight = 0.0;

  for (int i = 0; i < 4; i++) {
    if (i >= uSatCount) break;
    if (uHasTex[i] < 0.5) continue;

    vec4 params = uSatParams[i];
    float subLon = params.x;
    float subLat = params.y;
    float coverageDeg = params.z;
    float featherDeg = params.w;

    float dist = greatCircleDistDeg(lat, lon, subLat, subLon);
    float weight = 1.0 - smoothstep(coverageDeg - featherDeg, coverageDeg, dist);

    if (weight > 0.001) {
      // Advected morph: offset UV by time-progressed optical flow
      vec2 sampleUV = vUv;
      if (uHasFlow[i] > 0.5 && uTimeProgress > 0.001) {
        vec4 flowEncoded = sampleFlow(i, vUv);
        float confidence = flowEncoded.b;
        if (confidence > 0.3) {
          // Decode flow: reverse the encoding from FLOW_FS
          vec2 flow = (flowEncoded.rg - 0.5) / 5.0;
          // Advect prev toward next: sample prev at offset position
          sampleUV = vUv + flow * uTimeProgress;
        }
      }
      vec4 texel = sampleTex(i, sampleUV);
      float contrib = weight * texel.a * uSatOpacity[i];
      color += texel * contrib;
      totalWeight += contrib;
    }
  }

  if (totalWeight > 0.001) {
    color.rgb /= totalWeight;
  }
  float alpha = clamp(totalWeight, 0.0, 1.0);

  fragColor = vec4(color.rgb, alpha);
}
`;
```

### Task 4: Implement flow FBO creation and rendering

**Files:**
- Modify: `apps/web/src/layers/renderers/satelliteComposite.ts` (initializeState, draw methods)

- [ ] **Step 1: Create flow model in initializeState**

Modify `initializeState()` (line 301). Add flow model creation after the main model:

```typescript
const flowUniforms: Record<string, unknown> = {
  uPrevTex: null,
  uNextTex: null,
  uTexSize: [256, 256],
};

const flowModel = new Model(device, {
  id: `${this.props.id}-flow-model`,
  vs: FLOW_VS,
  fs: FLOW_FS_5X5,
  topology: "triangle-strip" as any,
  vertexCount: 4,
  uniforms: flowUniforms,
  parameters: {
    blend: false,
  },
});
```

Update setState call to include `flowModel` and `flowUniforms`.

- [ ] **Step 2: Add flow computation method**

Add a private method `_computeFlow` that renders the optical flow for a single satellite:

```typescript
private _computeFlow(
  entry: SatEntry,
  flowTexSize: number,
): void {
  const state = this.state as unknown as CompositorState;
  if (!state.flowModel || !entry.prevTexture || !entry.nextTexture) return;
  if (!entry.flowFbo) {
    // Create FBO + flow texture lazily
    entry.flowTexture = state.device!.createTexture({
      width: flowTexSize,
      height: flowTexSize,
      format: "rgba8unorm" as any,
      sampler: {
        minFilter: "linear" as any,
        magFilter: "linear" as any,
        addressModeU: "clamp-to-edge" as any,
        addressModeV: "clamp-to-edge" as any,
      },
    });
    // luma.gl 9.x Framebuffer creation
    const Framebuffer = (state.device as any).constructor.Framebuffer;
    entry.flowFbo = Framebuffer ? new Framebuffer(state.device, {
      id: `flow-fbo-${entry.config.id}`,
      colorAttachments: [entry.flowTexture],
    }) : null;
  }

  if (!entry.flowFbo || !entry.flowTexture) return;

  // Bind prev/next textures and render optical flow
  state.flowModel.setBindings({
    uPrevTex: entry.prevTexture,
    uNextTex: entry.nextTexture,
  });

  const u = state.flowUniforms!;
  u.uTexSize = [flowTexSize, flowTexSize];

  state.flowModel.draw(entry.flowFbo);
}
```

- [ ] **Step 3: Compute flow for all satellites with dual textures in draw()**

Add flow computation loop at the beginning of `draw()` before the main compositor draw:

```typescript
override draw(opts: any): void {
  const state = this.state as unknown as CompositorState;
  const { context, renderPass } = opts;
  const viewport = context.viewport as { /* ... */ };

  const mercBounds = mercatorBoundsFromViewport(viewport);

  // Fetch new textures if needed
  if (
    shouldRefetch(mercBounds, state.lastFetchMercBounds) ||
    state.entries.some((e) => !e.nextTexture && !e.loading && !e.loadError)
  ) {
    this._fetchTextures(mercBounds, viewport);
  }

  // Compute optical flow for entries with both prev and next textures,
  // but only when time progress is between frames (we have a new next).
  const FLOW_TEX_SIZE = 256;
  for (const entry of state.entries) {
    if (entry.prevTexture && entry.nextTexture && !entry.flowTexture) {
      this._computeFlow(entry, FLOW_TEX_SIZE);
    }
  }

  if (!state.model || !state.anyTextureLoaded) return;

  // ... rest of draw() unchanged, but pass flow textures + timeProgress
```

### Task 5: Promote next→prev texture on frame advance

**Files:**
- Modify: `apps/web/src/layers/renderers/satelliteComposite.ts` (updateState method)

- [ ] **Step 1: Detect URL change and promote textures**

Modify `updateState()` to handle frame transitions. When a satellite's URL changes (new time frame), promote `nextTexture → prevTexture` and set up for the new next:

```typescript
override updateState(params: UpdateParameters<Layer<SatelliteCompositeLayerProps>>): void {
  const state = this.state as unknown as CompositorState;
  const newSats = params.props.satellites;
  const oldSats = params.oldProps.satellites;

  if (newSats === oldSats) return;

  const oldById = new Map(state.entries.map((e) => [e.config.id, e]));

  for (const old of state.entries) {
    if (!newSats.find((s) => s.id === old.config.id)) {
      old.abortController?.abort();
      if (old.retryTimeout) clearTimeout(old.retryTimeout);
      old.prevTexture?.destroy();
      old.nextTexture?.destroy();
      old.flowTexture?.destroy();
      old.flowFbo?.destroy?.();
    }
  }

  state.entries = newSats.map((config) => {
    const old = oldById.get(config.id);

    if (old && old.config.wmsUrlTemplate === config.wmsUrlTemplate) {
      return old; // Same URL, keep everything
    }

    if (old) {
      // URL changed — time advanced to a new frame.
      // Promote next→prev if next was loaded, destroy flow so it's recomputed.
      old.abortController?.abort();
      if (old.retryTimeout) clearTimeout(old.retryTimeout);

      if (old.nextTexture) {
        old.prevTexture?.destroy();
        old.prevTexture = old.nextTexture;
        old.prevMercBounds = old.nextMercBounds;
        old.nextTexture = null;
        old.nextMercBounds = null;
        // Reset retry count on successful promotion
        old.retryCount = 0;
      }

      old.flowTexture?.destroy();
      old.flowTexture = null;
      old.flowFbo?.destroy?.();
      old.flowFbo = null;
      old.loadError = false;
      old.loading = false;
      old.abortController = null;
      return { ...old, config };
    }

    // Brand-new satellite
    return {
      config,
      prevTexture: null,
      nextTexture: null,
      prevMercBounds: null,
      nextMercBounds: null,
      flowTexture: null,
      flowFbo: null,
      loadError: false,
      loading: false,
      abortController: null,
      retryCount: 0,
      retryTimeout: null,
    };
  });
}
```

### Task 6: Add retry logic and stagger fetches

**Files:**
- Modify: `apps/web/src/layers/renderers/satelliteComposite.ts` (_fetchTextures method, lines 460-523)

- [ ] **Step 1: Replace _fetchTextures with retry + stagger**

```typescript
private _fetchTextures(
  mercBounds: [number, number, number, number],
  viewport: { width: number; height: number },
): void {
  const state = this.state as unknown as CompositorState;
  state.lastFetchMercBounds = mercBounds;

  const [texW, texH] = viewportTexDimensions(viewport);
  const MAX_RETRIES = 3;
  // Reduce threshold for satellite layers so frames update more eagerly
  const SAT_REFETCH_THRESHOLD = 0.15;

  // Stagger: 200ms delay between each satellite fetch
  let staggerMs = 0;

  for (const entry of state.entries) {
    if (entry.loading) continue;

    const boundsToCheck = entry.nextMercBounds ?? entry.prevMercBounds;
    if (
      entry.nextTexture &&
      boundsToCheck &&
      !shouldRefetchWithThreshold(mercBounds, boundsToCheck, SAT_REFETCH_THRESHOLD)
    ) {
      continue;
    }

    entry.abortController?.abort();
    if (entry.retryTimeout) clearTimeout(entry.retryTimeout);

    const controller = new AbortController();
    entry.abortController = controller;
    entry.loading = true;

    const url = buildWmsUrl(entry.config.wmsUrlTemplate, mercBounds, texW, texH);

    const doFetch = () => {
      loadImage(url, controller.signal)
        .then((bitmap) => {
          // If we already have a nextTexture, promote to prev first
          if (entry.nextTexture) {
            entry.prevTexture?.destroy();
            entry.prevTexture = entry.nextTexture;
            entry.prevMercBounds = entry.nextMercBounds;
          }
          entry.nextTexture = state.device!.createTexture({
            data: bitmap,
            width: bitmap.width,
            height: bitmap.height,
            format: "rgba8unorm" as any,
            sampler: {
              minFilter: "linear" as any,
              magFilter: "linear" as any,
              addressModeU: "clamp-to-edge" as any,
              addressModeV: "clamp-to-edge" as any,
            },
          });
          entry.nextMercBounds = mercBounds;
          entry.loadError = false;
          entry.loading = false;
          entry.abortController = null;
          entry.retryCount = 0;
          state.anyTextureLoaded = true;

          // Invalidate flow so it's recomputed with new prev/next pair
          entry.flowTexture?.destroy();
          entry.flowTexture = null;
          entry.flowFbo?.destroy?.();
          entry.flowFbo = null;

          this.setNeedsRedraw();
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") {
            entry.loading = false;
            return;
          }
          entry.retryCount += 1;
          if (entry.retryCount < MAX_RETRIES) {
            const delay = [500, 1500, 4500][entry.retryCount - 1] ?? 4500;
            entry.retryTimeout = setTimeout(doFetch, delay);
          } else {
            entry.loadError = true;
            entry.loading = false;
            entry.abortController = null;
            console.warn(
              `[SatelliteComposite] ${entry.config.id}: failed after ${MAX_RETRIES} retries — ${(err as Error).message}`,
            );
          }
        });
    };

    // Stagger by 200ms per satellite
    if (staggerMs > 0) {
      entry.retryTimeout = setTimeout(doFetch, staggerMs);
    } else {
      doFetch();
    }
    staggerMs += 200;
  }
}
```

Add the helper:

```typescript
function shouldRefetchWithThreshold(
  current: [number, number, number, number],
  last: [number, number, number, number] | null,
  threshold: number,
): boolean {
  if (!last) return true;
  const dx = Math.abs(current[2] - current[0]);
  const dy = Math.abs(current[3] - current[1]);
  if (dx < 1000 || dy < 1000) return false;
  const ex = Math.abs(current[0] - last[0]);
  const ey = Math.abs(current[1] - last[1]);
  return ex > dx * threshold || ey > dy * threshold;
}
```

### Task 7: Wire timeProgress from MapView to SatelliteComposite

**Files:**
- Modify: `apps/web/src/components/MapView.tsx` (satellite compositor section, around line 878)
- Modify: `apps/web/src/layers/renderers/satelliteComposite.ts` (layer props + constructor)

- [ ] **Step 1: Add timeProgress prop to SatelliteCompositeLayerProps**

```typescript
interface SatelliteCompositeLayerProps extends LayerProps {
  satellites: SatelliteCompositeConfig[];
  timeProgress?: number;
}
```

- [ ] **Step 2: Pass subFrameProgress from MapView to the compositor**

In `createSatelliteCompositeLayer`, accept and pass `timeProgress`:

```typescript
export function createSatelliteCompositeLayer(configs: {
  satellites: SatelliteCompositeConfig[];
  id?: string;
  timeProgress?: number;
}): SatelliteCompositeLayer | null {
  if (configs.satellites.length === 0) return null;
  return new SatelliteCompositeLayer({
    id: configs.id ?? "satellite-composite",
    satellites: configs.satellites,
    timeProgress: configs.timeProgress ?? 0,
    pickable: false,
  });
}
```

- [ ] **Step 3: Read timeProgress in draw() and set uniform**

In `draw()`, after setting up other uniforms:

```typescript
const u = state.uniforms!;
// ... existing uniform setup ...
u.uTimeProgress = this.props.timeProgress ?? 0;
u.uHasFlow = hasFlow; // 1 if flow texture exists for this satellite
```

- [ ] **Step 4: Pass subFrameProgress from MapView.tsx**

Update the `satelliteCompositeLayer` useMemo to include `subFrameProgress`:

```typescript
const satelliteCompositeLayer = useMemo(() => {
  // ... existing config building ...
  return createSatelliteCompositeLayer({
    satellites: configs,
    timeProgress: subFrameProgress,
  });
}, [satelliteSignature, subFrameProgress]);
```

### Task 8: Reduce WMS crossfade duration

**Files:**
- Modify: `apps/web/src/layers/renderers/maplibreRaster.ts` (line 22)

- [ ] **Step 1: Reduce WMS_RASTER_FADE_MS from 120 to 50**

```typescript
// 50 ms crossfade minimizes perceptible fade while still preventing hard tile pops.
// Satellite layers use the GPU compositor for seamless morphing; this value
// only affects non-satellite WMS layers (radar, models, etc.).
const WMS_RASTER_FADE_MS = 50;
```

### Task 9: Verify flow FBO works with luma.gl 9.x API

**Files:**
- Modify: `apps/web/src/layers/renderers/satelliteComposite.ts`

- [ ] **Step 1: Check luma.gl Framebuffer import and API**

luma.gl 9.x uses `Framebuffer` from `@luma.gl/core`. The framebuffer creation for the flow pass may need adjustment based on the exact API version. Add a defensive check:

```typescript
// luma.gl 9.x Framebuffer API
import { Framebuffer } from "@luma.gl/core";
```

If `Framebuffer` is not directly exported, use the device method:

```typescript
// Fallback: some luma.gl 9.x versions use device.createFramebuffer
const fbo = (state.device as any).createFramebuffer?.({
  id: `flow-fbo-${entry.config.id}`,
  colorAttachments: [entry.flowTexture],
}) ?? new Framebuffer(state.device, {
  id: `flow-fbo-${entry.config.id}`,
  colorAttachments: [entry.flowTexture],
});
```

### Task 10: Test the implementation

**Files:**
- No new files; visual verification

- [ ] **Step 1: Build and verify no TypeScript errors**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No type errors related to satelliteComposite.ts, MapView.tsx, maplibreRaster.ts

- [ ] **Step 2: Start dev server and visually verify**

Run: `cd apps/web && npx vite`
Expected:
1. Satellite layers (GOES-East natural, cloud type, GOES-West) load and display
2. During animation playback, clouds drift smoothly — no fade-to-black, no hard pops
3. Satellite disk edges blend seamlessly (existing great-circle feathering still works)
4. No CORS errors in console for satellite WMS fetches
5. Retry messages appear in console on transient failures

- [ ] **Step 3: Verify with different playback speeds**

Test at 0.5×, 1×, 2×, 4× speed. Verify:
- No frame stacking at high speeds
- Smooth morphing at all speeds
- FPS stays above 30 during playback+satellite rendering
