// src/integrations/local-r2-proxy/index.ts
import type { AstroIntegration } from 'astro'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface BucketConfig {
  bindingName: string
  urlPath: string | ((token: string) => string)
  envKey: string
}

export default function localR2Proxy(options: BucketConfig | BucketConfig[]): AstroIntegration {
  const rawConfigs = Array.isArray(options) ? options : [ options ]
  const configModuleId = 'virtual:local-r2-proxy-config'
  const resolvedConfigModuleId = '\0' + configModuleId

  const currentFilename = fileURLToPath(import.meta.url)
  const currentDir = path.dirname(currentFilename)
  const routerAbsolutePath = path.resolve(currentDir, 'router.ts').replace(/\\/g, '/')

  return {
    name: 'local-r2-proxy',
    hooks: {
      'astro:config:setup': ({ updateConfig, injectRoute, command }) => {
        if (command !== 'dev') return

        const errors: string[] = [ ]
        if (!options || (Array.isArray(options) && options.length === 0)) {
          errors.push('The options configuration array or object is missing entirely.')
        } else {
          rawConfigs.forEach((config, index) => {
            const label = Array.isArray(options) ? `Bucket config index [ ${index} ]` : 'Configuration'
            if (!config || typeof config !== 'object') {
              errors.push(`${label} must be a valid configuration object.`)
              return
            }
            if (!config.bindingName) errors.push(`${label} is missing parameter "bindingName".`)
            if (!config.urlPath) errors.push(`${label} is missing parameter "urlPath".`)
            if (!config.envKey) errors.push(`${label} is missing parameter "envKey".`)
          })
        }

        if (errors.length > 0) {
          throw new Error(
            `\n\x1b[31m[Local R2 Proxy Configuration Error]\x1b[0m\n` +
            `Your localR2Proxy setup contains validation failures:\n\n` +
            `${errors.map((err, i) => `  ${i + 1}. ${err}`).join('\n')}\n`
          )
        }

        const resolvedInstances = rawConfigs.map(config => {
          const instanceUrlPath = typeof config.urlPath === 'function'
            ? config.urlPath(crypto.randomBytes(4).toString('hex'))
            : config.urlPath

          process.env[ config.envKey ] = instanceUrlPath

          return {
            bindingName: config.bindingName,
            urlPath: instanceUrlPath
          }
        })

        updateConfig({
          vite: {
            plugins: [
              {
                name: 'vite-plugin-local-r2-proxy-config',
                resolveId(id) {
                  if (id === configModuleId) return resolvedConfigModuleId
                  return null
                },
                load(id) {
                  if (id !== resolvedConfigModuleId) return null
                  // Safe compile-time serialization mapping the instances list directly
                  return `export const instances = ${JSON.stringify(resolvedInstances)}`
                }
              }
            ]
          }
        })

        resolvedInstances.forEach(instance => {
          injectRoute({
            pattern: `${instance.urlPath}/[...file]`,
            entrypoint: routerAbsolutePath
          })
        })
      }
    }
  }
}

