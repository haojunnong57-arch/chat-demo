// 激活授权：纯本地验签 + GitHub 已用名单核对（路线2，无服务器）。
// 已激活标记存 localStorage；激活时联网读取仓库账本，挡重复使用。

const ACTIVATED_KEY = 'chat-demo:license-activated'
const USED_TOKENS_KEY = 'chat-demo:license-used-tokens'

// 卖家公钥（ECDSA P-256 JWK）。等卖家在签码网页生成钥匙后填入。
// 占位：正式公钥替换下方 PUBLIC_JWK。
const PUBLIC_JWK: JsonWebKey | null = null

const ALG = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' }

function b64urlToBuf(str: string): ArrayBuffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u.buffer
}

const enc = new TextEncoder()
const dec = new TextDecoder()

export function isActivated(): boolean {
  try {
    return localStorage.getItem(ACTIVATED_KEY) === '1'
  } catch {
    return false
  }
}

function markActivated(token: string) {
  try {
    localStorage.setItem(ACTIVATED_KEY, '1')
    const used: string[] = JSON.parse(localStorage.getItem(USED_TOKENS_KEY) ?? '[]')
    if (!used.includes(token)) used.push(token)
    localStorage.setItem(USED_TOKENS_KEY, JSON.stringify(used))
  } catch {
    // 存储不可用时仅本次生效
  }
}

function alreadyUsedLocally(token: string): boolean {
  try {
    const used: string[] = JSON.parse(localStorage.getItem(USED_TOKENS_KEY) ?? '[]')
    return used.includes(token)
  } catch {
    return false
  }
}

/** 验证签名是否由卖家私钥签发。公钥未配置时返回 false。 */
async function verifySignature(token: string): Promise<boolean> {
  if (!PUBLIC_JWK) return false
  const [payloadB64, sigB64] = token.trim().split('.')
  if (!payloadB64 || !sigB64) return false
  let payload: string
  try {
    payload = dec.decode(b64urlToBuf(payloadB64))
  } catch {
    return false
  }
  try {
    const pub = await crypto.subtle.importKey('jwk', PUBLIC_JWK, ALG, false, ['verify'])
    return await crypto.subtle.verify(ALG, pub, b64urlToBuf(sigB64), enc.encode(payload))
  } catch {
    return false
  }
}

/** GitHub 账本（已用名单）raw 地址，仓库私有可换成带 token 的 raw。 */
const LEDGER_URL = 'https://raw.githubusercontent.com/haojunnong57-arch/chat-demo/main/tools/license-signer/ledger.json'

/** 读取已用名单；网络失败时返回空数组（不阻断激活，离线可解锁）。 */
async function fetchUsedTokens(): Promise<string[]> {
  try {
    const res = await fetch(LEDGER_URL, { cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data.used) ? data.used.filter((x: unknown) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export type ActivateResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'used' | 'no-key' }

/** 填码激活：验签 + 账本核对 + 本地永久解锁。 */
async function activate(token: string): Promise<ActivateResult> {
  const t = token.trim()
  if (!t) return { ok: false, reason: 'invalid' }
  if (!PUBLIC_JWK) return { ok: false, reason: 'no-key' }
  if (alreadyUsedLocally(t)) return { ok: false, reason: 'used' }

  const valid = await verifySignature(t)
  if (!valid) return { ok: false, reason: 'invalid' }

  const used = await fetchUsedTokens()
  if (used.includes(t)) return { ok: false, reason: 'used' }

  markActivated(t)
  return { ok: true }
}

export const license = { isActivated, activate }
