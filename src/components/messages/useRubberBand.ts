import { useEffect, type RefObject } from 'react'

/**
 * iOS 风格橡皮筋：
 * - 内容不足一屏时接管纵向拖拽，内容跟手越界，松手用阻尼弹簧回原位；
 * - 内容超过一屏后不抢普通滚动，只在顶部下拉 / 底部上拉时接管越界，手感一致；
 * - 只写 transform，不触发重排；不派发滚动、分页或刷新。
 */
export const useRubberBand = (
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  layoutKey: boolean | string = ''
) => {
  useEffect(() => {
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!scroll || !content) {
      return
    }

    const LIMIT = 92
    const RESISTANCE = 0.56
    let startY = 0
    let startX = 0
    let startScrollTop = 0
    let lastY = 0
    let lastTime = 0
    let offset = 0
    let velocity = 0
    let potential = false
    let dragging = false
    let suppressClick = false
    let springFrame = 0
    let springStartedAt = 0
    let springVelocity = 0

    const underfilled = () => scroll.scrollHeight <= scroll.clientHeight + 1

    const isInteractive = (target: EventTarget | null) => {
      if (!(target instanceof Element)) {
        return false
      }
      return Boolean(
        target.closest(
          'input, textarea, select, button, a, [contenteditable="true"], pre, code, table, [data-no-rubber]'
        )
      )
    }

    const stopSpring = () => {
      if (springFrame) {
        cancelAnimationFrame(springFrame)
        springFrame = 0
      }
    }

    const write = (value: number) => {
      offset = value
      content.style.transform = value === 0 ? '' : `translate3d(0, ${value.toFixed(2)}px, 0)`
      content.style.setProperty('--rubber-progress', Math.min(1, Math.abs(value) / LIMIT).toFixed(3))
    }

    // 每帧最多写一次：touchmove 频率可达 120Hz，逐条写会抖成重影
    let pendingValue = 0
    let writeFrame = 0
    const scheduleWrite = (value: number) => {
      pendingValue = value
      if (writeFrame) {
        return
      }
      writeFrame = requestAnimationFrame(() => {
        writeFrame = 0
        write(pendingValue)
      })
    }

    // 真弹簧积分：略微欠阻尼，松手会自然回正，不果冻也不拖尾。
    const springBack = () => {
      stopSpring()
      springStartedAt = performance.now()
      springVelocity = Math.max(-900, Math.min(900, velocity * 1000))
      let x = offset
      let v = springVelocity
      let previous = springStartedAt
      const stiffness = 168
      const damping = 25

      const tick = (now: number) => {
        const dt = Math.min(0.032, Math.max(0.001, (now - previous) / 1000))
        previous = now
        const acceleration = -stiffness * x - damping * v
        v += acceleration * dt
        x += v * dt
        write(x)
        if ((Math.abs(x) < 0.45 && Math.abs(v) < 6) || now - springStartedAt > 950) {
          write(0)
          content.removeAttribute('data-rubber')
          content.style.willChange = ''
          content.style.removeProperty('backface-visibility')
          offset = 0
          velocity = 0
          springFrame = 0
          return
        }
        springFrame = requestAnimationFrame(tick)
      }
      springFrame = requestAnimationFrame(tick)
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || isInteractive(event.target)) {
        potential = false
        return
      }
      if (!window.getSelection()?.isCollapsed) {
        potential = false
        return
      }
      const touch = event.touches[0]
      startY = touch.clientY
      startX = touch.clientX
      startScrollTop = scroll.scrollTop
      lastY = touch.clientY
      lastTime = event.timeStamp || performance.now()
      velocity = 0
      potential = true
      dragging = false
      stopSpring()
      content.style.willChange = 'transform'
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!potential || event.touches.length !== 1) {
        return
      }
      const touch = event.touches[0]
      const dy = touch.clientY - startY
      const dx = touch.clientX - startX
      if (!dragging) {
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) {
          potential = false
          content.style.willChange = ''
          return
        }
        if (Math.abs(dy) < 5) {
          return
        }
        const filled = !underfilled()
        const atTop = startScrollTop <= 0.5
        const atBottom =
          startScrollTop + scroll.clientHeight >= scroll.scrollHeight - 0.5
        // 有滚动空间时只在边界朝外拉；普通滚动完全不接管
        if (filled && !((atTop && dy > 0) || (atBottom && dy < 0))) {
          potential = false
          content.style.willChange = ''
          return
        }
        dragging = true
        content.dataset.rubber = 'true'
        content.style.backfaceVisibility = 'hidden'
        content.style.transform = 'translate3d(0, 0, 0)'
      }
      event.preventDefault()
      const resisted = (dy >= 0 ? 1 : -1) * LIMIT * (1 - Math.exp((-Math.abs(dy) * RESISTANCE) / LIMIT))
      scheduleWrite(resisted)
      const now = event.timeStamp || performance.now()
      const dt = Math.max(1, now - lastTime)
      velocity = velocity * 0.72 + ((touch.clientY - lastY) / dt) * 0.28
      lastY = touch.clientY
      lastTime = now
    }

    const finish = (event: TouchEvent) => {
      if (!dragging) {
        potential = false
        return
      }
      event.preventDefault()
      dragging = false
      potential = false
      suppressClick = true
      window.setTimeout(() => {
        suppressClick = false
      }, 0)
      springBack()
    }

    const onClickCapture = (event: MouseEvent) => {
      if (!suppressClick) {
        return
      }
      suppressClick = false
      event.preventDefault()
      event.stopPropagation()
    }

    const updateTouchAction = () => {
      if (underfilled()) {
        scroll.dataset.rubberEnabled = 'true'
      } else {
        delete scroll.dataset.rubberEnabled
      }
    }

    updateTouchAction()
    const observer = new ResizeObserver(updateTouchAction)
    observer.observe(scroll)
    observer.observe(content)
    scroll.addEventListener('touchstart', onTouchStart, { passive: true })
    scroll.addEventListener('touchmove', onTouchMove, { passive: false })
    scroll.addEventListener('touchend', finish, { passive: false })
    scroll.addEventListener('touchcancel', finish, { passive: false })
    content.addEventListener('click', onClickCapture, true)

    return () => {
      stopSpring()
      observer.disconnect()
      scroll.removeEventListener('touchstart', onTouchStart)
      scroll.removeEventListener('touchmove', onTouchMove)
      scroll.removeEventListener('touchend', finish)
      scroll.removeEventListener('touchcancel', finish)
      content.removeEventListener('click', onClickCapture, true)
      content.removeAttribute('data-rubber')
      content.style.removeProperty('transform')
      content.style.removeProperty('--rubber-progress')
      content.style.willChange = ''
      content.style.removeProperty('backface-visibility')
      delete scroll.dataset.rubberEnabled
    }
  }, [scrollRef, contentRef, layoutKey])
}
