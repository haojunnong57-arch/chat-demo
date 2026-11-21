/**
 * 把相册图片压到适合做聊天背景的尺寸，输出 JPEG data URL。
 * 过大的原图直接放进 localStorage 会很快超出配额。
 */
export const imageFileToBackground = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('not an image'))
      return
    }
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      try {
        const max = 1600
        const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight))
        const width = Math.max(1, Math.round(image.naturalWidth * scale))
        const height = Math.max(1, Math.round(image.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) {
          throw new Error('canvas unavailable')
        }
        context.drawImage(image, 0, 0, width, height)
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url)
            if (!blob) {
              reject(new Error('encode failed'))
              return
            }
            const reader = new FileReader()
            reader.onload = () =>
              typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('read failed'))
            reader.onerror = () => reject(reader.error ?? new Error('read failed'))
            reader.readAsDataURL(blob)
          },
          'image/jpeg',
          0.82
        )
      } catch (error) {
        URL.revokeObjectURL(url)
        reject(error instanceof Error ? error : new Error('image failed'))
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('decode failed'))
    }
    image.src = url
  })

/**
 * 头像只需要几十像素，压到 264px 以内，避免 data URL 撑爆 localStorage。
 */
export const imageFileToAvatar = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('not an image'))
      return
    }
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      try {
        const max = 264
        const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight))
        const width = Math.max(1, Math.round(image.naturalWidth * scale))
        const height = Math.max(1, Math.round(image.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) {
          throw new Error('canvas unavailable')
        }
        context.drawImage(image, 0, 0, width, height)
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url)
            if (!blob) {
              reject(new Error('encode failed'))
              return
            }
            const reader = new FileReader()
            reader.onload = () =>
              typeof reader.result === 'string'
                ? resolve(reader.result)
                : reject(new Error('read failed'))
            reader.onerror = () => reject(reader.error ?? new Error('read failed'))
            reader.readAsDataURL(blob)
          },
          'image/jpeg',
          0.86
        )
      } catch (error) {
        URL.revokeObjectURL(url)
        reject(error instanceof Error ? error : new Error('image failed'))
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('decode failed'))
    }
    image.src = url
  })
