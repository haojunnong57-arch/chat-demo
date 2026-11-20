import { useEffect, useState } from 'react'
import { Modal } from '../base/Modal.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import { updateSessionInstructions } from '../../services/chat/store.js'
import { closeSessionInstructions, useSessionInstructions } from './sessionInstructionsState.js'
import styles from './SessionInstructionsDialog.module.css'

/** 每个对话独立的最高优先级设定；只在打开对应的会话时注入请求。 */
export const SessionInstructionsDialog = () => {
  const t = useTranslate()
  const session = useSessionInstructions((state) => state.session)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue(session?.instructions ?? '')
    setSaving(false)
  }, [session])

  if (!session) {
    return null
  }

  const save = async () => {
    if (saving) {
      return
    }
    setSaving(true)
    try {
      await updateSessionInstructions(session.id, value)
      showToast({ key: 'sessionInstructionsSaved' })
      closeSessionInstructions()
    } catch {
      showToast({ key: 'sessionSaveFailed', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t('sessionInstructionsTitle')}
      closable
      onClose={() => !saving && closeSessionInstructions()}
      mainClassName={styles.main}
      footer={
        <>
          <Button variant="outlined" disabled={saving} onClick={closeSessionInstructions}>
            {t('cancel')}
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {t('sessionInstructionsSave')}
          </Button>
        </>
      }
    >
      <p className={styles.description}>{t('sessionInstructionsDescription')}</p>
      <div className={styles.sessionTitle}>{session.title || t('untitledChat')}</div>
      <textarea
        className={styles.textarea}
        value={value}
        maxLength={6000}
        autoFocus
        rows={7}
        placeholder={t('sessionInstructionsPlaceholder')}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className={styles.counter}>{value.length} / 6000</div>
    </Modal>
  )
}
