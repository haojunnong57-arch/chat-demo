import clsx from 'clsx'
import type { ButtonHTMLAttributes } from 'react'
import { useTiltCard } from '../../utils/motion.js'
import styles from './TiltCard.module.css'

/**
 * 可点击卡片：跟随触摸位置做克制的 3D 透视倾斜，并叠加一层随手指移动的径向流光；
 * 松手后由 CSS Spring 曲线回正。系统开启「减弱动态效果」时自动退化为普通按压。
 */
export const TiltCard = ({
  className,
  children,
  max = 7,
  lift = 1.015,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { max?: number; lift?: number }) => {
  const ref = useTiltCard<HTMLButtonElement>({ max, lift })
  return (
    <button ref={ref} type="button" className={clsx(styles.tilt, className)} {...rest}>
      {children}
    </button>
  )
}
