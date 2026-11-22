import { useLayoutEffect, useRef, type RefObject } from 'react'
import { haptic } from '../../utils/haptics.js'
import styles from './IOSRippleShader.module.css'

/**
 * 液态玻璃流体水波（WebGL1 主路径 + Canvas2D 兜底）。
 *
 * 物理模型：
 * - 每个触点是一个随时间向外传播的波源；按下 = 强单源完整波前，按住滑动时按
 *   位移/速度沿轨迹连续注入小波源，波源携带拖动方向，沿拖向拉出连续水痕；
 * - 波面由主波前 + 细纹双频正弦叠加，包络随半径与时间衰减，多波源自然干涉；
 * - 对波面高度场做中心差分得到法线梯度，对真实背景采样纹理做 RGB 分离折射
 *   （色散）+ 菲涅尔高光；没有背景纹理时退化为高光波纹，不伪造玻璃贴图。
 *
 * 降级链：WebGL 不可用 / 着色器编译链接失败 → 换干净画布走 Canvas2D 双环扩散；
 * 2D 上下文也取不到时静默放弃，只保留 CSS 静态边缘高光，不出现空白面板或报错刷屏。
 */

export const MAX_RIPPLES = 24
const LIFE = 3.2
/** 波前扩散速度 px/s */
const WAVE_SPEED = 190
/** 中心差分步长 px */
const GRAD_STEP = 3.0
/** DPR 上限 */
const MAX_DPR = 2

type Ripple = {
  x: number
  y: number
  vx: number
  vy: number
  start: number
  strength: number
  pointer: number
}

export type RippleShaderProps = {
  hostRef: RefObject<HTMLDivElement | null>
  /** 与玻璃层对齐的聊天背景（CSS `url(...)` 或 data URL），作为折射纹理；缺失时只画高光 */
  backgroundImage: string | null
  /** 是否注入波源；关闭增强动画 / reduced-motion 时为 false，组件不挂载画布 */
  enabled: boolean
  /** 通透度 0.08–1，越通透折射偏移越明显 */
  clarity?: number
  /** 波幅系数：大面积面板可下调，避免文字区抖动 */
  amplitude?: number
}

const VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FRAGMENT = `
precision highp float;

varying vec2 v_uv;
uniform vec2 u_resolution;
uniform vec2 u_bg_origin;
uniform vec2 u_bg_size;
uniform float u_has_texture;
uniform sampler2D u_texture;
uniform float u_clarity;
uniform float u_amplitude;
// xy: 波源位置, zw: 归一化拖动方向
uniform vec4 u_ripples[${MAX_RIPPLES}];
uniform float u_strength[${MAX_RIPPLES}];
uniform float u_ages[${MAX_RIPPLES}];

// 单个波源对 p 点的高度贡献；速度方向用于沿拖向拉长连续水痕
float waveHeight(vec2 p, vec4 r, float amp, float age) {
  if (age <= 0.0 || age > ${LIFE.toFixed(1)} || amp <= 0.0) return 0.0;
  vec2 c = r.xy;
  vec2 vel = r.zw;
  vec2 along = p - c;
  float d = length(along);
  float speed = length(vel);
  float streak = 1.0;
  if (speed > 1e-3) {
    vec2 dir = vel / speed;
    float proj = dot(along, dir);
    float perp = abs(along.x * dir.y - along.y * dir.x);
    streak = exp(-perp * perp / 1300.0) * exp(-max(proj, 0.0) * max(proj, 0.0) / 6500.0);
  }
  // 波前随时间向外扩散；高斯包络在波前两侧收窄
  float front = age * ${WAVE_SPEED.toFixed(1)};
  float width = 18.0 + age * 22.0;
  float t = (d - front) / width;
  float envelope = exp(-t * t);
  float damp = exp(-age * 1.25) * exp(-d * 0.005);
  // 双频叠加：主波前 + 细纹
  float main = sin((d - front) * 0.15);
  float fine = sin((d - front) * 0.42);
  return (main * 0.72 + fine * 0.28) * envelope * damp * amp * (0.55 + 0.45 * streak);
}

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution;

  // 邻域中心差分得到波面梯度（法线），每个波源 4 次采样
  vec2 grad = vec2(0.0);
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = u_ripples[i];
    float amp = u_strength[i];
    float age = u_ages[i];
    float hxp = waveHeight(p + vec2(${GRAD_STEP.toFixed(1)}, 0.0), r, amp, age);
    float hxn = waveHeight(p - vec2(${GRAD_STEP.toFixed(1)}, 0.0), r, amp, age);
    float hyp = waveHeight(p + vec2(0.0, ${GRAD_STEP.toFixed(1)}), r, amp, age);
    float hyn = waveHeight(p - vec2(0.0, ${GRAD_STEP.toFixed(1)}), r, amp, age);
    grad.x += (hxp - hxn) * 0.5;
    grad.y += (hyp - hyn) * 0.5;
  }

  vec2 normal = grad * 0.32 * u_amplitude;
  float energy = length(grad);

  vec2 uv = (u_bg_origin + p) / u_bg_size;
  vec3 refracted = vec3(0.96);
  if (u_has_texture > 0.5) {
    // 越通透偏移越大；RGB 三通道按不同系数分离，形成色散
    vec2 offset = normal * (0.016 + 0.022 * u_clarity);
    refracted = vec3(
      texture2D(u_texture, vec2(uv.x + offset.x * 1.08, 1.0 - (uv.y + offset.y * 1.08))).r,
      texture2D(u_texture, vec2(uv.x + offset.x, 1.0 - (uv.y + offset.y))).g,
      texture2D(u_texture, vec2(uv.x + offset.x * 0.92, 1.0 - (uv.y + offset.y * 0.92))).b
    );
  }

  float amount = clamp(energy * 3.2 * u_amplitude, 0.0, 0.5);
  float fresnel = pow(clamp(energy * 7.0, 0.0, 1.0), 1.35);
  vec3 color = mix(refracted, vec3(1.0), 0.14 + fresnel * 0.3);
  gl_FragColor = vec4(color, amount);
}
`

