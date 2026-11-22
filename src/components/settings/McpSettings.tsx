import { useState } from 'react'
import clsx from 'clsx'
import { IconLinkOutline16 } from '../base/icons.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { useSettings, type Locale } from '../../services/settings.js'
import {
  addServer,
  connectServer,
  removeServer,
  setServerEnabled,
  setToolEnabled,
  testConnection,
  updateServer,
  useMcp,
} from '../../services/mcp/store.js'
import type { McpConnectionStatus, McpServerConfig } from '../../services/mcp/types.js'
import styles from './McpSettings.module.css'

const STATUS_LABEL: Record<McpConnectionStatus, TranslationKey> = {
  idle: 'settingsMcpStatusIdle',
  connecting: 'settingsMcpStatusConnecting',
  connected: 'settingsMcpStatusConnected',
  error: 'settingsMcpStatusError',
}

const STATUS_CLASS: Record<McpConnectionStatus, string> = {
  idle: styles.statusIdle,
  connecting: styles.statusConnecting,
  connected: styles.statusConnected,
  error: styles.statusError,
}

/** 跨域 / 原生桥接说明：i18n 文案归另一处维护，这里按当前语言内联展示。 */
const CORS_NOTE: Record<Locale, string> = {
  'zh-CN':
    '提示：浏览器直连时，若 MCP 服务端未开放 CORS 跨域会被浏览器拦截；iOS 壳内由原生桥接代发请求以绕过跨域限制。',
  'en-US':
    'Note: a direct browser connection is blocked when the MCP server does not allow CORS; inside the iOS shell requests are sent through the native bridge to bypass cross-origin restrictions.',
}

type Draft = Pick<McpServerConfig, 'name' | 'url' | 'token'> & { id?: string }

const emptyDraft: Draft = { name: '', url: '', token: '' }

