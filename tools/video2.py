import pathlib
import sys

VIDEO_SERVICE = '''const MAX_FRAMES = 6
const MAX_SIDE = 1280

const seekTo = (video: HTMLVideoElement, time: number) =>
  new Promise<void>((resolve) => {
    const target = Math.min(Math.max(time, 0), Math.max(video.duration - 0.03, 0))
    let settled = false
    const done = () => {
      if (settled) {
        return
      }
      settled = true
      video.removeEventListener('seeked', done)
      resolve()
    }
    video.addEventListener('seeked', done, { once: true })
    try {
      video.currentTime = target
    } catch {
      done()
      return
    }
    window.setTimeout(done, 220)
  })

/**
 * 视频逐帧识别的前置步骤：在本地把视频均匀抽成若干张 JPEG 画面，
 * 再交给现有的图片附件通道上传给模型，模型就能一帧一帧看画面。
 */
export const extractVideoFrames = async (file: File): Promise<File[]> => {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.setAttribute('playsinline', 'true')
  video.setAttribute('preload', 'auto')

  try {
    await new Promise<void>((resolve, reject) => {
      const okay = () => resolve()
      video.addEventListener('loadeddata', okay, { once: true })
      video.addEventListener('error', () => reject(new Error('video decode failed')), { once: true })
      video.load()
      window.setTimeout(okay, 4000)
    })

    if (!video.videoWidth || !video.videoHeight) {
      throw new Error('empty video')
    }

    const duration = Number.isFinite(video.duration) && video.duration > 0.2 ? video.duration : 0.5
    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('no canvas')
    }

    const times = Array.from({ length: MAX_FRAMES }, (_, index) => (duration * (index + 0.5)) / MAX_FRAMES)
    const frames: File[] = []
    for (const [index, time] of times.entries()) {
      await seekTo(video, time)
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84))
      if (blob && blob.size > 1024) {
        frames.push(
          new File([blob], `video-frame-${String(index + 1).padStart(2, '0')}.jpg`, {
            type: 'image/jpeg',
          })
        )
      }
    }
    return frames
  } finally {
    video.removeAttribute('src')
    URL.revokeObjectURL(url)
  }
}
'''


def write(path, content):
    pathlib.Path(path).write_text(content, encoding='utf-8')
    print(f'write {path}')


def edit(path, old, new, count=1):
    p = pathlib.Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        sys.exit(f'MISS in {path}: {old[:70]}')
    p.write_text(text.replace(old, new, count), encoding='utf-8')
    print(f'ok {path}')


edit(
    'src/utils/motion.ts',
    """/**
 * 把「减弱动态效果 / 省电模式 / 用户关闭增强动画」统一写到根节点，
 * CSS 只保留 80ms 的必要状态过渡，倾斜、流光、语义块和呼吸动效全部停用。
 */""",
    """/**
 * 只在系统「减弱动态效果」或低电量时收掉装饰性动效（倾斜、流光、呼吸）。
 * 「增强动画」开关只负责液态玻璃的水波纹，不再连带关闭普通 UI 交互动画。
 */"""
)

edit(
    'src/utils/motion.ts',
    '    const reduced = prefersReducedMotion() || !useSettings.getState().enhancedMotion',
    '    const reduced = prefersReducedMotion()'
)

edit(
    'src/utils/motion.ts',
    '      if ((battery.level <= 0.2 && !battery.charging) || !useSettings.getState().enhancedMotion) {',
    '      if (battery.level <= 0.2 && !battery.charging) {'
)

edit(
    'src/components/base/IOSRippleShader.tsx',
    """uniform float u_clarity;
uniform float u_amplitude;""",
    """uniform float u_clarity;
uniform float u_amplitude;
uniform float u_dark;"""
)

edit(
    'src/components/base/IOSRippleShader.tsx',
    """  vec2 uv = (u_bg_origin + p) / u_bg_size;
  vec3 refracted = vec3(0.96);
  if (u_has_texture > 0.5) {
    // 越通透偏移越大；RGB 三通道按不同系数分离，形成色散
    vec2 offset = normal * (0.016 + 0.022 * u_clarity);
    refracted = vec3(
      texture2D(u_texture, vec2(uv.x + offset.x * 1.08, 1.0 - (uv.y + offset.y * 1.08))).r,
      texture2D(u_texture, vec2(uv.x + offset.x, 1.0 - (uv.y + offset.y))).g,
      texture2D(u_texture, vec2(uv.x + offset.x * 0.92, 1.0 - (uv.y + offset.y * 0.92))).b
    );
  }""",
    """  vec2 uv = (u_bg_origin + p) / u_bg_size;
  // 越通透偏移越大；RGB 三通道按不同系数分离，形成色散
  vec2 offset = normal * (0.016 + 0.022 * u_clarity);
  vec3 refracted = vec3(0.96);
  if (u_has_texture > 0.5) {
    refracted = vec3(
      texture2D(u_texture, vec2(uv.x + offset.x * 1.08, 1.0 - (uv.y + offset.y * 1.08))).r,
      texture2D(u_texture, vec2(uv.x + offset.x, 1.0 - (uv.y + offset.y))).g,
      texture2D(u_texture, vec2(uv.x + offset.x * 0.92, 1.0 - (uv.y + offset.y * 0.92))).b
    );
  } else {
    // 没有照片时用中性渐变当底：偏移把渐变一起推歪，玻璃边缘就能看见弯折
    float shift = offset.y * 0.55;
    float base = clamp(1.0 - uv.y + shift, 0.0, 1.0);
    vec3 lightSide = mix(vec3(0.94, 0.95, 0.97), vec3(0.83, 0.85, 0.88), base);
    vec3 darkSide = mix(vec3(0.14, 0.15, 0.17), vec3(0.05, 0.06, 0.07), base);
    refracted = mix(lightSide, darkSide, u_dark) + vec3(offset.x * 0.28);
  }"""
)

