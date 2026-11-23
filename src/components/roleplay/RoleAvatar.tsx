import clsx from 'clsx'
import type { CSSProperties } from 'react'
import type { RoleCard } from '../../services/roleplay/types.js'
import styles from './RoleAvatar.module.css'

/** 角色头像：有自定义图就用图，没有就用强调色渐变 + 首字。 */
export const RoleAvatar = ({
  card,
  size = 'medium',
  className,
}: {
  card: RoleCard
  size?: 'small' | 'medium' | 'large'
  className?: string
}) => (
  <div
    className={clsx(
      styles.avatar,
      size === 'small' && styles.small,
      size === 'large' && styles.large,
      className
    )}
    style={{ '--role-accent': `linear-gradient(135deg, ${card.accent}, ${card.accent}99)` } as CSSProperties}
    aria-hidden
  >
    {card.avatar ? <img src={card.avatar} alt="" draggable={false} /> : card.initial}
  </div>
)
