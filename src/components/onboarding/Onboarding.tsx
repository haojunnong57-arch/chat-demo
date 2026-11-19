import { useState } from 'react'
import { IconChevronRightOutline14, IconCopyOutline16 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Onboarding.module.css'

const SEEN_KEY = 'chat-demo:onboarding-seen'

/** 首次启动的两页引导：交流群 → 赞赏码 → 开始使用。 */
export const Onboarding = () => {
  const t = useTranslate()
  const [visible, setVisible] = useState(() => {
    try {
      return !localStorage.getItem(SEEN_KEY)
    } catch {
      return true
    }
  })
  const [step, setStep] = useState<0 | 1>(0)
  const [copied, setCopied] = useState(false)

  if (!visible) {
    return null
  }

  const finish = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // 存储不可用时只在本次运行中跳过
    }
    setVisible(false)
  }

  const copyGroup = async () => {
    try {
      await navigator.clipboard.writeText('753838300482')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('onboardingTitle')}>
      <div className={styles.shell}>
        <div className={styles.brand}>DeepSeek</div>

        {step === 0 ? (
          <section className={styles.page}>
            <div className={styles.eyebrow}>{t('onboardingWelcomeEyebrow')}</div>
            <h1 className={styles.title}>{t('onboardingWelcomeTitle')}</h1>
            <p className={styles.lead}>{t('onboardingWelcomeDesc')}</p>

            <div className={styles.card}>
              <div className={styles.cardLabel}>{t('onboardingGroupLabel')}</div>
              <div className={styles.groupNumber}>753838300482</div>
              <p className={styles.groupHint}>{t('onboardingGroupHint')}</p>
              <button type="button" className={styles.copyButton} onClick={() => void copyGroup()}>
                <IconCopyOutline16 />
                {copied ? t('onboardingGroupCopied') : t('onboardingCopyGroup')}
              </button>
            </div>
          </section>
        ) : (
          <section className={styles.page}>
            <div className={styles.eyebrow}>{t('onboardingSupportEyebrow')}</div>
            <h1 className={styles.title}>{t('onboardingSupportTitle')}</h1>
            <p className={styles.lead}>{t('onboardingSupportDesc')}</p>
            <div className={styles.qrCard}>
              <img className={styles.qr} src="https://aka.doubaocdn.com/s/tcpjQTriVN" alt={t('onboardingRewardAlt')} />
              <p className={styles.rewardNote}>{t('onboardingRewardNote')}</p>
            </div>
          </section>
        )}

        <footer className={styles.footer}>
          <div className={styles.dots} aria-label={t('onboardingStepLabel')}>
            <span className={step === 0 ? styles.dotActive : styles.dot} />
            <span className={step === 0 ? styles.dot : styles.dotActive} />
          </div>
          {step === 0 ? (
            <button
              type="button"
              className={styles.nextButton}
              aria-label={t('onboardingNext')}
              onClick={() => setStep(1)}
            >
              <IconChevronRightOutline14 />
            </button>
          ) : (
            <button type="button" className={styles.startButton} onClick={finish}>
              {t('onboardingStart')}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
