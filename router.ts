// src/integrations/local-r2-proxy/router.ts
import type { APIRoute } from 'astro'
// Official Astro 6 / Cloudflare standard way to access bindings globally
import { env as cloudflareEnv } from 'cloudflare:workers'
// @ts-ignore - virtual module handled by plugin resolution loops
import { instances } from 'virtual:local-r2-proxy-config'

interface ResolvedInstance {
  bindingName: string
  urlPath: string
}

export const prerender = false

export const ALL: APIRoute = async (context) => {
  const url = new URL(context.request.url)
  const filename = context.params.file
  console.log('router(ALL)', { url, params: context.params, filename })

  if (!filename) {
    return new Response(JSON.stringify({ error: "MissingFilename" }), { status: 400 })
  }

  const targetInstance = (instances as ResolvedInstance[]).find(inst => url.pathname.startsWith(inst.urlPath))

  if (!targetInstance) {
    return new Response(JSON.stringify({ error: "RouteNotFound" }), { status: 404 })
  }

  // Safely look up the R2 bucket out of Cloudflare's natively imported edge environment object
  const bucket = (cloudflareEnv as any)[ targetInstance.bindingName ]

  if (!bucket) {
    return new Response(JSON.stringify({
      error: "MissingBinding",
      message: `The Cloudflare binding variable "${targetInstance.bindingName}" was not found inside the local workspace environment.`
    }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  if (context.request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const headObject = await bucket.head(filename)
  if (!headObject) {
    const { objects } = await bucket.list()
    console.log('head is 404:files', { filename, objects })
    return new Response(JSON.stringify({ error: "FileNotFound" }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  }

  const rangeHeader = context.request.headers.get('range')
  let object

  if (rangeHeader && rangeHeader.startsWith('bytes=')) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-')
    const start = parseInt(parts, 10) || 0
    const end = parseInt(parts, 10) || (headObject.size - 1)

    object = await bucket.get(filename, { range: { offset: start, length: end - start + 1 } })
    if (!object) return new Response(null, { status: 404 })

    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set('Content-Range', `bytes ${start}-${end}/${headObject.size}`)
    headers.set('Content-Length', (end - start + 1).toString())
    headers.set('Accept-Ranges', 'bytes')
    if (object.httpEtag) headers.set('ETag', object.httpEtag)

    return new Response(object.body, { status: 206, headers })
  }

  object = await bucket.get(filename)
  if (!object) return new Response(null, { status: 404 })

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Accept-Ranges', 'bytes')
  if (object.size) headers.set('Content-Length', object.size.toString())
  if (object.httpEtag) headers.set('ETag', object.httpEtag)

  return new Response(object.body, { status: 200, headers })
}

