import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import type { Post, ParsedBodyValue } from './types.js'

export const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function digest(src: string): string {
  return crypto.createHash('sha512').update(src).digest('hex')
}

export function validateUser(accountName: string, password: string): boolean {
  return /^[0-9a-zA-Z_]{3,}$/.test(accountName) && /^[0-9a-zA-Z_]{6,}$/.test(password)
}

export function calculatePasshash(accountName: string, password: string): string {
  const salt = digest(accountName)
  return digest(`${password}:${salt}`)
}

const escapeMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

export function escapeHtml(src: string): string {
  return src.replace(/[&<>"']/g, (char) => escapeMap[char] || char)
}

export function formatBody(body: string): string {
  return escapeHtml(body).replace(/\r?\n/g, '<br>')
}

export function imageUrl(post: Pick<Post, 'id' | 'mime'>): string {
  let ext = ''
  switch (post.mime) {
    case 'image/jpeg':
      ext = '.jpg'
      break
    case 'image/png':
      ext = '.png'
      break
    case 'image/gif':
      ext = '.gif'
      break
  }
  return `/image/${post.id}${ext}`
}

export const hasFileConstructor = typeof File !== 'undefined'

export function ensureString(value: ParsedBodyValue): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const first = value[0]
    if (typeof first === 'string') return first
  }
  return ''
}

export function ensureFile(value: ParsedBodyValue): File | undefined {
  if (!hasFileConstructor) return undefined
  if (value instanceof File) return value
  if (Array.isArray(value)) {
    const first = value[0]
    if (first instanceof File) return first
  }
  return undefined
}

export function ensureStringArray(value: ParsedBodyValue): string[] {
  if (typeof value === 'undefined') return []
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string')
  }
  if (typeof value === 'string') return [value]
  return []
}
