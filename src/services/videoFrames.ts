const MAX_FRAMES = 6
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
