import { useState } from 'react'
import clsx from 'clsx'
import { IconChevronRightOutline14, IconLinkOutline16 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import type { AssistantMessage } from '../../services/chat/types.js'
import styles from './McpToolCalls.module.css'

/** 对话中的 MCP 工具调用轨迹：默认收起，点开可看参数和返回结果。 */
export const McpToolCalls = ({ message }: { message: AssistantMessage }) => {
  const t = useTranslate()
  const [open, setOpen] = useState<string | null>(null)
  const calls = message.blocks.filter((block) => block.type === 'mcp_tool')
  if (calls.length === 0) {
    return null
  }
  return (
    <div className={styles.wrap}>
      {calls.map((call) => {
        const label =
          call.status === 'running'
            ? t('mcpToolRunning')
            : call.status === 'error'
              ? t('mcpToolError')
              : t('mcpToolDone')
        return (
          <div key={call.id} className={styles.item}>
            <button
              type="button"
              className={styles.row}
              aria-expanded={open === call.id}
              onClick={() => setOpen(open === call.id ? null : call.id)}
            >
              <span className={styles.icon}>
                <IconLinkOutline16 />
              </span>
              <span className={styles.label}>
                {label}
                <span className={styles.name}>{call.name}</span>
              </span>
              {call.status === 'running' ? <span className={styles.spinner} /> : null}
              {call.status === 'error' ? <span className={styles.errorDot} /> : null}
              <span className={clsx(styles.chevron, open === call.id && styles.chevronOpen)}>
                <IconChevronRightOutline14 />
              </span>
            </button>
            {open === call.id ? (
              <div className={styles.detail}>
                <div className={styles.sectionLabel}>Arguments</div>
                <pre className={styles.pre}>{JSON.stringify(call.input, null, 2)}</pre>
                {call.result ? (
                  <>
                    <div className={styles.sectionLabel}>{t('mcpToolResult')}</div>
                    <pre className={styles.pre}>{call.result}</pre>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
