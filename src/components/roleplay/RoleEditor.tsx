import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import { createRole, deleteRole, findRole, updateRole } from '../../services/roleplay/store.js'
import type { RoleCard } from '../../services/roleplay/types.js'
import { generateRoleCard } from '../../services/roleplay/generate.js'
import { RoleAvatar } from './RoleAvatar.js'
import styles from './RoleEditor.module.css'

type Mode = 'manual' | 'ai' | 'import'

type Draft = {
  name: string
  tagline: string
  persona: string
  greeting: string
  initial: string
  accent: string
}

const EMPTY: Draft = {
  name: '',
  tagline: '',
  persona: '',
  greeting: '',
  initial: '',
  accent: '#5B8DEF',
}

const draftOf = (card: RoleCard | null): Draft =>
  card
    ? {
        name: card.name,
        tagline: card.tagline,
        persona: card.persona,
        greeting: card.greeting,
        initial: card.initial,
        accent: card.accent,
      }
    : EMPTY

/** 导入文本：先按 JSON 解析，再按“名字/设定/开场白”这类键值行解析，都不行就整段当设定 */
const parseImport = (raw: string): Draft | null => {
  const text = raw.trim()
  if (!text) {
    return null
  }
  if (text.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed !== null && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>
        const value = (key: string) => (typeof record[key] === 'string' ? (record[key] as string).trim() : '')
        const name = value('name')
        const persona = value('persona') || value('setting') || value('description')
        if (name || persona) {
          return {
            name: name || '新角色',
            tagline: value('tagline') || value('intro'),
            persona,
            greeting: value('greeting') || value('opening'),
            initial: name.slice(0, 1),
            accent: /^#[0-9a-fA-F]{6}$/.test(value('accent')) ? value('accent') : EMPTY.accent,
          }
        }
      }
    } catch {
      // 不是合法 JSON，继续按文本解析
    }
  }
  const draft: Draft = { ...EMPTY }
  const rest: string[] = []
  for (const line of text.split('\n')) {
    const match = /^(名字|角色名|名称|name|简介|一句话简介|tagline|设定|人设|persona|开场白|开场|greeting|颜色|accent)[：:]\s*(.*)$/i.exec(
      line.trim()
    )
    if (!match) {
      rest.push(line)
      continue
    }
    const key = match[1].toLowerCase()
    const value = match[2].trim()
    if (key === '名字' || key === '角色名' || key === '名称' || key === 'name') {
      draft.name = value
    } else if (key === '简介' || key === '一句话简介' || key === 'tagline') {
      draft.tagline = value
    } else if (key === '设定' || key === '人设' || key === 'persona') {
      draft.persona = value ? `${draft.persona}${value}\n` : draft.persona
    } else if (key === '开场白' || key === '开场' || key === 'greeting') {
      draft.greeting = value
    } else if (key === '颜色' || key === 'accent') {
      draft.accent = /^#[0-9a-fA-F]{6}$/.test(value) ? value : draft.accent
    }
  }
  const body = rest.join('\n').trim()
  if (body) {
    draft.persona = `${draft.persona}${body}`.trim()
  }
  if (!draft.persona) {
    return null
  }
  draft.name = draft.name || '新角色'
  draft.initial = draft.initial || draft.name.slice(0, 1)
  return draft
}

/**
 * 角色编辑弹窗：手写 / AI 写 / 导入三种入口，保存后写回本地角色库。
 * 内置角色可以改一份副本保存，但不会被覆盖。
 */
