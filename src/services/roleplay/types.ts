/** 角色卡：一张卡就是一段可复用的角色扮演设定。 */
export type RoleCard = {
  id: string
  /** 角色名 */
  name: string
  /** 一句话简介，显示在卡片副标题 */
  tagline: string
  /** 角色设定正文，作为会话指令注入 */
  persona: string
  /** 开场白；选角色后自动发出，给对话一个起点 */
  greeting: string
  /** 无头像时用的占位字（一个字最稳） */
  initial: string
  /** 卡片强调色，用于渐变头像与标签 */
  accent: string
  /** 自定义头像 data URL */
  avatar?: string | null
  /** 内置角色来自角色广场，自定义角色来自用户自建 */
  source: 'builtin' | 'custom'
}

/** 对话指令里标记角色卡的标签名。 */
const ROLE_TAG = 'role_card'

/** 把角色卡序列化成会话指令；导入他人会话时也能还原出角色。 */
export const roleInstructions = (card: RoleCard): string =>
  `<${ROLE_TAG} id="${card.id}" name="${card.name}">\n${card.persona.trim()}\n</${ROLE_TAG}>`

/** 从会话指令里取回角色 id；没有角色标记时返回 null。 */
export const parseRoleId = (instructions?: string): string | null => {
  const match = new RegExp(`<${ROLE_TAG} id="([^"]+)"`).exec(instructions ?? '')
  return match?.[1] ?? null
}

/** 从会话指令里取回角色名，用于找不到角色卡时的兜底标题。 */
export const parseRoleName = (instructions?: string): string | null => {
  const match = new RegExp(`<${ROLE_TAG}[^>]* name="([^"]+)"`).exec(instructions ?? '')
  return match?.[1] ?? null
}
