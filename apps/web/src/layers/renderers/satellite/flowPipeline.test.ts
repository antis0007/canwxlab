import { describe, expect, it, vi } from "vitest";

import type { Texture } from "@luma.gl/core";
import {
  FLOW_SHADER_SOURCES,
  FlowPipeline,
  type FlowPairRequest,
  type FlowPassInvocation,
} from "./flowPipeline";

const MIN10 = 600_000;

function fakeTexture(width = 512, height = 512): Texture {
  return { width, height } as unknown as Texture;
}

function pairRequest(key: string, prevTimeMs: number, overrides: Partial<FlowPairRequest> = {}): FlowPairRequest {
  return {
    key,
    sequenceKey: "seq-a",
    prevTexture: fakeTexture(),
    nextTexture: fakeTexture(),
    prevTimeMs,
    nextTimeMs: prevTimeMs + MIN10,
    mercWidthM: 2_000_000,
    globalFlow: [0.01, 0, 0.8],
    visibleProduct: true,
    ...overrides,
  };
}

describe("flow shader sources", () => {
  it("are WebGL2 shaders", () => {
    for (const src of Object.values(FLOW_SHADER_SOURCES)) {
      expect(src).toContain("#version 300 es");
    }
  });

  it("never call smoothstep with reversed constant edges", () => {
    const reversed = /smoothstep\(\s*(\d+\.\d+)\s*,\s*(\d+\.\d+)/g;
    for (const src of Object.values(FLOW_SHADER_SOURCES)) {
      for (const match of src.matchAll(reversed)) {
        expect(Number(match[1])).toBeLessThan(Number(match[2]));
      }
    }
  });
});

describe("FlowPipeline scheduling", () => {
  function makePipeline() {
    const invocations: FlowPassInvocation[] = [];
    const passRunner = vi.fn((inv: FlowPassInvocation) => invocations.push(inv));
    const pipeline = new FlowPipeline(null, { passRunner });
    return { pipeline, invocations };
  }

  it("processes pairs ahead of the playhead before pairs behind it", () => {
    const { pipeline, invocations } = makePipeline();
    const behind = pairRequest("behind", 0);
    const ahead = pairRequest("ahead", 2 * MIN10);
    pipeline.schedule([behind, ahead], MIN10);

    pipeline.pump();
    expect(invocations[0].pairKey).toBe("ahead");
  });

  it("performs one pyramid level per pump and finishes with consistency + masks", () => {
    const { pipeline, invocations } = makePipeline();
    pipeline.schedule([pairRequest("p", 0)], 0);

    // mercWidthM 2e6 → full pyramid [64,128,256,512] = 4 lk+smooth pumps,
    // then 1 backward+consistency pump, then 1 background+cloudmask pump.
    let pumps = 0;
    while (pipeline.pump()) {
      pumps += 1;
      expect(pumps).toBeLessThan(20);
    }
    expect(pumps).toBe(6);
    expect(pipeline.isReady("p")).toBe(true);

    const kinds = invocations.map((inv) => inv.kind);
    expect(kinds.filter((k) => k === "lk")).toHaveLength(5); // 4 forward + 1 backward
    expect(kinds).toContain("consistency");
    expect(kinds).toContain("background");
    expect(kinds).toContain("cloudmask");
    const levels = invocations.filter((inv) => inv.kind === "lk" && !inv.backward).map((inv) => inv.level);
    expect(levels).toEqual([64, 128, 256, 512]);
  });

  it("caps pyramid levels for zoomed-in (oversampled) imagery", () => {
    const { pipeline, invocations } = makePipeline();
    pipeline.schedule([pairRequest("z", 0, { mercWidthM: 100_000 })], 0);
    while (pipeline.pump()) { /* drain */ }
    const levels = invocations.filter((inv) => inv.kind === "lk" && !inv.backward).map((inv) => inv.level);
    expect(levels).toEqual([64]);
  });

  it("drops non-ready pairs that are no longer scheduled", () => {
    const { pipeline } = makePipeline();
    pipeline.schedule([pairRequest("old", 0)], 0);
    pipeline.pump();
    pipeline.schedule([pairRequest("new", MIN10)], MIN10);
    expect(pipeline.status("old")).toBeNull();
    expect(pipeline.status("new")).not.toBeNull();
  });

  it("reports no pending work when queue drained", () => {
    const { pipeline } = makePipeline();
    pipeline.schedule([pairRequest("p", 0)], 0);
    while (pipeline.pump()) { /* drain */ }
    expect(pipeline.hasPendingWork()).toBe(false);
    expect(pipeline.pump()).toBe(false);
  });
});
