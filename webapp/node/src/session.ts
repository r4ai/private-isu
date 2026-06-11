import Memcached from 'memcached'
import crypto from 'crypto'
import { getCookie, setCookie } from 'hono/cookie'
import type { Next } from 'hono'
import type { AppContext, SessionData } from './types.js'

const memcachedAddress = process.env.ISUCONP_MEMCACHED_ADDRESS || 'localhost:11211'
const memcached = new Memcached(memcachedAddress)
const SESSION_KEY_PREFIX = 'isuconp-node.session:'
const DEFAULT_SESSION_TTL = 24 * 60 * 60
const parsedTtl = Number(process.env.ISUCONP_SESSION_TTL)
const SESSION_TTL = Number.isFinite(parsedTtl) && parsedTtl > 0 ? Math.floor(parsedTtl) : DEFAULT_SESSION_TTL
const SESSION_COOKIE_NAME = 'sid'

function generateSessionId(): string {
  return crypto.randomBytes(16).toString('hex')
}

async function getSessionFromStore(sid: string): Promise<SessionData | undefined> {
  return new Promise((resolve) => {
    memcached.get(SESSION_KEY_PREFIX + sid, (err, data) => {
      if (err) {
        console.error('memcached get error', err)
        resolve(undefined)
        return
      }
      if (!data) {
        resolve(undefined)
        return
      }
      try {
        let raw: string
        if (typeof data === 'string') {
          raw = data
        } else if (Buffer.isBuffer(data)) {
          raw = data.toString('utf8')
        } else {
          resolve(undefined)
          return
        }
        resolve(JSON.parse(raw) as SessionData)
      } catch (e) {
        console.error('memcached parse error', e)
        resolve(undefined)
      }
    })
  })
}

async function saveSessionToStore(sid: string, session: SessionData): Promise<void> {
  return new Promise<void>((resolve) => {
    memcached.set(SESSION_KEY_PREFIX + sid, JSON.stringify(session), SESSION_TTL, (err) => {
      if (err) {
        console.error('memcached set error', err)
      }
      resolve()
    })
  })
}

async function deleteSessionFromStore(sid: string): Promise<void> {
  return new Promise<void>((resolve) => {
    memcached.del(SESSION_KEY_PREFIX + sid, (err) => {
      if (err) {
        console.error('memcached delete error', err)
      }
      resolve()
    })
  })
}

export async function destroySession(c: AppContext): Promise<void> {
  const sid = c.get('sessionId')
  if (sid) {
    await deleteSessionFromStore(sid)
  }
  setCookie(c, SESSION_COOKIE_NAME, '', { maxAge: 0, path: '/' })
}

export async function sessionMiddleware(c: AppContext, next: Next): Promise<void> {
  const existingSid = getCookie(c, SESSION_COOKIE_NAME)
  const sessionFromStore = existingSid ? await getSessionFromStore(existingSid) : undefined
  let session = sessionFromStore
  let isSessionDirty = false
  let sessionId: string
  if (session) {
    sessionId = existingSid as string
  } else {
    sessionId = generateSessionId()
    session = {}
    isSessionDirty = true
    setCookie(c, SESSION_COOKIE_NAME, sessionId, { httpOnly: true, path: '/' })
  }
  const sessionTarget = session as SessionData
  // Dirty tracking only observes direct property replacements; nested mutations require
  // assigning a new object back onto the session to persist.
  const trackedSession = new Proxy(sessionTarget, {
    set(target, prop, value) {
      const current = Reflect.get(target, prop)
      if (current !== value) {
        isSessionDirty = true
      }
      return Reflect.set(target, prop, value)
    },
    deleteProperty(target, prop) {
      if (Reflect.has(target, prop)) {
        isSessionDirty = true
      }
      return Reflect.deleteProperty(target, prop)
    }
  }) as SessionData
  c.set('session', trackedSession)
  c.set('sessionId', sessionId)
  try {
    await next()
  } finally {
    const latestSession = c.get('session') as SessionData | undefined
    if (latestSession === trackedSession && isSessionDirty) {
      await saveSessionToStore(sessionId, sessionTarget)
    }
  }
}
