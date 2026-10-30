import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { DEFAULT_LANGUAGE, isSupportedLanguage, LANGUAGE_HELP } from '../shared/localization.js'

export function initializeWorkspaceConfig(rootDir) {
  const configDir = path.join(path.resolve(rootDir), '.pdf')
  const configPath = path.join(configDir, 'config.json')

  try {
    mkdirSync(configDir, { recursive: true })
    let config
    let exists = true
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      exists = false
      config = {}
    }

    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('配置必须是 JSON 对象')
    }
    const missingBlur = !Object.hasOwn(config, 'blurLockScreen')
    const missingPassword = !Object.hasOwn(config, 'lockPassword')
    const missingLanguage = !Object.hasOwn(config, 'language')
    if (missingBlur) config.blurLockScreen = false
    if (missingPassword) config.lockPassword = ''
    if (missingLanguage) config.language = DEFAULT_LANGUAGE

    if (!isSupportedLanguage(config.language)) {
      throw new Error(`Unsupported language ${JSON.stringify(config.language)}. Supported languages: ${LANGUAGE_HELP}. Set "language" to "en" or "zh".`)
    }

    if (typeof config.blurLockScreen !== 'boolean') {
      throw new Error('blurLockScreen 必须是 true 或 false')
    }
    const validPassword = typeof config.lockPassword === 'string'
      || (Number.isSafeInteger(config.lockPassword) && config.lockPassword >= 0)
    if (!validPassword) throw new Error('lockPassword 必须是字符串或非负整数，留空请使用 ""')

    if (!exists || missingBlur || missingPassword || missingLanguage) {
      try {
        writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
          flag: exists ? 'w' : 'wx',
          mode: 0o600,
        })
      } catch (error) {
        // Another process may have initialized the same workspace first.
        if (!exists && error.code === 'EEXIST') return initializeWorkspaceConfig(rootDir)
        throw error
      }
    }
    return config
  } catch (error) {
    throw new Error(`无法初始化配置 ${configPath}：${error.message}`, { cause: error })
  }
}

export function hasLockPassword(config) {
  return String(config.lockPassword).trim() !== ''
}