const compileShader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null => {
  const shader = gl.createShader(type)
  if (!shader) {return null}
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

const backgroundUrl = (value: string | null): string | null => {
  if (!value) {return null}
  return /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(value)?.[2] ?? null
}

/**
 * 共享实现：iOS 壳、Android 壳与网页端走同一条路径，避免两套分叉。
 * AndroidRippleShader 仅做别名转发。
 */
export const IOSRippleShader = ({
  hostRef,
  backgroundImage,
  enabled,
  clarity = 0.55,
  amplitude = 1,
}: RippleShaderProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 通透度 / 波幅通过 ref 读取，避免滑块拖动时重建 GL 上下文
  const liveProps = useRef({ clarity, amplitude })
  liveProps.current = { clarity, amplitude }

  useLayoutEffect(() => {
    if (!enabled) {return}
    const canvas = canvasRef.current
    const host = hostRef.current ?? canvas?.parentElement
    if (!canvas || !host) {return}

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'default',
    }) as WebGLRenderingContext | null

    // WebGL 上下文一旦建立就不能再取 2d；失败时换一张干净画布走 2D 保底
    if (!gl) {return setupCanvasFallback(canvas, host)}

    const fallback = () => {
      const next = document.createElement('canvas')
      next.className = canvas.className
      next.setAttribute('aria-hidden', 'true')
      canvas.replaceWith(next)
      setupCanvasFallback(next, host)
    }

    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX)
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT)
    if (!vertex || !fragment) {
      if (vertex) {gl.deleteShader(vertex)}
      if (fragment) {gl.deleteShader(fragment)}
      return fallback()
    }
    const program = gl.createProgram()
    if (!program) {return fallback()}
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program)
      return fallback()
    }

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    )
    const position = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    const uResolution = gl.getUniformLocation(program, 'u_resolution')
    const uBgOrigin = gl.getUniformLocation(program, 'u_bg_origin')
    const uBgSize = gl.getUniformLocation(program, 'u_bg_size')
    const uHasTexture = gl.getUniformLocation(program, 'u_has_texture')
    const uClarity = gl.getUniformLocation(program, 'u_clarity')
    const uAmplitude = gl.getUniformLocation(program, 'u_amplitude')
    const uRipples = gl.getUniformLocation(program, 'u_ripples[0]')
    const uStrength = gl.getUniformLocation(program, 'u_strength[0]')
    const uAges = gl.getUniformLocation(program, 'u_ages[0]')
    const uTexture = gl.getUniformLocation(program, 'u_texture')

    gl.useProgram(program)
    if (uTexture) {gl.uniform1i(uTexture, 0)}
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)

    let texture: WebGLTexture | null = null
    let hasTexture = false
    let ripples: Ripple[] = []
    let frame = 0
    let onScreen = true
    const pointers = new Map<number, { x: number; y: number; vx: number; vy: number; last: number }>()
    let cssWidth = 1
    let cssHeight = 1

    const resize = () => {
      const rect = host.getBoundingClientRect()
      cssWidth = Math.max(1, rect.width)
      cssHeight = Math.max(1, rect.height)
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      const w = Math.round(cssWidth * ratio)
      const h = Math.round(cssHeight * ratio)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      gl.viewport(0, 0, w, h)
    }

    const draw = (now: number) => {
      frame = 0
      resize()
      ripples = ripples.filter((ripple) => now - ripple.start < LIFE * 1000)

      const values = new Float32Array(MAX_RIPPLES * 4)
      const strengths = new Float32Array(MAX_RIPPLES)
      const ages = new Float32Array(MAX_RIPPLES)
      const visible = ripples.slice(-MAX_RIPPLES)
      for (let index = 0; index < visible.length; index++) {
        const ripple = visible[index]
        const age = (now - ripple.start) / 1000
        const speed = Math.hypot(ripple.vx, ripple.vy) || 1
        values[index * 4] = ripple.x
        values[index * 4 + 1] = ripple.y
        values[index * 4 + 2] = ripple.vx / speed
        values[index * 4 + 3] = ripple.vy / speed
        // 未松手的触点持续输入能量，水痕不随时间快速衰减
        const live = pointers.has(ripple.pointer)
        strengths[index] = ripple.strength * (live ? 1.15 : 1)
        ages[index] = age
      }

      const rect = host.getBoundingClientRect()
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)
      gl.uniform2f(uResolution, cssWidth, cssHeight)
      gl.uniform2f(uBgOrigin, rect.left, rect.top)
      gl.uniform2f(uBgSize, window.innerWidth, window.innerHeight)
      gl.uniform1f(uHasTexture, hasTexture ? 1 : 0)
      gl.uniform1f(uClarity, liveProps.current.clarity)
      gl.uniform1f(uAmplitude, liveProps.current.amplitude)
      if (uRipples) {gl.uniform4fv(uRipples, values)}
      if (uStrength) {gl.uniform1fv(uStrength, strengths)}
      if (uAges) {gl.uniform1fv(uAges, ages)}
      if (texture) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, texture)
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6)

      if ((ripples.length > 0 || pointers.size > 0) && !document.hidden && onScreen) {
        frame = requestAnimationFrame(draw)
      }
    }

    const startLoop = () => {
      if (!frame && !document.hidden && onScreen) {frame = requestAnimationFrame(draw)}
    }

    const spawn = (x: number, y: number, vx: number, vy: number, strength: number, pointer: number) => {
      ripples.push({ x, y, vx, vy, start: performance.now(), strength, pointer })
      if (ripples.length > MAX_RIPPLES * 2) {ripples = ripples.slice(-MAX_RIPPLES * 2)}
      startLoop()
    }

    const inside = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      )
    }
    const local = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }

    const onDown = (event: PointerEvent) => {
      if (!inside(event)) {return}
      const point = local(event)
      pointers.set(event.pointerId, { x: point.x, y: point.y, vx: 0, vy: 0, last: performance.now() })
      haptic('soft')
      spawn(point.x, point.y, 0, 0, 1, event.pointerId)
    }
    const onMove = (event: PointerEvent) => {
      const track = pointers.get(event.pointerId)
      if (!track || !inside(event)) {return}
      const point = local(event)
      const now = performance.now()
      const dt = Math.max(1, now - track.last)
      const vx = ((point.x - track.x) / dt) * 16
      const vy = ((point.y - track.y) / dt) * 16
      track.vx = vx
      track.vy = vy
      track.x = point.x
      track.y = point.y
      track.last = now
      // 按住拖动：按位移节流连续注入带方向的小波源，速度越快波源越强
      const prior = ripples[ripples.length - 1]
      const moved = prior ? Math.hypot(prior.x - point.x, prior.y - point.y) : Infinity
      if (moved < 10) {return}
      const speed = Math.hypot(vx, vy)
      const strength = Math.min(0.9, 0.45 + speed * 0.05)
      spawn(point.x, point.y, vx, vy, strength, event.pointerId)
    }
    const onUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
    }
    const onVisibility = () => {
      if (!document.hidden) {startLoop()}
    }

    const loadTexture = () => {
      const url = backgroundUrl(backgroundImage)
      if (!url) {return}
      const image = new Image()
      if (/^https?:/i.test(url)) {image.crossOrigin = 'anonymous'}
      image.onload = () => {
        const next = gl.createTexture()
        if (!next) {return}
        texture = next
        gl.bindTexture(gl.TEXTURE_2D, next)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        hasTexture = gl.getError() === gl.NO_ERROR
        startLoop()
      }
      image.onerror = () => {
        hasTexture = false
      }
      image.src = url
    }

    resize()
    loadTexture()
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    window.addEventListener('pointercancel', onUp, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)

    const observer = new ResizeObserver(() => {
      resize()
      startLoop()
    })
    observer.observe(host)

    let intersection: IntersectionObserver | null = null
    if (typeof IntersectionObserver !== 'undefined') {
      intersection = new IntersectionObserver((entries) => {
        onScreen = entries[0]?.isIntersecting ?? true
        if (onScreen) {startLoop()}
      })
      intersection.observe(host)
    }

    return () => {
      if (frame) {cancelAnimationFrame(frame)}
      observer.disconnect()
      intersection?.disconnect()
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.removeEventListener('visibilitychange', onVisibility)
      if (texture) {gl.deleteTexture(texture)}
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }
  }, [enabled, backgroundImage, hostRef])

  if (!enabled) {return null}
  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden />
}

