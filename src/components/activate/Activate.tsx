import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { license } from '../../services/license.js'
import { showToast } from '../base/toastState.js'
import styles from './Activate.module.css'

/** 闲鱼购买链接（占位，正式商品链接稍后替换）。 */
const BUY_URL = 'https://m.tb.cn/h.jmBIO37?tk=ABY76g15djk'

/** 未激活时挡住聊天界面：购买跳转 + 填码 + 永久解锁。 */
export const Activate = () => {
  const t = useTranslate()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const openBuy = () => {
    window.open(BUY_URL, '_blank', 'noopener')
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    const result = await license.activate(token)
    setBusy(false)
    if (result.ok) {
      showToast(t('activateSuccess'))
      return
    }
    if (result.reason === 'used') setError(t('activateUsed'))
    else if (result.reason === 'no-key') setError(t('activateNoKey'))
    else setError(t('activateInvalid'))
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('activateTitle')}>
      <div className={styles.shell}>
        <div className={styles.brand}>DeepSeek</div>
        <section className={styles.page}>
          <div className={styles.eyebrow}>{t('activateEyebrow')}</div>
          <h1 className={styles.title}>{t('activateTitle')}</h1>
          <p className={styles.lead}>{t('activateDesc')}</p>

          <button type="button" className={styles.buyButton} onClick={openBuy}>
            {t('activateBuy')} · ¥4.5
          </button>

          <div className={styles.card}>
            <div className={styles.cardLabel}>{t('activateCodeLabel')}</div>
            <input
              className={styles.input}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('activateCodePlaceholder')}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit()
              }}
            />
            {error ? <div className={styles.error}>{error}</div> : null}
            <button type="button" className={styles.startButton} disabled={busy} onClick={() => void submit()}>
              {busy ? t('activateVerifying') : t('activateSubmit')}
            </button>
          </div>

          <p className={styles.note}>{t('activateNote')}</p>
        </section>
      </div>
    </div>
  )
}
