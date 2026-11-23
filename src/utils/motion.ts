import { useEffect, useRef } from 'react'
import { useSettings } from '../services/settings.js'

/** 是否要求减少装饰性动效（系统「减弱动态效果」或省电模式） */
export const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  if (media?.matches) {
    return true
  }
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return connection?.saveData === true
}

/** Apple 风格的弹簧曲线：可中断、无回弹过冲 */
export const SPRING = 'cubic-bezier(0.22, 1.16, 0.36, 1)'

type TiltOptions = {
  /** 最大倾角（度），建议 6–8 */
  max?: number
  /** 按下时的轻微放大 */
  lift?: number
}

/**
 * 卡片跟随触摸位置的 3D 透视倾斜与径向流光。
 * 只写入 CSS 变量和 transform，不触发重排；松手由 CSS transition 做 Spring 回正。
 * 手指/鼠标离开、取消、滚动时立即复位，保证动画随时可打断。
 */
export const useTiltCard = <T extends HTMLElement = HTMLDivElement>({
  max = 7,
  lift = 1.015,
}: TiltOptions = {}) => {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) {
      return
    }
    let frame = 0
    let active = false

    const write = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      const px = (event.clientX - rect.left) / Math.max(1, rect.width)
      const py = (event.clientY - rect.top) / Math.max(1, rect.height)
      const x = Math.min(1, Math.max(0, px))
      const y = Math.min(1, Math.max(0, py))
      el.style.setProperty('--tilt-x', `${(0.5 - y) * max * 2}deg`)
      el.style.setProperty('--tilt-y', `${(x - 0.5) * max * 2}deg`)
      el.style.setProperty('--sheen-x', `${x * 100}%`)
      el.style.setProperty('--sheen-y', `${y * 100}%`)
      el.style.setProperty('--lift', `${lift}`)
    }

    const onMove = (event: PointerEvent) => {
      if (!active) {
        return
      }
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => write(event))
    }

    const stop = () => {
      active = false
      cancelAnimationFrame(frame)
      el.removeAttribute('data-tilting')
      el.style.setProperty('--tilt-x', '0deg')
      el.style.setProperty('--tilt-y', '0deg')
      el.style.setProperty('--lift', '1')
    }

    const start = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return
      }
      active = true
      el.setAttribute('data-tilting', 'true')
      write(event)
    }

    el.addEventListener('pointerdown', start, { passive: true })
    el.addEventListener('pointermove', onMove, { passive: true })
    el.addEventListener('pointerup', stop, { passive: true })
    el.addEventListener('pointercancel', stop, { passive: true })
    el.addEventListener('pointerleave', stop, { passive: true })
    window.addEventListener('scroll', stop, { passive: true, capture: true })
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('pointerdown', start)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', stop)
      el.removeEventListener('pointercancel', stop)
      el.removeEventListener('pointerleave', stop)
      window.removeEventListener('scroll', stop, true)
    }
  }, [lift, max])

  return ref
}

/**
 * 只在系统「减弱动态效果」或低电量时收掉装饰性动效（倾斜、流光、呼吸）。
 * 「增强动画」开关只负责液态玻璃的水波纹，不再连带关闭普通 UI 交互动画。
 */
export const setupMotionPreference = () => {
  const root = document.documentElement
  const apply = () => {
    const reduced = prefersReducedMotion()
    if (reduced) {
      root.dataset.motion = 'reduced'
    } else {
      delete root.dataset.motion
    }
  }
  apply()
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  media?.addEventListener('change', apply)
  useSettings.subscribe(apply)

  const batteryApi = navigator as Navigator & {
    getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (type: string, listener: () => void) => void }>
  }
  batteryApi.getBattery?.().then((battery) => {
    const sync = () => {
      if (battery.level <= 0.2 && !battery.charging) {
        root.dataset.motion = 'reduced'
      } else {
        delete root.dataset.motion
      }
    }
    sync()
    battery.addEventListener('levelchange', sync)
    battery.addEventListener('chargingchange', sync)
  }).catch(() => undefined)
}
