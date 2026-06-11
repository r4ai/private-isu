import type { Context } from 'hono'

export type Variables = {
  session: SessionData
  sessionId: string
}

export type AppContext = Context<{ Variables: Variables }>
export type RenderParams = Record<string, unknown>
export type CommentOptions = { allComments?: boolean }
export type ParsedBodyValue = string | File | (string | File)[] | undefined
export type ParsedBody = Record<string, ParsedBodyValue>

export const POSTS_PER_PAGE = 20
export const UPLOAD_LIMIT = 10 * 1024 * 1024

export interface User {
  id: number
  account_name: string
  passhash: string
  authority: number
  del_flg: number
  created_at: Date
  csrfToken?: string
}

export interface Post {
  id: number
  user_id: number
  imgdata: Buffer
  body: string
  mime: string
  created_at: Date
  comment_count?: number
  comments?: Comment[]
  user?: User
}

export interface Comment {
  id: number
  post_id: number
  user_id: number
  comment: string
  created_at: Date
  user?: User
}

export interface CountRow {
  count: number
}

export interface IdRow {
  id: number
}

export interface SessionData {
  userId?: number
  csrfToken?: string
  flashNotice?: string
}
