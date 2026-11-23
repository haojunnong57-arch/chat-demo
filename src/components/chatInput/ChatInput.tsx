import clsx from 'clsx'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  IconCameraOutline16,
  IconEllipsisOutline16,
  IconGlobeLanguageOutline14,
  IconImageOutline16,
  IconKeyboardOutline16,
  IconMicFill16,
  IconMicOutline16,
  IconPlusOutline20,
  IconSendOutline16,
  IconStickerOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import { setSearch, setThinking, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { primeReadAloud, stopReadAloud } from '../../services/speech/readAloud.js'
import { Menu } from '../base/Menu.js'
import { Tooltip } from '../base/Tooltip.js'
import { LiquidGlassSurface } from '../base/LiquidGlassSurface.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { extractVideoFrames } from '../../services/videoFrames.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { Spectrum } from './Spectrum.js'
import { haptic } from '../../utils/haptics.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

type InputMode = 'text' | 'voice'

const STICKERS = ['✨', '💬', '❤️', '🔥', '👍']

/** 输入框：打字 / 按住说话两个模式 + 文件 + 深度思考与智能搜索 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const chatTheme = useSettings((state) => state.chatTheme)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const [mode, setMode] = useState<InputMode>('text')
  const [cancelArmed, setCancelArmed] = useState(false)
  // 手指按下就立即展开录音卡，不等麦克风权限/录音器初始化完成
  const [pressing, setPressing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const holdActiveRef = useRef(false)
  /** 全局松手兜底监听；WebView 里 setPointerCapture 可能失败，事件会丢 */
  const releaseHandlerRef = useRef<((event: PointerEvent) => void) | null>(null)
  const pointerStartYRef = useRef(0)
  const cancelArmedRef = useRef(false)
  const togglesRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [t])

  const importVideo = async (video: File) => {
    showToast('正在抽取视频画面…')
    try {
      const key = useSettings.getState().apiKey ?? ''
      const frames = await extractVideoFrames(video)
      if (frames.length === 0) {
        showToast('这个视频抽不出画面，换一个试试')
        return
      }
      const error = addDraftFiles(sessionId, frames, key)
      if (error) {
        showToast(error)
        return
      }
      showToast(`已抽出 ${frames.length} 张画面帧，发送后模型会逐帧识别`)
    } catch {
      showToast('视频解码失败，换一个视频试试')
    }
  }

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const videos = files.filter((file) => file.type.startsWith('video/'))
    const rest = files.filter((file) => !file.type.startsWith('video/'))
    if (rest.length > 0) {
      const error = addDraftFiles(sessionId, rest, useSettings.getState().apiKey ?? '')
      if (error) {
        showToast(error)
      }
    }
    videos.forEach((video) => {
      void importVideo(video)
    })
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(sessionId, id, useSettings.getState().apiKey ?? '')
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voiceSendRef = useRef<() => void>(() => {})
  const voice = useVoiceInput(
    (transcript) => {
      const textarea = textareaRef.current
      const current = getDraft(sessionId).text
      if (!textarea) {
        setText(`${current}${transcript}`)
        return
      }
      const start = textarea.selectionStart ?? current.length
      const end = textarea.selectionEnd ?? current.length
      setText(current.slice(0, start) + transcript + current.slice(end))
      requestAnimationFrame(() => {
        textarea.focus({ preventScroll: true })
        textarea.setSelectionRange(start + transcript.length, start + transcript.length)
      })
    },
    {
      onComplete: () => voiceSendRef.current(),
    }
  )

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  const voiceBusy = voice.status !== 'idle'
  const holdActive = pressing || voiceBusy

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend =
    !importingHistory && !streaming && voice.status === 'idle' && mode === 'text' && draftReady

  const send = (fromVoice = false) => {
    if (
      useChatStore.getState().importingHistory ||
      (!fromVoice && voice.status !== 'idle') ||
      !prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)
    ) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    haptic(chatTheme === 'instagram' ? 'medium' : 'light')
    if (useSettings.getState().autoRead) {
      primeReadAloud()
    }
    stopReadAloud()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  voiceSendRef.current = () => send(true)

  const cleanupRelease = () => {
    const handler = releaseHandlerRef.current
    if (handler) {
      window.removeEventListener('pointerup', handler)
      window.removeEventListener('pointercancel', handler)
      releaseHandlerRef.current = null
    }
  }

  const holdStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      mode !== 'voice' ||
      voice.status !== 'idle' ||
      useChatStore.getState().importingHistory ||
      streaming ||
      !ensureApiKey()
    ) {
      return
    }
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 合成事件或 Safari 偶发不支持捕获；不影响按住录音本身
    }
    // Android WebView 常出现 pointer capture 失效或 pointercancel 提前触发，
    // 这里在 window 上补一层松手兜底，保证“按住说话”能正常收尾发送。
    cleanupRelease()
    const onRelease = () => {
      cleanupRelease()
      holdEnd(false)
    }
    releaseHandlerRef.current = onRelease
    window.addEventListener('pointerup', onRelease)
    window.addEventListener('pointercancel', onRelease)

    pointerStartYRef.current = event.clientY
    setCancelArmed(false)
    cancelArmedRef.current = false
    holdActiveRef.current = true
    setPressing(true)
    haptic('light')
    // 按住说话立刻打断 AI 正在进行的朗读/播报
    stopReadAloud()
    void voice.start()
  }

  const holdMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!holdActiveRef.current) {
      return
    }
    const distance = pointerStartYRef.current - event.clientY
    const armed = distance > 54
    if (armed !== cancelArmedRef.current) {
      cancelArmedRef.current = armed
      setCancelArmed(armed)
      if (armed) {
        haptic('soft')
      }
    }
  }

  const holdEnd = (cancelled = false) => {
    if (!holdActiveRef.current) {
      return
    }
    cleanupRelease()
    holdActiveRef.current = false
    setPressing(false)
    if (cancelled || cancelArmedRef.current) {
      setCancelArmed(false)
      cancelArmedRef.current = false
      voice.cancel()
      showToast({ key: 'voiceInputCancelled' })
      haptic('soft')
      return
    }
    setCancelArmed(false)
    cancelArmedRef.current = false
    haptic('medium')
    void voice.finish()
  }

  const switchMode = (next: InputMode) => {
    if (voiceBusy) {
      voice.cancel()
    }
    setCancelArmed(false)
    setPressing(false)
    cancelArmedRef.current = false
    setMode(next)
    if (next === 'voice') {
      // 切到按住说话时同样停止播报，避免两个声音叠在一起
      stopReadAloud()
      textareaRef.current?.blur()
    } else {
      window.setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 0)
    }
  }

  const insertSticker = () => {
    const sticker = STICKERS[Math.floor(Math.random() * STICKERS.length)]
    const textarea = textareaRef.current
    const current = getDraft(sessionId).text
    if (!textarea) {
      setText(`${current}${sticker}`)
    } else {
      const start = textarea.selectionStart ?? current.length
      const end = textarea.selectionEnd ?? current.length
      setText(current.slice(0, start) + sticker + current.slice(end))
      requestAnimationFrame(() => {
        textarea.focus({ preventScroll: true })
        textarea.setSelectionRange(start + sticker.length, start + sticker.length)
      })
    }
    showToast({ key: 'instagramStickerInserted' })
  }

  return (
    <div
      ref={wrapperRef}
      className={clsx(
        styles.wrapper,
        sessionId === null ? styles.home : styles.session,
        mode === 'voice' && styles.voiceMode,
        holdActive && styles.recording
      )}
      data-chat-theme={chatTheme}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          textareaRef.current?.focus({ preventScroll: true })
        }
      }}
    >
      {chatTheme === 'glass' ? (
        <LiquidGlassSurface
          className={styles.glassBackdrop}
          radius={26}
          mouseContainer={wrapperRef}
          elasticity={0.05}
        />
      ) : null}
      <span className={styles.voiceAura} data-cancel={cancelArmed} aria-hidden />
      <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
      {mode === 'voice' ? (
        <button
          type="button"
          className={clsx(
            styles.holdButton,
            holdActive && styles.holdButtonActive,
            cancelArmed && styles.holdButtonCancel,
            voice.status === 'transcribing' && styles.holdButtonTranscribing
          )}
          aria-label={cancelArmed ? t('voiceInputCancelHint') : t('voiceInputHold')}
          aria-pressed={holdActive}
          disabled={importingHistory || streaming}
          onPointerDown={holdStart}
          onPointerMove={holdMove}
          onPointerUp={() => holdEnd(false)}
          onPointerCancel={() => holdEnd(false)}
          onContextMenu={(event) => event.preventDefault()}
        >
          {holdActive ? (
            <>
              <div className={styles.holdTopLine}>
                <span className={styles.holdMic}>
                  <IconMicFill16 />
                </span>
                <span className={styles.holdText}>
                  {voice.status === 'transcribing'
                    ? t('voiceInputTranscribing')
                    : cancelArmed
                      ? t('voiceInputCancelHint')
                      : t('voiceInputReleaseHint')}
                </span>
                {voice.status === 'recording' ? (
                  <span className={styles.holdTimer}>{voice.seconds}s</span>
                ) : null}
              </div>
              <div className={styles.holdWaveClip} aria-hidden>
                <Spectrum getAnalyser={voice.getAnalyser} tone={cancelArmed ? 'red' : 'blue'} />
              </div>
            </>
          ) : (
            <span className={styles.holdIdleText}>{t('chatInputHoldToTalk')}</span>
          )}
        </button>
      ) : (
        <div className={styles.textareaWrapper}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder={t('chatInputPlaceholderChat')}
            rows={2}
            // 移动端不自动聚焦，避免一打开就弹出键盘
            autoFocus={!isMobile}
            disabled={importingHistory}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onMouseDown={(event) => {
              // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
              if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
                event.preventDefault()
                event.currentTarget.focus({ preventScroll: true })
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send()
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length > 0) {
                event.preventDefault()
                acceptFiles(files)
              }
            }}
          />
          <div className={styles.mirror} aria-hidden>
            {`${text}\n`}
          </div>
        </div>
      )}
      <div className={styles.functionRow}>
        {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方 */}
        <div ref={togglesRef} className={styles.toggles}>
          <Tooltip content={t('deactivatedThinkTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, thinking && styles.selected)}
              aria-label={t('thinkingSwitch')}
              aria-pressed={thinking}
              onClick={() => setThinking(!thinking)}
            >
              <IconThinkOutline14 />
              <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
            </button>
          </Tooltip>
          <Tooltip content={t('deactivatedSearchTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, search && styles.selected)}
              aria-label={t('search')}
              aria-pressed={search}
              onClick={() => setSearch(!search)}
            >
              <IconGlobeLanguageOutline14 />
              <span className={styles.toggleLabel}>{t('search')}</span>
            </button>
          </Tooltip>
        </div>
        <div className={styles.right}>
          {mode === 'voice' ? (
            <Tooltip content={t('chatInputKeyboardMode')}>
              <button
                type="button"
                className={styles.modeButton}
                aria-label={t('chatInputKeyboardMode')}
                onClick={() => switchMode('text')}
              >
                <IconKeyboardOutline16 />
              </button>
            </Tooltip>
          ) : chatTheme === 'instagram' ? (
            <Menu
              options={[
                {
                  key: 'camera',
                  label: t('instagramCameraOption'),
                  icon: <IconCameraOutline16 />,
                  onSelect: () => cameraInputRef.current?.click(),
                },
                {
                  key: 'album',
                  label: t('instagramAlbumOption'),
                  icon: <IconImageOutline16 />,
                  onSelect: () => fileInputRef.current?.click(),
                },
                {
                  key: 'sticker',
                  label: t('instagramStickerOption'),
                  icon: <IconStickerOutline16 />,
                  onSelect: insertSticker,
                },
              ]}
            >
              {({ toggle }) => (
                <button
                  type="button"
                  className={styles.modeButton}
                  aria-label={t('more')}
                  onClick={toggle}
                >
                  <IconEllipsisOutline16 />
                </button>
              )}
            </Menu>
          ) : (
            <Tooltip content={t('uploadFile')}>
              <button
                type="button"
                className={styles.roundButton}
                aria-label={t('uploadFile')}
                disabled={importingHistory}
                onClick={() => ensureApiKey() && fileInputRef.current?.click()}
              >
                <IconPlusOutline20 />
              </button>
            </Tooltip>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={`${ACCEPT},video/*`}
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            hidden
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              acceptFiles(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          {mode === 'text' ? (
            <Tooltip content={t('chatInputVoiceMode')}>
              <button
                type="button"
                className={clsx(styles.modeButton, styles.outlinedMode)}
                aria-label={t('chatInputVoiceMode')}
                disabled={!voice.available || streaming || importingHistory}
                onClick={() => switchMode('voice')}
              >
                <IconMicOutline16 />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content={t('uploadFile')}>
              <button
                type="button"
                className={styles.roundButton}
                aria-label={t('uploadFile')}
                disabled={importingHistory}
                onClick={() => ensureApiKey() && fileInputRef.current?.click()}
              >
                <IconPlusOutline20 />
              </button>
            </Tooltip>
          )}
          {streaming && sessionId ? (
            <button
              type="button"
              className={styles.sendButton}
              aria-label={t('chatInputStopButtonTooltip')}
              onClick={() => {
                stopReadAloud()
                stopReply(sessionId)
              }}
            >
              <IconStopFill16 />
            </button>
          ) : mode === 'text' ? (
            <button
              type="button"
              className={clsx(styles.sendButton, !canSend && styles.disabled)}
              aria-label={t('send')}
              aria-disabled={!canSend}
              onClick={() => send()}
            >
              <IconSendOutline16 />
            </button>
          ) : null}
        </div>
      </div>
      {dragging ? <DragMask /> : null}
    </div>
  )
}