/** 设置里的 MCP 连接管理：添加服务端、测试连接、查看工具并逐个启停。 */
export const McpSettings = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const servers = useMcp((state) => state.servers)
  const tools = useMcp((state) => state.tools)
  const statuses = useMcp((state) => state.statuses)
  const errors = useMcp((state) => state.errors)
  const enabledTools = useMcp((state) => state.enabledTools)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const openAdd = () => {
    setDraft({ ...emptyDraft })
    setTestResult(null)
  }

  const openEdit = (server: McpServerConfig) => {
    setDraft({ id: server.id, name: server.name, url: server.url, token: server.token })
    setTestResult(null)
  }

  const runTest = async () => {
    if (!draft || !draft.url.trim()) {
      setTestResult({ ok: false, text: t('settingsMcpUrlRequired') })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testConnection({
        id: draft.id ?? 'test',
        name: draft.name.trim() || 'MCP',
        url: draft.url.trim(),
        token: draft.token.trim(),
        enabled: true,
      })
      setTestResult({ ok: true, text: t('settingsMcpTestSuccess', { count: result.length }) })
    } catch (error) {
      setTestResult({
        ok: false,
        text: t('settingsMcpTestFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setTesting(false)
    }
  }

  const save = () => {
    if (!draft || !draft.name.trim() || !draft.url.trim()) {
      return
    }
    if (draft.id) {
      updateServer(draft.id, {
        name: draft.name.trim(),
        url: draft.url.trim(),
        token: draft.token.trim(),
      })
    } else {
      addServer({
        name: draft.name.trim(),
        url: draft.url.trim(),
        token: draft.token.trim(),
      })
    }
    setDraft(null)
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.intro}>
        <div className={styles.introText}>
          <div className={styles.title}>{t('settingsMcpTitle')}</div>
          <div className={styles.description}>{t('settingsMcpDescription')}</div>
        </div>
        <Button variant="outlined" size="m" onClick={openAdd}>
          {t('settingsMcpAdd')}
        </Button>
      </div>

      {servers.length === 0 ? (
        <div className={styles.empty}>{t('settingsMcpEmpty')}</div>
      ) : (
        <div className={styles.list}>
          {servers.map((server) => {
            const status = statuses[server.id] ?? 'idle'
            const serverTools = tools.filter((tool) => tool.serverId === server.id)
            return (
              <div key={server.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={clsx(styles.dot, STATUS_CLASS[status])} aria-hidden />
                  <div className={styles.cardText}>
                    <div className={styles.cardTitle}>{server.name}</div>
                    <div className={styles.cardSub}>
                      {t(STATUS_LABEL[status])}
                      <span className={styles.dotText}>·</span>
                      {t('settingsMcpTools', { count: serverTools.length })}
                    </div>
                    <div className={styles.url} title={server.url}>
                      {server.url}
                    </div>
                  </div>
                  <label className={styles.switch} title={t('settingsMcpEnable')}>
                    <input
                      type="checkbox"
                      checked={server.enabled}
                      onChange={(event) => setServerEnabled(server.id, event.target.checked)}
                    />
                    <span className={styles.switchTrack} aria-hidden>
                      <span className={styles.switchThumb} />
                    </span>
                  </label>
                  <button type="button" className={styles.linkButton} onClick={() => openEdit(server)}>
                    {t('settingsMcpEdit')}
                  </button>
                  {deleteId === server.id ? (
                    <button
                      type="button"
                      className={clsx(styles.linkButton, styles.danger)}
                      onClick={() => {
                        removeServer(server.id)
                        setDeleteId(null)
                      }}
                    >
                      {t('settingsMcpConfirmDelete')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={clsx(styles.linkButton, styles.muted)}
                      onClick={() => setDeleteId(server.id)}
                    >
                      {t('settingsMcpDelete')}
                    </button>
                  )}
                </div>

                {errors[server.id] ? (
                  <div className={styles.error}>{errors[server.id]}</div>
                ) : null}

                {serverTools.length > 0 ? (
                  <div className={styles.tools}>
                    {serverTools.map((tool) => (
                      <label key={tool.alias} className={styles.tool}>
                        <input
                          type="checkbox"
                          checked={enabledTools[tool.alias] !== false}
                          onChange={(event) => setToolEnabled(tool.alias, event.target.checked)}
                        />
                        <span className={styles.toolText}>
                          <span className={styles.toolName}>{tool.name}</span>
                          {tool.description ? (
                            <span className={styles.toolDescription}>{tool.description}</span>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : status === 'connected' ? (
                  <div className={styles.noTools}>{t('settingsMcpNoTools')}</div>
                ) : status === 'error' ? (
                  <button
                    type="button"
                    className={styles.retry}
                    onClick={() => void connectServer(server.id)}
                  >
                    {t('settingsMcpRetry')}
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <div className={styles.hint}>
        <IconLinkOutline16 />
        {t('settingsMcpHint')}
      </div>
      <div className={styles.note}>{CORS_NOTE[locale]}</div>

      {draft ? (
        <Modal
          title={draft.id ? t('settingsMcpEdit') : t('settingsMcpAdd')}
          className={styles.dialog}
          onClose={() => setDraft(null)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setDraft(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="outlined"
                size="m"
                disabled={testing || !draft.url.trim()}
                onClick={() => void runTest()}
              >
                {testing ? t('settingsMcpTesting') : t('settingsMcpTest')}
              </Button>
              <Button
                size="m"
                disabled={!draft.name.trim() || !draft.url.trim()}
                onClick={save}
              >
                {t('settingsMcpSave')}
              </Button>
            </>
          }
        >
          <div className={styles.form}>
            <label className={styles.field}>
              <span>{t('settingsMcpName')}</span>
              <input
                autoFocus
                value={draft.name}
                placeholder={t('settingsMcpNamePlaceholder')}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span>{t('settingsMcpUrl')}</span>
              <input
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={draft.url}
                placeholder="https://mcp.example.com/mcp"
                onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span>
                {t('settingsMcpToken')}
                <em>{t('settingsMcpOptional')}</em>
              </span>
              <input
                type="password"
                autoComplete="off"
                value={draft.token}
                placeholder={t('settingsMcpTokenPlaceholder')}
                onChange={(event) => setDraft({ ...draft, token: event.target.value })}
              />
            </label>
            {testResult ? (
              <div className={clsx(styles.testResult, testResult.ok ? styles.ok : styles.fail)}>
                {testResult.text}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
