import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { allRoles, startRoleChat, useRoleplay } from '../../services/roleplay/store.js'
import { RoleAvatar } from './RoleAvatar.js'
import styles from './RoleGallery.module.css'

/**
 * 角色广场：一张卡就是一段可以直接开始的角色扮演。
 * 点击卡片会新建对话、写入角色指令，并以开场白起手。
 */
export const RoleGallery = ({ compact = false }: { compact?: boolean }) => {
  const t = useTranslate()
  const activeId = useRoleplay((state) => state.activeId)
  // custom 变化时重建列表，保证新建/删除后立刻刷新
  useRoleplay((state) => state.custom)
  const roles = allRoles()

  return (
    <div className={styles.gallery}>
      <div className={styles.head}>
        <h2 className={styles.title}>{t('roleGalleryTitle')}</h2>
        {compact ? null : <p className={styles.desc}>{t('roleGalleryDesc')}</p>}
      </div>
      <div className={styles.grid}>
        {roles.map((card) => (
          <button
            key={card.id}
            type="button"
            className={clsx(styles.card, activeId === card.id && styles.selected)}
            onClick={() => startRoleChat(card)}
          >
            <div className={styles.avatarRow}>
              <RoleAvatar card={card} />
              <div className={styles.name}>
                <span className={styles.nameText}>{card.name}</span>
                {card.source === 'custom' ? <span className={styles.badge}>{t('roleGalleryCustom')}</span> : null}
              </div>
            </div>
            <p className={styles.tagline}>{card.tagline}</p>
            <div className={styles.footer}>
              <span className={styles.start}>{t('roleGalleryStart')}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
