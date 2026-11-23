import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import type { Session } from '../../services/chat/types.js'
import {
  CONTEXT_LIMIT,
  clearCompaction,
  compactNow,
  compactedCount,
  estimateSessionTokens,
  useContextCompaction,
} from '../../services/chat/context.js'
import { setContextMode, useSettings } from '../../services/settings.js'
import styles from './ContextDialog.module.css'

/**
 * 上下文占用面板：显示当前对话的 token 估算与压缩策略，可手动立即压缩。
 * 压缩只做本地摘要，不调模型、不产生费用；旧对话会变成本地长期记忆注入请求。
 */
export const ContextDialog = ({ session, onClose }: { session: Session; onClose: () => void }) => {
  const t = useTranslate()
  const contextMode = useSettings((state) => state.contextMode)
  const record = useContextCompaction((state) => state.records[session.id])
  const tokens = estimateSessionTokens(session, useSettings.getState().systemPrompt)
  const percent = Math.min(100, Math.round((tokens / CONTEXT_LIMIT) * 100))
  const folded = compactedCount(session)

  const compress = () => {
    const result = compactNow(session)
    if (!result) {
      showToast({ key: 'contextNothingToCompress' })
      return
    }
    showToast({ key: 'contextCompressed' })
  }

  return (
    <Modal title={t('contextTitle')} closable onClose={onClose} mainClassName={styles.main}>
      <div className={styles.meter}>
        <div className={styles.meterHead}>
          <span className={styles.meterValue}>{tokens.toLocaleString()}</span>
          <span className={styles.meterLimit}>/ {CONTEXT_LIMIT.toLocaleString()}</span>
          <span className={clsx(styles.meterPercent, percent >= 72 && styles.meterWarn)}>{percent}%</span>
        </div>
        <div className={styles.track} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <span className={clsx(styles.fill, percent >= 72 && styles.fillWarn)} style={{ width: `${percent}%` }} />
        </div>
        <p className={styles.caption}>{t('contextMeterHint')}</p>
      </div>

      <div className={styles.block}>
        <div className={styles.blockTitle}>{t('contextModeTitle')}</div>
        <div className={styles.options} role="radiogroup">
          {(
            [
              ['auto', 'contextModeAuto', 'contextModeAutoDesc'],
              ['every50', 'contextModeEvery50', 'contextModeEvery50Desc'],
            ] as const
          ).map(([value, label, desc]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={contextMode === value}
              className={clsx(styles.option, contextMode === value && styles.optionActive)}
              onClick={() => setContextMode(value)}
            >
              <span className={styles.radio}>
                {contextMode === value ? <span className={styles.radioDot} /> : null}
              </span>
              <span className={styles.optionText}>
                <span className={styles.optionLabel}>{t(label)}</span>
                <span className={styles.optionDesc}>{t(desc)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.block}>
        <div className={styles.blockTitle}>{t('contextCompressTitle')}</div>
        {record ? (
          <>
            <p className={styles.status}>
              {t('contextCompressedStatus', { count: String(folded) })}
              <br />
              {t('contextCompressedAt', {
                time: new Date(record.at).toLocaleString(),
              })}
            </p>
            <div className={styles.actions}>
              <Button variant="outlined" size="m" onClick={() => clearCompaction(session.id)}>
                {t('contextUndo')}
              </Button>
              <Button size="m" onClick={compress}>
                {t('contextCompressNow')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.status}>{t('contextNotCompressed')}</p>
            <div className={styles.actions}>
              <Button size="m" onClick={compress}>
                {t('contextCompressNow')}
              </Button>
            </div>
          </>
        )}
        <p className={styles.note}>{t('contextNote')}</p>
      </div>
    </Modal>
  )
}
