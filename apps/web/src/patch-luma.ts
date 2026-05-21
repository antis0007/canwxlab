// Monkey-patches for luma.gl / deck.gl noise. This module must be the
// FIRST import in main.tsx so patches are in place before downstream
// modules load @luma.gl/core, @luma.gl/engine, or @deck.gl/*.

// 1. Firefox deprecated WEBGL_debug_renderer_info — suppress the extension
//    request so luma falls back to the non-deprecated GL.RENDERER parameter.
const originalGetExtension = WebGL2RenderingContext.prototype.getExtension;
WebGL2RenderingContext.prototype.getExtension = function (
  this: WebGL2RenderingContext,
  name: string,
) {
  if (name === "WEBGL_debug_renderer_info") return null;
  return originalGetExtension.call(this, name);
};

// 2. luma.gl ShaderInputs.setProps warns "Module X not found" for deck.gl
//    built-in modules (picking, layer, project, shadow, lighting,
//    phongMaterial, gouraudMaterial). These are false positives from deck.gl
//    internals. Import @luma.gl/core synchronously so the log singleton is
//    patched before any other module creates ShaderInputs instances.
const SHADER_MODULE_WARN = /^Module \w+ not found$/;

import { log } from "@luma.gl/core";

{
  const originalWarn = log.warn.bind(log);
  log.warn = function (message: string, ...args: unknown[]) {
    if (SHADER_MODULE_WARN.test(message)) {
      return () => {};
    }
    return originalWarn(message, ...args);
  } as typeof log.warn;
}