export const RoleEditor = ({
  card,
  initialMode = 'manual',
  onClose,
  onSaved,
}: {
  card: RoleCard | null
  initialMode?: Mode
  onClose: () => void
  onSaved: (card: RoleCard) => void
}) => {
  const t = useTranslate()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [draft, setDraft] = useState<Draft>(() => draftOf(card))
  const [idea, setIdea] = useState('')
  const [importText, setImportText] = useState('')
  const [busy, setBusy] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => controllerRef.current?.abort(), [])

  const patch = (value: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...value }))

  const generate = async () => {
    if (busy || !idea.trim()) {
      return
    }
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    try {
      const result = await generateRoleCard(idea.trim(), controller.signal)
      patch({
        name: result.name,
        tagline: result.tagline,
        persona: result.persona,
        greeting: result.greeting,
        initial: result.name.slice(0, 1),
        accent: result.accent,
      })
      setMode('manual')
      showToast({ key: 'roleEditorGenerated' })
    } catch {
      if (!controller.signal.aborted) {
        showToast({ key: 'roleEditorGenerateFailed', type: 'error' })
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setBusy(false)
      }
    }
  }

  const confirmImport = () => {
    const parsed = parseImport(importText)
    if (!parsed) {
      showToast({ key: 'roleEditorImportFailed', type: 'error' })
      return
    }
    setDraft(parsed)
    setMode('manual')
    showToast({ key: 'roleEditorImported' })
  }

  const save = () => {
    if (!draft.name.trim() || !draft.persona.trim()) {
      showToast({ key: 'roleEditorNeedFields', type: 'error' })
      return
    }
    const payload = {
      name: draft.name.trim(),
      tagline: draft.tagline.trim() || draft.persona.trim().split('\n')[0].slice(0, 24),
      persona: draft.persona.trim(),
      greeting: draft.greeting.trim() || `我是${draft.name.trim()}，今天想聊点什么？`,
      initial: draft.initial.trim().slice(0, 1) || draft.name.trim().slice(0, 1),
      accent: draft.accent.trim() || EMPTY.accent,
    }
    if (card && card.source === 'custom') {
      updateRole(card.id, payload)
      const updated = findRole(card.id)
      if (updated) {
        onSaved(updated)
      }
    } else {
      onSaved(createRole(payload))
    }
    showToast({ key: 'roleEditorSaved' })
    onClose()
  }

  const remove = () => {
    if (!card || card.source !== 'custom') {
      return
    }
    deleteRole(card.id)
    showToast({ key: 'roleEditorDeleted' })
    onClose()
  }

  return (
    <Modal
      title={card ? t('roleEditorTitleEdit') : t('roleEditorTitleNew')}
      closable
      onClose={() => !busy && onClose()}
      className={styles.dialog}
      mainClassName={styles.main}
      footer={
        <>
          {card?.source === 'custom' ? (
            <Button variant="dangerOutlined" size="m" disabled={busy} onClick={remove}>
              {t('delete')}
            </Button>
          ) : null}
          <div className={styles.footerGap} />
          <Button variant="outlined" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button disabled={busy} onClick={save}>
            {t('roleEditorSave')}
          </Button>
        </>
      }
    >
      <div className={styles.tabs} role="tablist">
        {(
          [
            ['manual', 'roleEditorTabManual'],
            ['ai', 'roleEditorTabAi'],
            ['import', 'roleEditorTabImport'],
          ] as const
        ).map(([value, key]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            className={clsx(styles.tab, mode === value && styles.tabActive)}
            onClick={() => setMode(value)}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {mode === 'manual' ? (
        <div className={styles.form}>
          <div className={styles.preview}>
            <RoleAvatar
              card={{
                id: 'preview',
                name: draft.name || '？',
                initial: draft.initial || draft.name.slice(0, 1) || '？',
                accent: draft.accent || EMPTY.accent,
                tagline: '',
                persona: '',
                greeting: '',
                source: 'custom',
              }}
              size="large"
            />
            <div className={styles.previewText}>
              <div className={styles.previewName}>{draft.name || t('roleEditorNamePlaceholder')}</div>
              <div className={styles.previewTagline}>{draft.tagline || t('roleEditorTaglinePlaceholder')}</div>
            </div>
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('roleEditorName')}</span>
            <input
              className={styles.input}
              value={draft.name}
              maxLength={12}
              placeholder={t('roleEditorNamePlaceholder')}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('roleEditorTagline')}</span>
            <input
              className={styles.input}
              value={draft.tagline}
              maxLength={40}
              placeholder={t('roleEditorTaglinePlaceholder')}
              onChange={(event) => patch({ tagline: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('roleEditorPersona')}</span>
            <textarea
              className={styles.textarea}
              value={draft.persona}
              maxLength={2400}
              rows={6}
              placeholder={t('roleEditorPersonaPlaceholder')}
              onChange={(event) => patch({ persona: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('roleEditorGreeting')}</span>
            <textarea
              className={styles.textarea}
              value={draft.greeting}
              maxLength={300}
              rows={2}
              placeholder={t('roleEditorGreetingPlaceholder')}
              onChange={(event) => patch({ greeting: event.target.value })}
            />
          </label>
          <div className={styles.accentRow}>
            <span className={styles.fieldLabel}>{t('roleEditorAccent')}</span>
            {['#5B8DEF', '#8E7CF0', '#4FB3A5', '#E07A5F', '#C46A9A', '#7A8B99'].map((color) => (
              <button
                key={color}
                type="button"
                className={clsx(styles.color, draft.accent === color && styles.colorActive)}
                style={{ background: color }}
                aria-label={color}
                onClick={() => patch({ accent: color })}
              />
            ))}
          </div>
        </div>
      ) : mode === 'ai' ? (
        <div className={styles.form}>
          <p className={styles.hint}>{t('roleEditorAiHint')}</p>
          <textarea
            className={styles.textarea}
            value={idea}
            maxLength={400}
            rows={4}
            placeholder={t('roleEditorAiPlaceholder')}
            onChange={(event) => setIdea(event.target.value)}
          />
          <div className={styles.aiActions}>
            <Button disabled={busy || !idea.trim()} onClick={() => void generate()}>
              {busy ? t('roleEditorGenerating') : t('roleEditorGenerate')}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.form}>
          <p className={styles.hint}>{t('roleEditorImportHint')}</p>
          <textarea
            className={styles.textarea}
            value={importText}
            rows={7}
            placeholder={t('roleEditorImportPlaceholder')}
            onChange={(event) => setImportText(event.target.value)}
          />
          <div className={styles.aiActions}>
            <Button disabled={!importText.trim()} onClick={confirmImport}>
              {t('roleEditorImportConfirm')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
