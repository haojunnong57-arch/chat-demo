import clsx from 'clsx'
import { useRef, useState } from 'react'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  setChatBackground,
  setChatTheme,
  useSettings,
  type ChatTheme,
} from '../../services/settings.js'
import { imageFileToBackground } from '../../utils/image.js'
import styles from './Settings.module.css'

const chatThemes: { value: ChatTheme; label: TranslationKey }[] = [
  { value: 'default', label: 'settingsChatThemeDefault' },
  { value: 'wechat', label: 'settingsChatThemeWechat' },
  { value: 'imessage', label: 'settingsChatThemeImessage' },
  { value: 'instagram', label: 'settingsChatThemeInstagram' },
  { value: 'glass', label: 'settingsChatThemeGlass' },
]

/** 聊天外观：主题皮肤 + 自定义相册背景；两者可叠加。 */
export const BackgroundSetting = () => {
  const t = useTranslate()
  const chatTheme = useSettings((state) => state.chatTheme)
  const background = useSettings((state) => state.chatBackground)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const choose = () => {
    if (!busy) {
      inputRef.current?.click()
    }
  }

  const load = async (file: File | undefined) => {
    if (!file || busy) {
      return
    }
    setBusy(true)
    try {
      const data = await imageFileToBackground(file)
      setChatBackground(data)
      showToast({ key: 'settingsChatBackgroundSaved' })
    } catch {
      showToast({ key: 'settingsChatBackgroundFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.background}>
      <div className={styles.backgroundTitle}>{t('settingsChatThemeTitle')}</div>
      <div className={styles.backgroundDescription}>
        {t('settingsChatThemeDescription')}
      </div>
      <div
        role="radiogroup"
        aria-label={t('settingsChatThemeTitle')}
        className={styles.chatThemeGrid}
      >
        {chatThemes.map((theme) => {
          const selected = chatTheme === theme.value
          return (
            <button
              key={theme.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={clsx(styles.chatThemeCard, selected && styles.chatThemeCardSelected)}
              onClick={() => setChatTheme(theme.value)}
            >
              <span className={styles.chatThemePreview} data-preview={theme.value}>
                <span className={styles.chatThemePreviewBar} />
                <span className={styles.chatThemePreviewIn} />
                <span className={styles.chatThemePreviewOut} />
              </span>
              <span className={styles.chatThemeName}>{t(theme.label)}</span>
              {selected ? <span className={styles.chatThemeCheck}>✓</span> : null}
            </button>
          )
        })}
      </div>
      <div className={styles.chatThemeHint}>{t('settingsChatThemeHint')}</div>

      <div className={styles.chatBackgroundDivider} />
      <div className={styles.backgroundTitle}>{t('settingsChatBackground')}</div>
      <div className={styles.backgroundDescription}>
        {t('settingsChatBackgroundDescription')}
      </div>
      <button
        type="button"
        className={styles.backgroundPreview}
        onClick={choose}
        aria-label={t('settingsChatBackgroundChoose')}
        disabled={busy}
      >
        {background ? (
          <img src={background} alt="" className={styles.backgroundImage} />
        ) : (
          <span className={styles.backgroundEmpty}>{t('settingsChatBackgroundEmpty')}</span>
        )}
      </button>
      <div className={styles.backgroundActions}>
        <Button variant="outlined" size="m" disabled={busy} onClick={choose}>
          {t(background ? 'settingsChatBackgroundChange' : 'settingsChatBackgroundChoose')}
        </Button>
        {background ? (
          <Button
            variant="outlined"
            size="m"
            disabled={busy}
            onClick={() => {
              setChatBackground(null)
              showToast({ key: 'settingsChatBackgroundRemoved' })
            }}
          >
            {t('settingsChatBackgroundRemove')}
          </Button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void load(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </div>
  )
}
