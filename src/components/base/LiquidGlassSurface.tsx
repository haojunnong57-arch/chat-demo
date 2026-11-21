import clsx from 'clsx'
import { useRef, type CSSProperties, type FC, type ReactNode, type RefObject } from 'react'
import * as LiquidGlassModule from 'liquid-glass-react'
import { useTheme } from '../../app/theme.js'
import { useSettings } from '../../services/settings.js'
import styles from './LiquidGlassSurface.module.css'

type LiquidGlassProps = {
  children: ReactNode
  displacementScale?: number
  blurAmount?: number
  saturation?: number
  aberrationIntensity?: number
  elasticity?: number
  cornerRadius?: number
  mouseContainer?: RefObject<HTMLElement | null> | null
  className?: string
  padding?: string
  style?: CSSProperties
  overLight?: boolean
  mode?: 'standard' | 'polar' | 'prominent' | 'shader'
}

// 包本身同时提供 CJS/ESM，NodeNext 下把命名空间显式收口成组件，避免 JSX 类型误判
const LiquidGlass = (LiquidGlassModule as unknown as { default: FC<LiquidGlassProps> }).default

/**
 * 真实液态玻璃底材：rdev/liquid-glass-react 的位移折射 + backdrop 模糊。
 * 组件只作为背景层使用，内容仍由调用方正常排版，避免玻璃的弹性位移带着文字抖动。
 * 玻璃物理参数统一在这里收口，所有弹层、输入区、菜单和抽屉共享同一套质感。
 */
export const LiquidGlassSurface = ({
  radius = 24,
  className,
  mouseContainer,
  elasticity = 0.15,
  strength = 'regular',
  displacementScale = 70,
  tint,
}: {
  radius?: number
  className?: string
  /** 指向父容器时，整个父容器移动都会驱动折射；不传则只响应玻璃自身 */
  mouseContainer?: RefObject<HTMLElement | null>
  elasticity?: number
  /** 大面积面板用 strong，补一点磨砂保证文字可读 */
  strength?: 'regular' | 'strong'
  displacementScale?: number
  /** 半透明承托色；不传时用主题默认极淡 tint */
  tint?: string
}) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const theme = useTheme()
  const chatTheme = useSettings((state) => state.chatTheme)
  const glassOpacity = useSettings((state) => state.glassOpacity)

  // 通透度往右（更透明）→ 降低磨砂；往左 → 提高磨砂。非玻璃主题保持中等磨砂。
  const blurAmount =
    chatTheme === 'glass'
      ? Math.min(0.96, Math.max(0.3, 0.92 - glassOpacity * 0.64 + (strength === 'strong' ? 0.14 : 0)))
      : strength === 'strong'
        ? 0.62
        : 0.44
  const overLight = theme === 'light'

  return (
    <div
      ref={hostRef}
      className={clsx(styles.backdrop, className)}
      style={{ borderRadius: `${radius}px`, ['--glass-tint' as string]: tint }}
      aria-hidden
    >
      <LiquidGlass
        className={styles.layer}
        displacementScale={displacementScale}
        blurAmount={blurAmount}
        saturation={140}
        aberrationIntensity={2}
        elasticity={elasticity}
        cornerRadius={radius + 14}
        mode="standard"
        padding="0"
        mouseContainer={mouseContainer ?? hostRef}
        overLight={overLight}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: 'calc(100% + 72px)',
          height: 'calc(100% + 72px)',
        }}
      >
        <span className={styles.empty} />
      </LiquidGlass>
      <span className={styles.tint} />
    </div>
  )
}
