import { IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import type { ReactNode } from 'react'
import { AutoReadButton } from './AutoReadButton.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'
import clsx from 'clsx'

/** 移动端顶栏：左侧菜单打开侧边栏；会话页再显示标题、输入状态与开启新对话 */
export const MobileHeader = ({
  title,
  streaming = false,
  chatTheme = 'default',
  actions,
}: {
  title?: string
  streaming?: boolean
  chatTheme?: string
  /** 标题栏右侧额外操作（例如删除当前对话） */
  actions?: ReactNode
}) => {
  const t = useTranslate()
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      {title === undefined ? null : (
        <>
          <div className={styles.titleWrap}>
            <div className={styles.title}>{title}</div>
            {chatTheme === 'imessage' || chatTheme === 'wechat' || chatTheme === 'instagram' ? (
              <div
                className={clsx(
                  styles.status,
                  streaming && styles.statusActive,
                  chatTheme === 'instagram' && !streaming && styles.statusActive
                )}
                aria-live="polite"
              >
                {streaming ? (
                  <>
                    <span className={styles.statusDots} aria-hidden>
                      <i />
                      <i />
                      <i />
                    </span>
                    {t(chatTheme === 'wechat' ? 'wechatTypingStatus' : 'typingStatus')}
                  </>
                ) : chatTheme === 'instagram' ? (
                  t('instagramActiveStatus')
                ) : null}
              </div>
            ) : null}
          </div>
          <IconButton
            size="xl"
            tone="primary"
            icon={<IconNewChatOutline20 />}
            aria-label={t('newChat')}
            onClick={newChat}
          />
          <div className={styles.actions}>
            {actions}
            <AutoReadButton />
          </div>
        </>
      )}
    </div>
  )
}
