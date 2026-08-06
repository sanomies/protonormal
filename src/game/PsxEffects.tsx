// PSX-era presentation: the scene renders into a low-res buffer (Canvas
// dpr + CSS pixelated upscale), vertices snap to a coarse screen grid (the
// signature PS1 wobble), and a post pass quantizes to 15-bit color with
// ordered dithering. Composer chain: render → OutputPass (tone mapping +
// sRGB) → dither, so quantization happens on final display colors.

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Mesh, ShaderChunk, Vector2, type Material } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { useStore } from '../state/store'

// Snap grid in half-resolution units. PSX wobble is always on; the heavy
// flavor snaps to a much coarser grid. Patching the shared chunk once
// catches every built-in material — room, avatars, bulbs — without
// per-material shader code; per-material defines pick the flavor. Tiny
// meshes that would collapse on the coarse grid (the lamp bulbs) opt out
// permanently with a PSX_NO_SNAP marker define.
if (!ShaderChunk.project_vertex.includes('psxSnap')) {
  ShaderChunk.project_vertex = ShaderChunk.project_vertex.replace(
    'gl_Position = projectionMatrix * mvPosition;',
    `gl_Position = projectionMatrix * mvPosition;
    #ifdef USE_PSX_SNAP
    if (gl_Position.w > 0.0) {
      #ifdef PSX_SNAP_HEAVY
      vec2 psxSnap = vec2(240.0, 180.0);
      #else
      vec2 psxSnap = vec2(480.0, 360.0);
      #endif
      gl_Position.xyz /= gl_Position.w;
      gl_Position.xy = floor(gl_Position.xy * psxSnap) / psxSnap;
      gl_Position.xyz *= gl_Position.w;
    }
    #endif`,
  )
}

// Restamps every material's snap defines when the flavor flips (a shader
// recompile, so only on actual change). Re-runs when peers change so
// freshly-mounted avatars get stamped too; the room stamps its own
// materials at load time in Room.tsx.
export function PsxVertexSnap(): null {
  const heavy = useStore((s) => s.psxHeavy)
  const peers = useStore((s) => s.peers)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      const mats = (Array.isArray(obj.material) ? obj.material : [obj.material]) as Material[]
      for (const mat of mats) setSnapDefine(mat, heavy)
    })
  }, [scene, heavy, peers])
  return null
}

export function setSnapDefine(mat: Material, heavy: boolean): void {
  if (!mat || mat.defines?.PSX_NO_SNAP !== undefined) return
  const hasSnap = mat.defines?.USE_PSX_SNAP !== undefined
  const hasHeavy = mat.defines?.PSX_SNAP_HEAVY !== undefined
  if (hasSnap && hasHeavy === heavy) return
  mat.defines = { ...mat.defines, USE_PSX_SNAP: '' }
  if (heavy) mat.defines.PSX_SNAP_HEAVY = ''
  else delete mat.defines.PSX_SNAP_HEAVY
  mat.needsUpdate = true
}

const PsxDitherShader = {
  uniforms: {
    tDiffuse: { value: null },
    // Quantization levels per channel: 63 (6-bit) default, 31 (PS1's
    // 15-bit color) for the heavy flavor.
    uLevels: { value: 63 },
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
    uniform float uLevels;
    varying vec2 vUv;

    // Ordered 4×4 Bayer pattern without arrays (GLSL ES 1.0 safe).
    float bayer2(vec2 a) {
      a = floor(a);
      return fract(a.x / 2.0 + a.y * a.y * 0.75);
    }

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // Push saturation before quantizing; AgX leaves the palette muted.
      float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = clamp(vec3(luma) + (c.rgb - vec3(luma)) * 1.2, 0.0, 1.0);
      float d = bayer2(0.5 * gl_FragCoord.xy) * 0.25 + bayer2(gl_FragCoord.xy);
      c.rgb = floor(c.rgb * uLevels + d) / uLevels;
      gl_FragColor = c;
    }
  `,
}

// Always-on post chain: render → bloom (in linear HDR, so only genuinely hot
// spots glow) → tone mapping/sRGB → PSX dither. The heavy flavor coarsens
// the dither quantization; everything else is shared.
export function PostEffects(): null {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const heavy = useStore((s) => s.psxHeavy)

  const { composer, dither } = useMemo(() => {
    const c = new EffectComposer(gl)
    c.addPass(new RenderPass(scene, camera))
    // Threshold ~1: only over-bright surfaces (bulbs, lamp hotspots) bloom.
    c.addPass(new UnrealBloomPass(new Vector2(256, 256), 0.55, 0.4, 0.85))
    c.addPass(new OutputPass())
    const dither = new ShaderPass(PsxDitherShader)
    c.addPass(dither)
    return { composer: c, dither }
  }, [gl, scene, camera])

  useEffect(() => {
    dither.uniforms.uLevels!.value = heavy ? 31 : 63
  }, [dither, heavy])

  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio())
    composer.setSize(size.width, size.height)
  }, [composer, gl, size])

  useEffect(() => () => composer.dispose(), [composer])

  // Priority 1 takes over r3f's render loop; the composer draws instead.
  useFrame(() => composer.render(), 1)
  return null
}
