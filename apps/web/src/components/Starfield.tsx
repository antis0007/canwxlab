// Real-time celestial-sphere starfield, drawn behind the photorealistic globe.
// Reads camera + time from refs (parent updates them imperatively) so React never
// re-renders on drag. Writes the current frame's screen projections back through
// `projectionsRef` so the parent can do star hit-tests in CSS-pixel space.
//
// COSMIC-TODO(A): Replace canvas-2D point-by-point loop with a regl/Three instanced renderer
//   once the catalogue grows past ~3k stars (HYG vendoring). Apply per-star B-V → RGB tint and
//   atmospheric extinction near the limb. See docs/cosmic-scope-roadmap.md §9 Phase A.
// COSMIC-TODO(F): Add a `groundMode` prop that switches the projection to alt-az from a fixed
//   observer location, drawing a horizon line and compass cardinal markers. The math is the
//   same ECI basis with `forward = -localUp(observer)` instead of camera-to-Earth-centre.

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { CameraState, StarExposure } from "../layers/types";
import {
  BRIGHT_STARS,
  EARTH_RADIUS_KM,
  altitudeKmFromZoom,
  buildCameraBasis,
  cameraEci,
  gmstRadians,
  projectStarToScreen,
  starEci,
  type Star,
  type Vec3,
} from "../lib/celestialSphere";

export interface StarProjection {
  star: Star;
  cssX: number; // CSS pixels from canvas origin
  cssY: number;
  alpha: number;
  radiusCss: number;
}

interface StarfieldProps {
  cameraRef: RefObject<CameraState | null>;
  timeRef: RefObject<number>;
  /** Vertical FOV (deg). MapLibre globe default ≈ 36.87°. */
  verticalFovDeg?: number;
  exposure?: StarExposure;
  maxDistanceLy?: number;
  maxFps?: number;
  /** Parent-owned ref into which we write the latest frame's CSS-space projections (for hit-testing). */
  projectionsRef?: RefObject<StarProjection[]>;
}

interface StarDraw {
  star: Star;
  eci: Vec3;
  brightness: number; // 0..1 from magnitude
}

const STAR_DRAW: StarDraw[] = BRIGHT_STARS.map((s) => ({
  star: s,
  eci: starEci(s),
  brightness: Math.max(0, Math.min(1, (6 - s.mag) / 8)),
}));

function exposureBoost(e: StarExposure | undefined): { alphaGain: number; radiusGain: number; floor: number } {
  switch (e) {
    case "dim":      return { alphaGain: 0.55, radiusGain: 0.75, floor: 0.04 };
    case "bright":   return { alphaGain: 1.45, radiusGain: 1.35, floor: 0.20 };
    case "extreme":  return { alphaGain: 2.20, radiusGain: 1.70, floor: 0.35 };
    case "realistic":
    default:         return { alphaGain: 1.00, radiusGain: 1.00, floor: 0.08 };
  }
}