/**
 * Canvas2D 兜底：双环扩散 + 沿拖向的短水痕。仍然跟手、按轨迹连续注入，
 * 不绘制任何假玻璃贴图；没有 WebGL 能力时保证反馈不空白。
 */
const setupCanvasFallback = (canvas: HTMLCanvasElement, host: HTMLElement) => {
  const context = canvas.getContext('2d')
  if (!context) {return}
  canvas.dataset.engine = '2d'
  let ripples: Ripple[] = []
  let frame = 0
  let onScreen = true
  const pointers = new Map<number, { x: number; y: number; last: number }>()
  let cssWidth = 1
  let cssHeight = 1

  const resize = () => {
    const rect = host.getBoundingClientRect()
    cssWidth = Math.max(1, rect.width)
    cssHeight = Math.max(1, rect.height)
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    const w = Math.round(cssWidth * ratio)
    const h = Math.round(cssHeight * ratio)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
  }

  const draw = (now: number) => {
    frame = 0
    resize()
    ripples = ripples.filter((ripple) => now - ripple.start < LIFE * 1000)
    context.clearRect(0, 0, cssWidth, cssHeight)
    for (const ripple of ripples) {
      const age = Math.max(0, (now - ripple.start) / 1000)
      const radius = Math.max(1, age * 132)
      const fade = Math.max(0, 1 - age / LIFE)
      const alpha = fade * fade * ripple.strength
      context.save()
      context.beginPath()
      context.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2)
      context.strokeStyle = `rgba(255,255,255,${(alpha * 0.4).toFixed(3)})`
      context.lineWidth = 2 + age * 5
      context.stroke()
      context.beginPath()
      context.arc(ripple.x, ripple.y, Math.max(1, radius - 11), 0, Math.PI * 2)
      context.strokeStyle = `rgba(150,195,255,${(alpha * 0.25).toFixed(3)})`
      context.lineWidth = 1.2
      context.stroke()
      context.restore()
    }
    if (ripples.length > 0 && !document.hidden && onScreen) {frame = requestAnimationFrame(draw)}
  }

  const startLoop = () => {
    if (!frame && !document.hidden && onScreen) {frame = requestAnimationFrame(draw)}
  }

  const inside = (event: PointerEvent) => {
    const rect = host.getBoundingClientRect()
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    )
  }
  const local = (event: PointerEvent) => {
    const rect = host.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const spawn = (x: number, y: number, vx: number, vy: number, strength: number, pointer: number) => {
    ripples.push({ x, y, vx, vy, start: performance.now(), strength, pointer })
    if (ripples.length > MAX_RIPPLES * 2) {ripples = ripples.slice(-MAX_RIPPLES * 2)}
    startLoop()
  }

  const onDown = (event: PointerEvent) => {
    if (!inside(event)) {return}
    const point = local(event)
    pointers.set(event.pointerId, { x: point.x, y: point.y, last: performance.now() })
    haptic('soft')
    spawn(point.x, point.y, 0, 0, 1, event.pointerId)
  }
  const onMove = (event: PointerEvent) => {
    const track = pointers.get(event.pointerId)
    if (!track || !inside(event)) {return}
    const point = local(event)
    const now = performance.now()
    const dt = Math.max(1, now - track.last)
    const vx = ((point.x - track.x) / dt) * 16
    const vy = ((point.y - track.y) / dt) * 16
    const moved = Math.hypot(point.x - track.x, point.y - track.y)
    track.x = point.x
    track.y = point.y
    track.last = now
    if (moved < 10) {return}
    spawn(point.x, point.y, vx, vy, Math.min(0.9, 0.45 + Math.hypot(vx, vy) * 0.05), event.pointerId)
  }
  const onUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId)
  }
  const onVisibility = () => {
    if (!document.hidden) {startLoop()}
  }

  resize()
  window.addEventListener('pointerdown', onDown, { passive: true })
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerup', onUp, { passive: true })
  window.addEventListener('pointercancel', onUp, { passive: true })
  document.addEventListener('visibilitychange', onVisibility)

  const observer = new ResizeObserver(() => {
    resize()
    startLoop()
  })
  observer.observe(host)

  let intersection: IntersectionObserver | null = null
  if (typeof IntersectionObserver !== 'undefined') {
    intersection = new IntersectionObserver((entries) => {
      onScreen = entries[0]?.isIntersecting ?? true
      if (onScreen) {startLoop()}
    })
    intersection.observe(host)
  }

  return () => {
    if (frame) {cancelAnimationFrame(frame)}
    observer.disconnect()
    intersection?.disconnect()
    window.removeEventListener('pointerdown', onDown)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
