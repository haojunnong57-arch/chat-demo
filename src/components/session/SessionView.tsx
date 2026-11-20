import clsx from 'clsx'
import { useEffect, useRef } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { useSettings } from '../../services/settings.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { getReplyText } from '../../services/chat/reply.js'
import { describeReadAloudError, startReadAloud } from '../../services/speech/readAloud.js'
import { showToast } from '../base/toastState.js'
import { AutoReadButton } from './AutoReadButton.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  const chatBackground = useSettings((state) => state.chatBackground)
  const chatTheme = useSettings((state) => state.chatTheme)
  const autoRead = useSettings((state) => state.autoRead)
  const previousStreaming = useRef(streaming)

  useEffect(() => {
    const wasStreaming = previousStreaming.current
    previousStreaming.current = streaming
    if (!wasStreaming || streaming || !autoRead) {
      return
    }
    const messages = getVisibleMessages(session)
    const last = messages.at(-1)
    if (last?.role !== 'assistant' || last.status !== 'done') {
      return
    }
    const text = getReplyText(last).trim()
    if (text) {
      startReadAloud(last.id, text, (error) => showToast(describeReadAloudError(error)))
    }
  }, [autoRead, session, streaming])

  return (
    <div
      className={clsx(
        styles.view,
        `chat-theme-${chatTheme}`,
        chatBackground && styles.withBackground
      )}
      data-chat-theme={chatTheme}
      style={chatBackground ? { backgroundImage: `url(${chatBackground})` } : undefined}
    >
      {isMobile ? (
        <MobileHeader title={title} streaming={streaming} chatTheme={chatTheme} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          <div className={styles.headerActions}>
            <AutoReadButton />
          </div>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
    </div>
  )
}
