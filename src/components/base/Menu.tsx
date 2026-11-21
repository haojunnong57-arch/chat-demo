import clsx from 'clsx'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from './anchored.js'
import { LiquidGlassSurface } from './LiquidGlassSurface.js'
import { prefersReducedMotion, SPRING } from '../../utils/motion.js'
import styles from './Menu.module.css'

export type MenuOption = {
  key: string
  label: string
  icon: ReactNode
  danger?: boolean
  onSelect: () => void
}

/**
 * 点击触发，向下展开；点外部或 Esc 关闭。
 * 展开时从触发胶囊的真实尺寸/圆角流体形变到面板（Fluid Morph），
 * 收起时反向收缩，随时可被打断。
 */
export const Menu = ({
  options,
  children,
}: {
  options: MenuOption[]
  children: (props: { open: boolean; toggle: () => void }) => ReactNode
}) => {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closingRef = useRef(false)
  // 左侧对齐并再左移 5px，让菜单文字与触发元素图标对齐
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { align: 'start', alignOffset: -5, offset: 4 }
  )

  const finishClose = () => {
    closingRef.current = false
    setClosing(false)
    setOpen(false)
  }

  const close = () => {
    if (!open || closingRef.current) {
      return
    }
    if (prefersReducedMotion()) {
      finishClose()
      return
    }
    closingRef.current = true
    setClosing(true)
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
    }
    closeTimer.current = setTimeout(finishClose, 170)
  }

  useDismiss(open, [anchorRef, floatingRef], close)

  useEffect(
    () => () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current)
      }
    },
    []
  )

  // 打开：从胶囊按钮的矩形与圆角出发，做尺寸 + 圆角的流体形变
  useLayoutEffect(() => {
    if (!open) {
      return
    }
    const anchor = anchorRef.current
    const panel = floatingRef.current
    if (!anchor || !panel || prefersReducedMotion()) {
      return
    }
    const a = anchor.getBoundingClientRect()
    const b = panel.getBoundingClientRect()
    if (b.width === 0 || b.height === 0) {
      return
    }
    const sx = Math.max(0.24, a.width / b.width)
    const sy = Math.max(0.2, a.height / b.height)
    const dx = a.left + a.width / 2 - (b.left + b.width / 2)
    const dy = a.top + a.height / 2 - (b.top + b.height / 2)
    panel.animate(
      [
        {
          transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`,
          borderRadius: `${Math.min(22, a.height / 2)}px`,
          opacity: 0.5,
          filter: 'blur(5px)',
        },
        {
          transform: 'translate3d(0, 0, 0) scale(1, 1)',
          borderRadius: '12px',
          opacity: 1,
          filter: 'blur(0px)',
        },
      ],
      { duration: 320, easing: SPRING, fill: 'both' }
    )
  }, [anchorRef, floatingRef, open, position])

  return (
    <>
      <span ref={anchorRef} className={styles.anchor}>
        {children({ open, toggle: () => (open ? close() : setOpen(true)) })}
      </span>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={clsx(styles.menu, closing && styles.menuClosing)}
              style={position ?? undefined}
              role="menu"
            >
              <LiquidGlassSurface
                radius={12}
                elasticity={0.15}
                mouseContainer={floatingRef}
                tint="color-mix(in srgb, var(--dsw-specific-menu) 44%, transparent)"
              />
              {options.map((option, index) => (
                <div
                  key={option.key}
                  role="menuitem"
                  tabIndex={0}
                  className={clsx(styles.option, option.danger && styles.danger)}
                  style={{ ['--option-index' as string]: String(index) }}
                  onClick={() => {
                    close()
                    option.onSelect()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      close()
                      option.onSelect()
                    }
                  }}
                >
                  <span className={styles.icon}>{option.icon}</span>
                  {option.label}
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
