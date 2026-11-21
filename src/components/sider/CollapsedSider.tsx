import { IconPanelLeftOutline16, NewChatIcon } from '../base/icons.js'
import { useRef } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { LiquidGlassSurface } from '../base/LiquidGlassSurface.js'
import styles from './Sider.module.css'

/** 收起后左上角的按钮组 */
export const CollapsedSider = () => {
  const t = useTranslate()
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div className={styles.collapsed}>
      <div ref={ref} className={styles.collapsedGroup}>
        <LiquidGlassSurface
          radius={999}
          elasticity={0.18}
          mouseContainer={ref}
          tint="color-mix(in srgb, var(--dsw-alias-bg-layer-3) 42%, transparent)"
        />
        <IconButton
          size="m"
          tone="primary"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('expandSiderbarButton')}
          onClick={() => setSiderCollapsed(false)}
        />
        <IconButton
          size="m"
          tone="primary"
          icon={<NewChatIcon />}
          tooltip={t('newChat')}
          onClick={newChat}
        />
      </div>
    </div>
  )
}
