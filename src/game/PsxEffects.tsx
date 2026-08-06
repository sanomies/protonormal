// PSX-era presentation: the scene renders into a low-res buffer (Canvas
// dpr + CSS pixelated upscale), vertices snap to a coarse screen grid (the
// signature PS1 wobble), and a post pass quantizes to 15-bit color with
// ordered dithering. Composer chain: render → OutputPass (tone mapping +
// sRGB) → dither, so quantization happens on final display colors.

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Mesh, ShaderChunk, type Material } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { useStore } from '../state/store'

// Snap grid in half-resolution units: NDC [-1,1] × 480 ≈ a 960×720 raster.
// Patching the shared chunk once catches every built-in material — room,
// avatars, bulbs — without per-material shader code. The wobble is gated on
// a USE_PSX_SNAP define per material so the menu toggle can switch it off;
// PsxVertexSnap below maintains the define. Tiny meshes that would collapse
// on the coarse grid (the lamp bulbs) opt out permanently with a
// PSX_NO_SNAP marker define.
if (!ShaderChunk.project_vertex.includes('psxSnap')) {
  ShaderChunk.project_vertex = ShaderChunk.project_vertex.replace(
    'gl_Position = projectionMatrix * mvPosition;',
    `gl_Position = projectionMatrix * mvPosition;
    #ifdef USE_PSX_SNAP
    if (gl_Position.w > 0.0) {
      vec2 psxSnap = vec2(480.0, 360.0);
      gl_Position.xyz /= gl_Position.w;
      gl_Position.xy = floor(gl_Position.xy * psxSnap) / psxSnap;
      gl_Position.xyz *= gl_Position.w;
    }
    #endif`,
  )
}

// Adds/removes USE_PSX_SNAP on every material in the scene when the setting
// flips (a recompile, so only on actual change). Re-runs when peers change
// so freshly-mounted avatars get stamped too; the room stamps its own
// materials at load time in Room.tsx.
export function PsxVertexSnap(): null {
  const psx = useStore((s) => s.psx)
  const peers = useStore((s) => s.peers)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      const mats = (Array.isArray(obj.material) ? obj.material : [obj.material]) as Material[]
      for (const mat of mats) setSnapDefine(mat, psx)
    })
  }, [scene, psx, peers])
  return null
}

export function setSnapDefine(mat: Material, on: boolean): void {
  if (!mat || mat.defines?.PSX_NO_SNAP !== undefined) return
  const has = mat.defines?.USE_PSX_SNAP !== undefined
  if (on === has) return
  if (on) {
    mat.defines = { ...mat.defines, USE_PSX_SNAP: '' }
  } else if (mat.defines) {
    delete mat.defines.USE_PSX_SNAP
  }
  mat.needsUpdate = true
}

const PsxDitherShader = {
  uniforms: {
    tDiffuse: { value: null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;

    // Ordered 4×4 Bayer pattern without arrays (GLSL ES 1.0 safe).
    float bayer2(vec2 a) {
      a = floor(a);
      return fract(a.x / 2.0 + a.y * a.y * 0.75);
    }

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = bayer2(0.5 * gl_FragCoord.xy) * 0.25 + bayer2(gl_FragCoord.xy);
      // 6 bits per channel — half as coarse as the PS1's 15-bit color, so
      // the dither pattern reads as texture rather than dominating.
      c.rgb = floor(c.rgb * 63.0 + d) / 63.0;
      gl_FragColor = c;
    }
  `,
}

export function PsxEffects(): null {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const composer = useMemo(() => {
    const c = new EffectComposer(gl)
    c.addPass(new RenderPass(scene, camera))
    c.addPass(new OutputPass())
    c.addPass(new ShaderPass(PsxDitherShader))
    return c
  }, [gl, scene, camera])

  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio())
    composer.setSize(size.width, size.height)
  }, [composer, gl, size])

  useEffect(() => () => composer.dispose(), [composer])

  // Priority 1 takes over r3f's render loop; the composer draws instead.
  useFrame(() => composer.render(), 1)
  return null
}