edit(
    'src/components/base/IOSRippleShader.tsx',
    "    const uAmplitude = gl.getUniformLocation(program, 'u_amplitude')",
    """    const uAmplitude = gl.getUniformLocation(program, 'u_amplitude')
    const uDark = gl.getUniformLocation(program, 'u_dark')"""
)

edit(
    'src/components/base/IOSRippleShader.tsx',
    '      gl.uniform1f(uAmplitude, liveProps.current.amplitude)',
    """      gl.uniform1f(uAmplitude, liveProps.current.amplitude)
      if (uDark) {
        gl.uniform1f(
          uDark,
          document.body.hasAttribute('data-ds-dark-theme') || document.body.classList.contains('dark')
            ? 1
            : 0
        )
      }"""
)

edit(
    'src/components/chatInput/ChatInput.module.css',
    '  --glass-tint: rgba(255, 255, 255, 0.15);',
    '  --glass-tint: rgba(255, 255, 255, 0.05);'
)

edit(
    'src/components/chatInput/ChatInput.module.css',
    """[data-ds-dark-theme] .glassBackdrop {
  --glass-tint: rgba(8, 14, 26, 0.3);
}""",
    """[data-ds-dark-theme] .glassBackdrop {
  --glass-tint: rgba(12, 14, 18, 0.06);
}"""
)

edit(
    'src/app/chatThemes.css',
    '  --chat-input-film: linear-gradient(180deg, rgba(255, 255, 255, 0.20) 0%, rgba(255, 255, 255, 0.06) 46%, rgba(255, 255, 255, 0.12) 100%);',
    '  --chat-input-film: linear-gradient(180deg, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.02) 46%, rgba(255, 255, 255, 0.06) 100%);'
)

edit(
    'src/app/chatThemes.css',
    '  --chat-input-film: linear-gradient(180deg, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.02) 46%, rgba(255, 255, 255, 0.06) 100%);\n  --chat-input-text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);',
    '  --chat-input-film: linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.015) 46%, rgba(255, 255, 255, 0.04) 100%);\n  --chat-input-text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);'
)

write('src/services/videoFrames.ts', VIDEO_SERVICE)

edit(
    'src/components/chatInput/ChatInput.tsx',
    "import { ACCEPT, useUploads } from '../../services/attachments.js'",
    """import { ACCEPT, useUploads } from '../../services/attachments.js'
import { extractVideoFrames } from '../../services/videoFrames.js'"""
)

edit(
    'src/components/chatInput/ChatInput.tsx',
    """  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = addDraftFiles(sessionId, files, useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }""",
    """  const importVideo = async (video: File) => {
    showToast('正在抽取视频画面…')
    try {
      const key = useSettings.getState().apiKey ?? ''
      const frames = await extractVideoFrames(video)
      if (frames.length === 0) {
        showToast('这个视频抽不出画面，换一个试试')
        return
      }
      const error = addDraftFiles(sessionId, frames, key)
      if (error) {
        showToast(error)
        return
      }
      showToast(`已抽出 ${frames.length} 张画面帧，发送后模型会逐帧识别`)
    } catch {
      showToast('视频解码失败，换一个视频试试')
    }
  }

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const videos = files.filter((file) => file.type.startsWith('video/'))
    const rest = files.filter((file) => !file.type.startsWith('video/'))
    if (rest.length > 0) {
      const error = addDraftFiles(sessionId, rest, useSettings.getState().apiKey ?? '')
      if (error) {
        showToast(error)
      }
    }
    videos.forEach((video) => {
      void importVideo(video)
    })
  }"""
)

edit(
    'src/components/chatInput/ChatInput.tsx',
    '            accept={ACCEPT}',
    "            accept={`${ACCEPT},video/*`}"
)

print('done')
