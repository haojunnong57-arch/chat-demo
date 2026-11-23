import clsx from 'clsx'
import { useState } from 'react'
import { Button } from '../base/Button.js'
import { useTranslate } from '../../i18n/index.js'
import {
  setRoleAutoGreeting,
  setRoleAvatars,
  setRoleplayDepth,
  useSettings,
} from '../../services/settings.js'
import { allRoles, startRoleChat, useRoleplay } from '../../services/roleplay/store.js'
import type { RoleCard } from '../../services/roleplay/types.js'
import { RoleAvatar } from './RoleAvatar.js'
import { RoleEditor } from './RoleEditor.js'
import styles from './RoleSettings.module.css'

/** 开关行：沿用设置页的胶囊开关样式 */
const ToggleRow = ({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) => (
  <div className={styles.toggleRow}>
    <div className={styles.toggleText}>
      <div className={styles.toggleLabel}>{label}</div>
      <div className={styles.toggleDesc}>{description}</div>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={clsx(styles.switch, checked && styles.switchOn)}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.thumb} />
    </button>
  </div>
)

/**
 * 设置里的「角色扮演」分区：开关 + 角色卡列表 + 新建 / AI 写 / 导入。
 * 点角色卡直接开一段新对话，开场白会自动发出。
 */
export const RoleSettings = () => {
  const t = useTranslate()
  const roleAvatars = useSettings((state) => state.roleAvatars)
  const roleplayDepth = useSettings((state) => state.roleplayDepth)
  const roleAutoGreeting = useSettings((state) => state.roleAutoGreeting)
  useRoleplay((state) => state.custom)
  const roles = allRoles()
  const [editor, setEditor] = useState<{ card: RoleCard | null; mode: 'manual' | 'ai' | 'import' } | null>(
    null
  )

  return (
    <div className={styles.wrap}>
      <div className={styles.block}>
        <div className={styles.blockTitle}>{t('roleSettingsTitle')}</div>
        <div className={styles.blockDesc}>{t('roleSettingsDesc')}</div>
        <ToggleRow
          label={t('roleSettingsAvatars')}
          description={t('roleSettingsAvatarsDesc')}
          checked={roleAvatars}
          onChange={setRoleAvatars}
        />
        <ToggleRow
          label={t('roleSettingsDepth')}
          description={t('roleSettingsDepthDesc')}
          checked={roleplayDepth}
          onChange={setRoleplayDepth}
        />
        <ToggleRow
          label={t('roleSettingsGreeting')}
          description={t('roleSettingsGreetingDesc')}
          checked={roleAutoGreeting}
          onChange={setRoleAutoGreeting}
        />
      </div>

      <div className={styles.block}>
        <div className={styles.cardHead}>
          <span className={styles.blockTitle}>{t('roleSettingsCards')}</span>
          <span className={styles.count}>{roles.length}</span>
        </div>
        <div className={styles.list}>
          {roles.map((card) => (
            <div key={card.id} className={styles.row}>
              <RoleAvatar card={card} size="small" />
              <button
                type="button"
                className={styles.rowMain}
                onClick={() => startRoleChat(card)}
              >
                <span className={styles.rowTitle}>
                  <span className={styles.rowName}>{card.name}</span>
                  <span className={styles.rowBadge}>
                    {card.source === 'custom' ? t('roleSettingsCustom') : t('roleSettingsBuiltin')}
                  </span>
                </span>
                <span className={styles.rowTagline}>{card.tagline}</span>
              </button>
              <button
                type="button"
                className={styles.rowEdit}
                aria-label={t('roleSettingsEdit')}
                onClick={() => setEditor({ card, mode: 'manual' })}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <path
                    d="M11.2 2.8a1.6 1.6 0 0 1 2.3 2.3L5.6 13l-3 .7.7-3z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <div className={styles.actions}>
          <Button variant="outlined" size="m" onClick={() => setEditor({ card: null, mode: 'manual' })}>
            {t('roleSettingsNew')}
          </Button>
          <Button variant="outlined" size="m" onClick={() => setEditor({ card: null, mode: 'ai' })}>
            {t('roleSettingsAi')}
          </Button>
          <Button variant="outlined" size="m" onClick={() => setEditor({ card: null, mode: 'import' })}>
            {t('roleSettingsImport')}
          </Button>
        </div>
        <p className={styles.hint}>{t('roleSettingsHint')}</p>
      </div>

      {editor ? (
        <RoleEditor
          card={editor.card}
          initialMode={editor.mode}
          onClose={() => setEditor(null)}
          onSaved={() => setEditor(null)}
        />
      ) : null}
    </div>
  )
}
