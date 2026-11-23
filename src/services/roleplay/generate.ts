import { streamMessage } from '../api/client.js'
import { useSettings } from '../settings.js'

/** 生成结果只保留角色卡需要的字段 */
export type GeneratedRole = {
  name: string
  tagline: string
  persona: string
  greeting: string
  accent: string
}

const SYSTEM_PROMPT = [
  '你是角色设定助手。根据用户一句话的想法，写一张适合日常陪聊、陪学、陪创作的角色卡。',
  '角色必须健康正向：是伙伴、老师、朋友式的关系，不写恋爱、不写暧昧、不写任何越界或违规设定。',
  '只输出一个 JSON 对象，不要代码块、不要解释、不要多余文字。',
  'JSON 字段：',
  '- name：角色名，2 到 4 个汉字；',
  '- tagline：一句话简介，不超过 24 字；',
  '- persona：设定正文，4 到 6 行，写清身份、性格、说话方式、会怎么帮到对方；',
  '- greeting：开场白，1 到 2 句，符合角色口吻，不要说“作为一个 AI”；',
  '- accent：十六进制颜色，形如 #5B8DEF。',
].join('\n')

const pick = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** 模型偶尔会包一层代码块或加解释，这里只截取最外层的 JSON 对象 */
const parseGenerated = (text: string): GeneratedRole | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    if (parsed === null || typeof parsed !== 'object') {
      return null
    }
    const record = parsed as Record<string, unknown>
    const name = pick(record.name)
    const persona = pick(record.persona)
    if (!name || !persona) {
      return null
    }
    return {
      name,
      persona,
      tagline: pick(record.tagline) || persona.split('\n')[0].slice(0, 24),
      greeting: pick(record.greeting) || `我是${name}，今天想聊点什么？`,
      accent: /^#[0-9a-fA-F]{6}$/.test(pick(record.accent)) ? pick(record.accent) : '#5B8DEF',
    }
  } catch {
    return null
  }
}

/** 让模型按一句想法写角色设定；失败抛出，由调用方提示 */
export const generateRoleCard = async (idea: string, signal: AbortSignal): Promise<GeneratedRole> => {
  const settings = useSettings.getState()
  let text = ''
  const events = streamMessage(
    settings.apiKey ?? '',
    {
      model: settings.model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: idea }],
      thinking: { type: 'disabled' },
      safety_check: { level: 'high' },
      tools: [],
    },
    signal
  )
  for await (const event of events) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    }
  }
  const result = parseGenerated(text)
  if (!result) {
    throw new Error('角色设定生成失败')
  }
  return result
}
