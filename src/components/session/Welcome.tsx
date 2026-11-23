import clsx from 'clsx'
import type { CSSProperties } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const chatTheme = useSettings((state) => state.chatTheme)
  const chatBackground = useSettings((state) => state.chatBackground)
  const glassOpacity = useSettings((state) => state.glassOpacity)
  return (
    <div
      className={clsx(
        styles.container,
        `chat-theme-${chatTheme}`,
        chatBackground && styles.withBackground
      )}
      style={
        {
          ...(chatBackground ? { backgroundImage: `url(${chatBackground})` } : null),
          '--glass-fill': `${(0.34 - glassOpacity * 0.29).toFixed(3)}`,
          '--glass-blur': `${Math.round(6 + (1 - glassOpacity) * 26)}px`,
        } as CSSProperties
      }
    >
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <div className={styles.greeting}>{t('welcomeMessageChat250808')}</div>
        <ChatInput sessionId={null} />
      </div>
    </div>
  )
}
