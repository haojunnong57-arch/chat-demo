import type { RoleCard } from './types.js'

/**
 * 角色广场不再预置任何角色。
 *
 * 角色卡完全由用户自己新建 / AI 写 / 导入，头像和设定都归用户；
 * 这里保留空数组是为了让 allRoles() 的调用方式不受影响。
 */
export const BUILTIN_ROLES: RoleCard[] = []
