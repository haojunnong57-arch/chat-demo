import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconPanelLeftOutline16, IconSettingsOutline16, NewChatIcon } from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { LiquidGlassSurface } from '../base/LiquidGlassSurface.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const rootRef = useRef<HTMLDivElement>(null)
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div ref={rootRef} className={clsx(styles.sider, mobile && styles.mobile)}>
      {mobile ? (
        <LiquidGlassSurface
          radius={0}
          strength="strong"
          elasticity={0.04}
          mouseContainer={rootRef}
          tint="color-mix(in srgb, var(--dsw-alias-bg-layer-3) 58%, transparent)"
        />
      ) : null}
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          newChat()
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {groups.map((group) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeId}
                  onDelete={() => setDeleting(session)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.bottom}>
        <button
          type="button"
          className={styles.settings}
          onClick={() => {
            openSettings('general')
            // 移动端从抽屉里打开设置时先收起抽屉，避免磨砂面板后面一半是抽屉白底
            if (mobile) {
              closeMobileSider()
            }
          }}
        >
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  stopReadAloud()
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
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

/** 移动端抽屉：浮在页面上方，点空白区域关闭；横滑手势期间按跟手进度内联定位。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  const dragProgress = useMobileSider((state) => state.dragProgress)
  const dragging = dragProgress !== null
  // 关闭时先播反向动画再卸载，避免抽屉「闪一下消失」
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open || dragging) {
      setMounted(true)
      setClosing(false)
      const frame = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(frame)
    }
    setVisible(false)
    if (!mounted) {
      return
    }
    setClosing(true)
    const timer = setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [open, dragging, mounted])

  if (!mounted) {
    return null
  }

  const progress = dragProgress === null ? 0 : Math.min(1, Math.max(0, dragProgress))
  const drawerStyle =
    dragProgress === null
      ? undefined
      : {
          transform: `translate3d(${(progress - 1) * 100}%, 0, 0) scale(${0.985 + 0.015 * progress})`,
        }
  const maskStyle = dragProgress === null ? undefined : { opacity: progress }

  return (
    <>
      <div
        className={clsx(
          styles.drawerMask,
          visible && styles.drawerMaskVisible,
          dragging && styles.drawerMaskDragging,
        )}
        style={maskStyle}
        onClick={() => {
          // 横滑手势刚结束时浏览器可能补发合成 click；跟手进度尚未清空前忽略，避免误关抽屉
          if (useMobileSider.getState().dragProgress !== null) {return}
          closeMobileSider()
        }}
      />
      <div
        className={clsx(
          styles.drawer,
          visible && styles.drawerVisible,
          closing && styles.drawerClosing,
          dragging && styles.drawerDragging,
        )}
        style={drawerStyle}
        role="dialog"
        aria-modal="true"
      >
        <Sider mobile />
      </div>
    </>
  )
}
