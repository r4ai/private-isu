import ejs from 'ejs'
import path from 'path'
import { type RowDataPacket, type ResultSetHeader } from 'mysql2/promise'
import { db } from './db.js'
import { __dirname, calculatePasshash, formatBody } from './utils.js'
import {
  POSTS_PER_PAGE,
  type User,
  type Post,
  type Comment,
  type CountRow,
  type CommentOptions,
  type SessionData,
  type AppContext,
  type RenderParams
} from './types.js'

export async function tryLogin(accountName: string, password: string): Promise<User | undefined> {
  const user = await getUserByAccountName(accountName, true)
  if (!user) return undefined
  const passhash = calculatePasshash(accountName, password)
  if (passhash === user.passhash) return user
  return undefined
}

const usersById = new Map<number, User>()
const usersByAccountName = new Map<string, User>()

function cacheUser(user: User): User {
  usersById.set(user.id, user)
  usersByAccountName.set(user.account_name, user)
  return user
}

export function clearUserCache(): void {
  usersById.clear()
  usersByAccountName.clear()
}

export async function getUser(userId: number) {
  const cached = usersById.get(userId)
  if (cached) return cached
  const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM `users` WHERE `id` = ?', [userId])
  const user = rows[0] as User | undefined
  return user ? cacheUser(user) : undefined
}

export async function getUsersByIds(userIds: number[]): Promise<Map<number, User>> {
  const users = new Map<number, User>()
  const missingIds: number[] = []
  for (const userId of new Set(userIds)) {
    const cached = usersById.get(userId)
    if (cached) {
      users.set(userId, cached)
    } else {
      missingIds.push(userId)
    }
  }
  if (missingIds.length > 0) {
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM `users` WHERE `id` IN (?)', [missingIds])
    for (const user of rows as User[]) {
      users.set(user.id, cacheUser(user))
    }
  }
  return users
}

export async function getUserByAccountName(accountName: string, activeOnly = false): Promise<User | undefined> {
  const cached = usersByAccountName.get(accountName)
  if (cached) return !activeOnly || cached.del_flg === 0 ? cached : undefined
  const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM `users` WHERE `account_name` = ?', [accountName])
  const user = rows[0] as User | undefined
  if (!user) return undefined
  cacheUser(user)
  return !activeOnly || user.del_flg === 0 ? user : undefined
}

export async function dbInitialize(): Promise<void> {
  clearUserCache()
  const sqls = [
    'DELETE FROM users WHERE id > 1000',
    'DELETE FROM posts WHERE id > 10000',
    'DELETE FROM comments WHERE id > 100000',
    'UPDATE users SET del_flg = 0'
  ]
  await Promise.all(sqls.map((sql) => db.query<ResultSetHeader>(sql)))
  await db.query<ResultSetHeader>('UPDATE users SET del_flg = 1 WHERE id % 50 = 0')
}

export async function makeComment(comment: Comment): Promise<Comment> {
  comment.user = await getUser(comment.user_id)
  return comment
}

export async function makePost(post: Post, options: CommentOptions = {}): Promise<Post> {
  const [[countRow]] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS `count` FROM `comments` WHERE `post_id` = ?', [post.id])
  post.comment_count = (countRow as CountRow | undefined)?.count || 0
  let query = 'SELECT * FROM `comments` WHERE `post_id` = ? ORDER BY `created_at` DESC'
  if (!options.allComments) {
    query += ' LIMIT 3'
  }
  const [commentRows] = await db.query<RowDataPacket[]>(query, [post.id])
  const comments = await Promise.all((commentRows as Comment[]).map(makeComment))
  post.comments = comments.reverse()
  post.user = await getUser(post.user_id)
  return post
}

export async function makePosts(posts: Post[], options: { allComments?: boolean } = {}): Promise<Post[]> {
  const built: Post[] = []
  for (const post of posts) {
    const enriched = await makePost(post, options)
    if (enriched.user && enriched.user.del_flg === 0) {
      built.push(enriched)
    }
    if (built.length >= POSTS_PER_PAGE) {
      break
    }
  }
  return built
}

export async function render(c: AppContext, view: string, params: RenderParams): Promise<Response> {
  const session = c.get('session') as SessionData
  const messages = { notice: session.flashNotice }
  session.flashNotice = undefined
  const html = await ejs.renderFile(path.join(__dirname, '../views', view), { ...params, messages, formatBody })
  return c.html(html)
}

export async function getSessionUser(c: AppContext): Promise<User | undefined> {
  const session = c.get('session') as SessionData
  if (!session.userId) return undefined
  const user = await getUser(session.userId)
  if (!user) return undefined
  return { ...user, csrfToken: session.csrfToken }
}