export function Starfield({
  cameraRef,
  timeRef,
  verticalFovDeg = 36.87,
  exposure = "realistic",
  maxDistanceLy = 500,
  maxFps = 60,
  projectionsRef,
}: StarfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  // Mirror props through refs so the rAF loop reads latest values without restarting.
  const exposureRef = useRef(exposure);
  const maxDistRef = useRef(maxDistanceLy);
  const maxFpsRef = useRef(maxFps);
  const fovRef = useRef(verticalFovDeg);
  useEffect(() => { exposureRef.current = exposure; }, [exposure]);
  useEffect(() => { maxDistRef.current = maxDistanceLy; }, [maxDistanceLy]);
  useEffect(() => { maxFpsRef.current = maxFps; }, [maxFps]);
  useEffect(() => { fovRef.current = verticalFovDeg; }, [verticalFovDeg]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let dpr = window.devicePixelRatio || 1;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let lastDrawAt = 0;

    const draw = (timestamp: number) => {
      const frameInterval = 1000 / Math.max(1, maxFpsRef.current);
      if (timestamp - lastDrawAt < frameInterval) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      lastDrawAt = timestamp;

      const cam = cameraRef.current;
      const tMs = timeRef.current ?? Date.now();
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const projections: StarProjection[] = [];
      if (projectionsRef && projectionsRef.current) {
        // Reuse the array by length-reset; React refs let us mutate freely.
        projectionsRef.current.length = 0;
      }

      if (!cam) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const halfW = w / 2;
      const halfH = h / 2;
      const focalPx = halfH / Math.tan((fovRef.current * Math.PI) / 360);

      const gmst = gmstRadians(tMs);
      const altKm = altitudeKmFromZoom(cam.zoom);
      const camPos: Vec3 = cameraEci(cam.latitude, cam.longitude, altKm, gmst);
      const basis = buildCameraBasis(camPos, cam.bearing);

      const distance = basis.distance;
      const earthAngularRadius = Math.asin(Math.min(0.9999, EARTH_RADIUS_KM / distance));

      // Atmospheric limb glow.
      const limbPx = focalPx * Math.tan(earthAngularRadius);
      const haloOuter = limbPx * 1.18;
      const haloInner = limbPx * 1.005;
      if (haloOuter > 0 && haloOuter < Math.max(w, h)) {
        const grad = ctx.createRadialGradient(halfW, halfH, haloInner, halfW, halfH, haloOuter);
        grad.addColorStop(0, "rgba(120, 175, 240, 0.28)");
        grad.addColorStop(0.5, "rgba(80, 140, 220, 0.10)");
        grad.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(halfW, halfH, haloOuter, 0, Math.PI * 2);
        ctx.fill();
      }

      const exp = exposureBoost(exposureRef.current);
      const maxLy = maxDistRef.current ?? 500;

      for (const sd of STAR_DRAW) {
        if (sd.star.distanceLy != null && sd.star.distanceLy > maxLy) continue;
        const p = projectStarToScreen(sd.eci, basis, focalPx, halfW, halfH, earthAngularRadius);
        if (!p) continue;
        if (p.occluded) continue;
        if (p.x < -20 || p.y < -20 || p.x > w + 20 || p.y > h + 20) continue;

        const baseRadius = 0.5 + sd.brightness * 2.2;
        const baseAlpha = exp.floor + sd.brightness * 0.85;
        const r = baseRadius * exp.radiusGain * dpr;
        const a = Math.min(1, baseAlpha * exp.alphaGain);

        // Twinkle: per-star phase from name hash.
        const phase = (sd.star.name.charCodeAt(0) + sd.star.name.charCodeAt(sd.star.name.length - 1)) * 0.13;
        const tw = 0.85 + 0.15 * Math.sin(tMs / 900 + phase);

        ctx.fillStyle = `rgba(255, 248, 230, ${a * tw})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();

        // Diffraction-spike flare for the very brightest.
        const flareThreshold = exposureRef.current === "extreme" ? 2.0 :
                               exposureRef.current === "bright"  ? 1.5 : 1.0;
        if (sd.star.mag < flareThreshold) {
          ctx.strokeStyle = `rgba(255, 240, 210, ${a * 0.45 * tw})`;
          ctx.lineWidth = 0.7 * dpr;
          const flare = r * 4;
          ctx.beginPath();
          ctx.moveTo(p.x - flare, p.y); ctx.lineTo(p.x + flare, p.y);
          ctx.moveTo(p.x, p.y - flare); ctx.lineTo(p.x, p.y + flare);
          ctx.stroke();
        }

        projections.push({
          star: sd.star,
          cssX: p.x / dpr,
          cssY: p.y / dpr,
          alpha: a,
          radiusCss: r / dpr,
        });
      }

      if (projectionsRef && projectionsRef.current) {
        for (const p of projections) projectionsRef.current.push(p);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [cameraRef, timeRef, projectionsRef]);

  return <canvas ref={canvasRef} className="map-starfield-canvas" aria-hidden="true" />;
}
