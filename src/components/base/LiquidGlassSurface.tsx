import clsx from 'clsx'
import { useLayoutEffect, useRef, useState, type CSSProperties, type FC, type ReactNode, type RefObject } from 'react'
import * as LiquidGlassModule from 'liquid-glass-react'
import { useTheme } from '../../app/theme.js'
import { useSettings } from '../../services/settings.js'
import { prefersReducedMotion } from '../../utils/motion.js'
import { IOSRippleShader } from './IOSRippleShader.js'
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
 * 真实液态玻璃底材：rdev/liquid-glass-react 的位移折射 + backdrop 模糊，
 * 上层叠一张物理水波画布（WebGL1 片元着色器折射，Canvas2D 兜底）。
 *
 * 组件只作为背景层使用，内容仍由调用方正常排版，避免玻璃的弹性位移带着文字抖动。
 * 玻璃物理参数统一在这里收口，所有弹层、输入区、菜单和抽屉共享同一套质感。
 *
 * 通透度与波幅联动：越通透折射偏移越明显；blurAmount 控制在包的真实单位
 * 0.018–0.24，不再退回 0.3–0.92 的强磨砂把背景糊住。
 */
export const LiquidGlassSurface = ({
  radius = 24,
  className,
  mouseContainer,
  elasticity = 0.15,
  strength = 'regular',
  displacementScale,
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
  const chatBackground = useSettings((state) => state.chatBackground)
  const enhancedMotion = useSettings((state) => state.enhancedMotion)

  const isGlassTheme = chatTheme === 'glass'
  // 系统减弱动态效果 / 省电 / 用户关闭增强动画：不注入波源，只保留静态高光
  const reduced = prefersReducedMotion() || !enhancedMotion
  const rippleEnabled = isGlassTheme && !reduced

  const [backgroundImage, setBackgroundImage] = useState<string | null>(null)

  // 复制聊天背景供水波画布采样：优先自定义背景，其次主题根节点的 computed 背景。
  // 渐变背景没有可加载的 URL，着色器退化为高光波纹，不伪造贴图。
  useLayoutEffect(() => {
    if (!isGlassTheme) {
      setBackgroundImage(null)
      return
    }
    if (chatBackground) {
      setBackgroundImage(`url(${chatBackground})`)
      return
    }
    const root = document.querySelector(`[data-chat-theme="${chatTheme}"]`)
    if (root) {
      const computed = getComputedStyle(root)
      const bg = computed.backgroundImage
      setBackgroundImage(bg && bg !== 'none' ? bg : null)
    } else {
      setBackgroundImage(null)
    }
  }, [chatBackground, chatTheme, isGlassTheme])

  // 通透度：右端更清、左端更雾；幅度控制在包的真实单位里，不能再把折射糊掉
  const blurAmount = isGlassTheme
    ? Math.min(0.24, Math.max(0.018, 0.02 + (1 - glassOpacity) * 0.22 + (strength === 'strong' ? 0.02 : 0)))
    : strength === 'strong'
      ? 0.12
      : 0.075
  // 越通透，折射越明显；light 主题下包会把 displacement 减半，所以基线抬高
  const refractionScale =
    displacementScale ??
    (isGlassTheme ? Math.round((48 + glassOpacity * 86) * (strength === 'strong' ? 0.92 : 1)) : 42)
  const overLight = theme === 'light'
  // 大面积面板降低波幅，避免文字区随水面抖动
  const amplitude = strength === 'strong' ? 0.8 : 1

  return (
    <div
      ref={hostRef}
      className={clsx(styles.backdrop, className)}
      style={{ borderRadius: `${radius}px`, ['--glass-tint' as string]: tint }}
      aria-hidden
    >
      {rippleEnabled ? (
        <IOSRippleShader
          hostRef={hostRef}
          backgroundImage={backgroundImage}
          enabled
          clarity={glassOpacity}
          amplitude={amplitude}
        />
      ) : null}
      {isGlassTheme ? (
        <>
          <span className={styles.caustic} />
          <span className={styles.edge} />
        </>
      ) : null}
      <LiquidGlass
        className={styles.layer}
        displacementScale={refractionScale}
        blurAmount={blurAmount}
        saturation={isGlassTheme ? 165 : 140}
        aberrationIntensity={isGlassTheme ? 2.4 : 1.4}
        elasticity={elasticity}
        cornerRadius={radius + 14}
        mode={isGlassTheme ? 'prominent' : 'standard'}
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
