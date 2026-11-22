import { useEffect, useState } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { SessionInstructionsDialog } from '../components/session/SessionInstructionsDialog.js'
import { ensureApiKey } from '../components/settings/settingsDialogState.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { Onboarding } from '../components/onboarding/Onboarding.js'
import { Activate } from '../components/activate/Activate.js'
import { license } from '../services/license.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { loadMcp } from '../services/mcp/store.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import {
  closeMobileSider,
  openMobileSider,
  setMobileSiderDrag,
  useMobileSider,
} from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import styles from './App.module.css'

/** 左缘右滑打开抽屉；抽屉打开时在抽屉/遮罩区域左滑关闭。 */
const EDGE_WIDTH = 24 // 起手识别的左缘宽度（px）
const SNAP_RATIO = 0.5 // 位移超过抽屉行程一半即吸附到位
const FLING_VELOCITY = 0.25 // px/ms，快速轻扫即使位移不足也吸附
const AXIS_SLOP = 8 // 方向锁定前的轴向容差（px）

/**
 * 跟手横滑手势：抽屉随手指位移实时 translateX，遮罩透明度随进度渐变；
 * 过阈值或快速 fling 吸附到位，未达阈值回弹。纵滑一律放弃，交回原生滚动。
 * 监听全部 passive，不拦截聊天区长按语音等原生手势；仅移动端启用。
 */
const useEdgeSwipe = () => {
  const isMobile = useIsMobile()

  useEffect(() => {
    if (!isMobile) {return}

    let tracking = false
    let locked: 'horizontal' | 'vertical' | null = null
    let mode: 'open' | 'close' = 'open'
    let startX = 0
    let startY = 0
    let lastX = 0
    let lastTime = 0
    let velocity = 0

    // 抽屉宽度与 .mobile 一致：300px，窄屏留 48px 边距
    const travel = () => Math.min(300, window.innerWidth - 48)

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {return}
      const touch = event.touches[0]
      const drawerOpen = useMobileSider.getState().open
      // 抽屉关闭：只认左缘起手；抽屉打开：抽屉/遮罩内任意位置都可左滑关闭
      if (!drawerOpen && touch.clientX > EDGE_WIDTH) {return}
      tracking = true
      locked = null
      mode = drawerOpen ? 'close' : 'open'
      startX = lastX = touch.clientX
      startY = touch.clientY
      lastTime = Date.now()
      velocity = 0
    }

    const onMove = (event: TouchEvent) => {
      if (!tracking) {return}
      const touch = event.touches[0]
      if (!touch) {return}
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (locked === null) {
        // 先锁定轴向：纵滑交给原生滚动，本次手势直接放弃
        if (Math.abs(dy) > Math.abs(dx) + AXIS_SLOP) {
          tracking = false
          return
        }
        if (Math.abs(dx) <= Math.abs(dy) + AXIS_SLOP) {return}
        locked = 'horizontal'
        // 进入横滑后挂载抽屉并写入初始进度（打开侧 0，关闭侧 1）
        setMobileSiderDrag(mode === 'close' ? 1 : 0)
      } else if (locked === 'vertical') {
        return
      }

      const now = Date.now()
      const dt = now - lastTime
      if (dt > 0) {
        velocity = (touch.clientX - lastX) / dt
      }
      lastX = touch.clientX
      lastTime = now

      const ratio = dx / travel()
      const progress =
        mode === 'close'
          ? Math.min(1, Math.max(0, 1 + ratio))
          : Math.min(1, Math.max(0, ratio))
      setMobileSiderDrag(progress)
    }

    const finish = () => {
      if (!tracking) {return}
      tracking = false
      if (locked !== 'horizontal') {
        setMobileSiderDrag(null)
        return
      }
      const dx = lastX - startX
      const progress = useMobileSider.getState().dragProgress ?? (mode === 'close' ? 1 : 0)
      // 打开侧：过半或快速右滑 → 展开，否则回弹关闭；关闭侧：不足一半或快速左滑 → 关闭，否则回弹展开
      const snapOpen =
        mode === 'open'
          ? progress >= SNAP_RATIO || (dx > 0 && velocity > FLING_VELOCITY)
          : !(progress <= SNAP_RATIO || (dx < 0 && velocity < -FLING_VELOCITY))
      if (snapOpen) {
        openMobileSider()
      } else {
        closeMobileSider()
      }
      // 下一帧再清跟手进度，交回 CSS 吸附动画，避免内联样式与类动画打架
      requestAnimationFrame(() => setMobileSiderDrag(null))
    }

    const onCancel = () => {
      tracking = false
      locked = null
      setMobileSiderDrag(null)
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', finish, { passive: true })
    document.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', finish)
      document.removeEventListener('touchcancel', onCancel)
    }
  }, [isMobile])
}

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  // 激活门：未激活时只显示激活页，挡住聊天主界面
  const [activated, setActivated] = useState(() => license.isActivated())
  useEffect(() => {
    const onChange = () => setActivated(license.isActivated())
    window.addEventListener('chat-demo:license-activated', onChange)
    return () => window.removeEventListener('chat-demo:license-activated', onChange)
  }, [])
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)

  usePreventPageScroll(isMobile)
  useEdgeSwipe()

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  useEffect(() => {
    void initChat()
    loadMcp()
    // 首次打开先在设置里输入 API Key
    ensureApiKey()
  }, [])

  if (!activated) {
    return <Activate />
  }

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? <MobileSider /> : siderCollapsed ? null : <Sider />}
        <main className={styles.main}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {!ready || (activeId !== null && !session) ? (
              <div className={styles.loadingView}>
                {isMobile ? <MobileHeader /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <span>
                    {(!ready ? initError : sessionLoadError)
                      ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                      : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
        </main>
        <SearchPanel />
      </div>
      <SettingsDialog />
      <SessionInstructionsDialog />
      <Onboarding />
      <Toast />
    </>
  )
}
