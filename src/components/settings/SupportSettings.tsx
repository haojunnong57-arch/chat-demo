import { useState } from 'react'
import { Button } from '../base/Button.js'
import { IconCopyOutline16 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Settings.module.css'

const GROUP_NUMBER = '753838300482'

/** 设置里的交流群与赞赏码，内容与首次启动引导保持一致。 */
export const SupportSettings = () => {
  const t = useTranslate()
  const [copied, setCopied] = useState(false)

  const copyGroup = async () => {
    try {
      await navigator.clipboard.writeText(GROUP_NUMBER)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className={styles.support}>
      <section className={styles.supportCard}>
        <div className={styles.supportLabel}>{t('settingsCommunityGroup')}</div>
        <div className={styles.supportGroup}>{GROUP_NUMBER}</div>
        <p className={styles.supportHint}>{t('settingsCommunityHint')}</p>
        <Button variant="outlined" size="m" onClick={() => void copyGroup()}>
          <IconCopyOutline16 />
          {copied ? t('settingsCommunityCopied') : t('settingsCommunityCopy')}
        </Button>
      </section>

      <section className={styles.supportCard}>
        <div className={styles.supportLabel}>{t('settingsRewardTitle')}</div>
        <p className={styles.supportHint}>{t('settingsRewardDesc')}</p>
        <div className={styles.rewardLayout}>
          <img className={styles.rewardQr} src="https://aka.doubaocdn.com/s/tcpjQTriVN" alt={t('settingsRewardTitle')} />
          <p className={styles.rewardNote}>{t('settingsRewardNote')}</p>
        </div>
      </section>
    </div>
  )
}
