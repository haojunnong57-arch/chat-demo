import clsx from 'clsx'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { useSettings } from '../../services/settings.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { getReplyText } from '../../services/chat/reply.js'
import { describeReadAloudError, startReadAloud, stopReadAloud } from '../../services/speech/readAloud.js'
import { showToast } from '../base/toastState.js'
import { removeSession } from '../../services/chat/store.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconEllipsisOutline16, IconTrashOutline16 } from '../base/icons.js'
import { Menu } from '../base/Menu.js'
import { Modal } from '../base/Modal.js'
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
  const glassOpacity = useSettings((state) => state.glassOpacity)
  const autoRead = useSettings((state) => state.autoRead)
  const previousStreaming = useRef(streaming)
  // 聊天页内的删除入口：不必回到侧栏也能删除当前对话
  const [deleting, setDeleting] = useState(false)
  const [deletePending, setDeletePending] = useState(false)

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
      style={
        {
          ...(chatBackground ? { backgroundImage: `url(${chatBackground})` } : null),
          // 通透度滑块：越大越通透，填充更少、模糊更轻
          '--glass-fill': `${(0.44 - glassOpacity * 0.18).toFixed(3)}`,
          '--glass-blur': `${Math.round(18 + (1 - glassOpacity) * 20)}px`,
        } as CSSProperties
      }
    >
      {isMobile ? (
        <MobileHeader
          title={title}
          streaming={streaming}
          chatTheme={chatTheme}
          actions={
            <Menu
              options={[
                {
                  key: 'delete',
                  label: t('delete'),
                  icon: <IconTrashOutline16 />,
                  danger: true,
                  onSelect: () => setDeleting(true),
                },
              ]}
            >
              {({ toggle }) => (
                <IconButton
                  icon={<IconEllipsisOutline16 />}
                  aria-label={t('more')}
                  onClick={toggle}
                />
              )}
            </Menu>
          }
        />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          <div className={styles.headerActions}>
            <Menu
              options={[
                {
                  key: 'delete',
                  label: t('delete'),
                  icon: <IconTrashOutline16 />,
                  danger: true,
                  onSelect: () => setDeleting(true),
                },
              ]}
            >
              {({ toggle }) => (
                <IconButton
                  icon={<IconEllipsisOutline16 />}
                  aria-label={t('more')}
                  onClick={toggle}
                />
              )}
            </Menu>
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
          </div>
        }
      />
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(false)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  stopReadAloud()
                  try {
                    if (await removeSession(session.id)) {
                      setDeleting(false)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {deletePending ? t('historyDeleting') : t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}
