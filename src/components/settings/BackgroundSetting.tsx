import { useRef, useState } from 'react'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import { setChatBackground, useSettings } from '../../services/settings.js'
import { imageFileToBackground } from '../../utils/image.js'
import styles from './Settings.module.css'

/** 聊天背景：点击预览或按钮从 iOS 相册选图，压缩后保存在本机。 */
export const BackgroundSetting = () => {
  const t = useTranslate()
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
      <div className={styles.backgroundTitle}>{t('settingsChatBackground')}</div>
      <div className={styles.backgroundDescription}>{t('settingsChatBackgroundDescription')}</div>
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
