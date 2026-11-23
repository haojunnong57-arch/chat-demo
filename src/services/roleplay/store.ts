import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { newChat, sendMessage, setPendingSessionInstructions } from '../chat/store.js'
import { setDraftText } from '../chat/drafts.js'
import { useSettings } from '../settings.js'
import { BUILTIN_ROLES } from './presets.js'
import { parseRoleId, parseRoleName, roleInstructions, type RoleCard } from './types.js'

const CUSTOM_KEY = 'chat-demo:roleplay-custom'
const ACTIVE_KEY = 'chat-demo:roleplay-active'

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在本次运行中生效
  }
}

const loadCustom = (): RoleCard[] => {
  const raw = read(CUSTOM_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter((item): item is RoleCard => {
        if (item === null || typeof item !== 'object') {
          return false
        }
        const card = item as Partial<RoleCard>
        return typeof card.id === 'string' && typeof card.name === 'string'
      })
      .map((card) => ({ ...card, source: 'custom' as const }))
  } catch {
    return []
  }
}

type RoleplayState = {
  custom: RoleCard[]
  /** 角色广场里上一次选中的角色，用于卡片高亮 */
  activeId: string | null
}

export const useRoleplay = create<RoleplayState>(() => ({
  custom: loadCustom(),
  activeId: read(ACTIVE_KEY),
}))

const persistCustom = (custom: RoleCard[]) => {
  write(CUSTOM_KEY, JSON.stringify(custom))
  useRoleplay.setState({ custom })
}

/** 内置 + 自定义，按顺序展示 */
export const allRoles = (): RoleCard[] => [...BUILTIN_ROLES, ...useRoleplay.getState().custom]

export const findRole = (id: string | null | undefined): RoleCard | null => {
  if (!id) {
    return null
  }
  return allRoles().find((card) => card.id === id) ?? null
}

export const setActiveRole = (id: string | null) => {
  write(ACTIVE_KEY, id)
  useRoleplay.setState({ activeId: id })
}

/** 新建自定义角色；缺省字段用名字兜底，避免空卡片 */
export const createRole = (input: Omit<RoleCard, 'id' | 'source'>): RoleCard => {
  const card: RoleCard = {
    ...input,
    id: `custom-${createId()}`,
    initial: input.initial?.trim().slice(0, 1) || input.name.trim().slice(0, 1) || '角',
    source: 'custom',
  }
  persistCustom([...useRoleplay.getState().custom, card])
  return card
}

export const updateRole = (id: string, patch: Partial<Omit<RoleCard, 'id' | 'source'>>) => {
  persistCustom(useRoleplay.getState().custom.map((card) => (card.id === id ? { ...card, ...patch } : card)))
}

export const deleteRole = (id: string) => {
  persistCustom(useRoleplay.getState().custom.filter((card) => card.id !== id))
  if (useRoleplay.getState().activeId === id) {
    setActiveRole(null)
  }
}

/**
 * 用某张角色卡开一段新对话：写入角色指令，再发出开场白。
 * 开场白走正常发送流程，因此会触发模型回复，对话一开始就是角色口吻。
 */
export const startRoleChat = (card: RoleCard) => {
  setActiveRole(card.id)
  setPendingSessionInstructions(roleInstructions(card))
  newChat()
  setDraftText(null, card.greeting)
  // 关闭「自动发出开场白」时只填进输入框，让用户自己改一句再发
  if (useSettings.getState().roleAutoGreeting) {
    sendMessage(null)
  }
}

/**
 * 会话里记录的角色：优先按 id 找回角色卡（自定义角色被删则退回名字）。
 * 导入别人的会话时角色卡可能不存在，也要能按名字显示一个占位头像。
 */
export const resolveSessionRole = (instructions?: string): RoleCard | null => {
  const id = parseRoleId(instructions)
  const found = id ? findRole(id) : null
  if (found) {
    return found
  }
  const name = parseRoleName(instructions)
  if (!name) {
    return null
  }
  return {
    id: id ?? `session-role-${name}`,
    name,
    tagline: '',
    persona: '',
    greeting: '',
    initial: name.slice(0, 1),
    accent: '#5B8DEF',
    source: 'custom',
  }
}
