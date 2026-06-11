import { Hono } from 'hono'
import crypto from 'crypto'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { type RowDataPacket, type ResultSetHeader } from 'mysql2/promise'
import { db } from './db.js'
import { destroySession } from './session.js'
import { clearUserCache, dbInitialize, getSessionUser, getUserByAccountName, getUsersByIds, render, tryLogin } from './models.js'
import { calculatePasshash, ensureFile, ensureString, ensureStringArray, imageUrl, validateUser } from './utils.js'
import { type AppContext, type Comment, type CountRow, type ParsedBody, type Post, POSTS_PER_PAGE, type SessionData, type User, type Variables, UPLOAD_LIMIT } from './types.js'

export const router = new Hono<{ Variables: Variables }>()

type CommentCountRow = CountRow & { post_id: number }
const IMAGE_CACHE_DIR = '/home/public/image'

async function hydratePosts(posts: Post[], options: { allComments?: boolean } = {}): Promise<Post[]> {
  if (posts.length === 0) return []

  const postIds = posts.map((post) => post.id)
  const [countRows] = await db.query<RowDataPacket[]>(
    'SELECT `post_id`, COUNT(*) AS `count` FROM `comments` WHERE `post_id` IN (?) GROUP BY `post_id`',
    [postIds]
  )
  const commentCounts = new Map<number, number>()
  for (const row of countRows as CommentCountRow[]) {
    commentCounts.set(row.post_id, row.count)
  }

  const commentQuery = options.allComments
    ? 'SELECT * FROM `comments` WHERE `post_id` IN (?) ORDER BY `post_id`, `created_at` DESC'
    : `SELECT id, post_id, user_id, comment, created_at FROM (
        SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.post_id ORDER BY c.created_at DESC) AS rn
        FROM comments c
        WHERE c.post_id IN (?)
      ) recent_comments
      WHERE rn <= 3
      ORDER BY post_id, created_at DESC`
  const [commentRows] = await db.query<RowDataPacket[]>(commentQuery, [postIds])
  const commentsByPostId = new Map<number, Comment[]>()
  const userIds = new Set(posts.map((post) => post.user_id))
  for (const comment of commentRows as Comment[]) {
    if (!options.allComments && (commentsByPostId.get(comment.post_id)?.length ?? 0) >= 3) {
      continue
    }
    userIds.add(comment.user_id)
    const comments = commentsByPostId.get(comment.post_id) ?? []
    comments.push(comment)
    commentsByPostId.set(comment.post_id, comments)
  }

  const users = await getUsersByIds([...userIds])

  const built: Post[] = []
  for (const post of posts) {
    const user = users.get(post.user_id)
    if (!user || user.del_flg !== 0) continue

    post.user = user
    post.comment_count = commentCounts.get(post.id) ?? 0
    post.comments = (commentsByPostId.get(post.id) ?? [])
      .map((comment) => {
        comment.user = users.get(comment.user_id)
        return comment
      })
      .filter((comment): comment is Comment & { user: User } => Boolean(comment.user))
      .reverse()

    built.push(post)
    if (!options.allComments && built.length >= POSTS_PER_PAGE) break
  }

  return built
}

function mimeMatchesExt(mime: string, ext: string): boolean {
  return (ext === 'jpg' && mime === 'image/jpeg') || (ext === 'png' && mime === 'image/png') || (ext === 'gif' && mime === 'image/gif')
}

function extFromMime(mime: string): string | undefined {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/gif') return 'gif'
  return undefined
}

async function writeImageCache(filename: string, imgdata: Buffer): Promise<void> {
  try {
    await mkdir(IMAGE_CACHE_DIR, { recursive: true })
    await writeFile(`${IMAGE_CACHE_DIR}/${filename}`, imgdata)
  } catch (e) {
    console.error(e)
  }
}

async function clearImageCache(): Promise<void> {
  try {
    await rm(IMAGE_CACHE_DIR, { recursive: true, force: true })
    await mkdir(IMAGE_CACHE_DIR, { recursive: true })
  } catch (e) {
    console.error(e)
  }
}

router.get('/initialize', async (c: AppContext) => {
  try {
    await dbInitialize()
    await clearImageCache()
    return c.text('OK')
  } catch (e) {
    console.error(e)
    return c.text(String(e), 500)
  }
})

router.get('/login', async (c: AppContext) => {
  const me = await getSessionUser(c)
  if (me) return c.redirect('/')
  return render(c, 'login.ejs', { me })
})

router.post('/login', async (c: AppContext) => {
  const me = await getSessionUser(c)
  if (me) return c.redirect('/')
  const body = (await c.req.parseBody()) as ParsedBody
  try {
    const user = await tryLogin(ensureString(body.account_name), ensureString(body.password))
    const session = c.get('session') as SessionData
    if (user) {
      session.userId = user.id
      session.csrfToken = crypto.randomBytes(16).toString('hex')
      return c.redirect('/')
    } else {
      session.flashNotice = 'アカウント名かパスワードが間違っています'
      return c.redirect('/login')
    }
  } catch (e) {
    console.error(e)
    return c.text(String(e instanceof Error ? e.message : e), 500)
  }
})

router.get('/register', async (c: AppContext) => {
  const me = await getSessionUser(c)
  if (me) return c.redirect('/')
  return render(c, 'register.ejs', { me })
})

router.post('/register', async (c: AppContext) => {
  const me = await getSessionUser(c)
  if (me) return c.redirect('/')
  const body = (await c.req.parseBody()) as ParsedBody
  const accountName = ensureString(body.account_name)
  const password = ensureString(body.password)
  const session = c.get('session') as SessionData
  if (!validateUser(accountName, password)) {
    session.flashNotice = 'アカウント名は3文字以上、パスワードは6文字以上である必要があります'
    return c.redirect('/register')
  }
  const [rows] = await db.query<RowDataPacket[]>('SELECT 1 FROM users WHERE `account_name` = ?', [accountName])
  if (rows[0]) {
    session.flashNotice = 'アカウント名がすでに使われています'
    return c.redirect('/register')
  }
  const passhash = calculatePasshash(accountName, password)
  await db.query('INSERT INTO `users` (`account_name`, `passhash`) VALUES (?, ?)', [accountName, passhash])
  const newUser = await getUserByAccountName(accountName)
  if (!newUser) return c.text('ERROR', 500)
  session.userId = newUser.id
  session.csrfToken = crypto.randomBytes(16).toString('hex')
  return c.redirect('/')
})

router.get('/logout', async (c: AppContext) => {
  await destroySession(c)
  return c.redirect('/')
})

router.get('/', async (c: AppContext) => {
  try {
    const me = await getSessionUser(c)
    const [postRows] = await db.query<RowDataPacket[]>(
      'SELECT p.`id`, p.`user_id`, p.`body`, p.`created_at`, p.`mime` FROM `posts` p FORCE INDEX (`posts_created_at_idx`) INNER JOIN `users` u ON u.`id` = p.`user_id` AND u.`del_flg` = 0 ORDER BY p.`created_at` DESC LIMIT ?',
      [POSTS_PER_PAGE]
    )
    const posts = postRows as Post[]
    const enriched = await hydratePosts(posts)
    return render(c, 'index.ejs', { posts: enriched, me, imageUrl })
  } catch (e) {
    console.error(e)
    return c.text(String(e instanceof Error ? e.message : e), 500)
  }
})

router.get('/:accountName{@[A-Za-z0-9_]+}', async (c: AppContext) => {
  try {
    const accountName = c.req.param('accountName')!.slice(1)
    const user = await getUserByAccountName(accountName, true)
    if (!user) return c.text('not_found', 404)
    const [postRowData] = await db.query<RowDataPacket[]>(
      'SELECT `id`, `user_id`, `body`, `mime`, `created_at` FROM `posts` WHERE `user_id` = ? ORDER BY `created_at` DESC LIMIT ?',
      [user.id, POSTS_PER_PAGE]
    )
    const posts = await hydratePosts(postRowData as Post[])
    const [commentCountRows] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM `comments` WHERE `user_id` = ?', [user.id])
    const commentCount = (commentCountRows[0] as CountRow | undefined)?.count ?? 0
    const [postCountRows] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM `posts` WHERE `user_id` = ?', [user.id])
    const postCount = (postCountRows[0] as CountRow | undefined)?.count ?? 0
    const [countRows] = await db.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM `comments` c INNER JOIN `posts` p ON p.`id` = c.`post_id` WHERE p.`user_id` = ?',
      [user.id]
    )
    const commentedCount = (countRows[0] as CountRow | undefined)?.count ?? 0
    const me = await getSessionUser(c)
    return render(c, 'user.ejs', { me, user, posts, post_count: postCount, comment_count: commentCount, commented_count: commentedCount, imageUrl })
  } catch (e) {
    console.error(e)
    return c.text('ERROR', 500)
  }
})

router.get('/posts', async (c: AppContext) => {
  const maxCreatedAtParam = c.req.query('max_created_at')
  let maxCreatedAt: Date | null = null
  if (typeof maxCreatedAtParam === 'string' && maxCreatedAtParam.length > 0) {
    const parsed = new Date(maxCreatedAtParam)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Invalid max_created_at')
    }
    maxCreatedAt = parsed
  }
  const [postRows] = await db.query<RowDataPacket[]>(
    'SELECT p.`id`, p.`user_id`, p.`body`, p.`mime`, p.`created_at` FROM `posts` p FORCE INDEX (`posts_created_at_idx`) INNER JOIN `users` u ON u.`id` = p.`user_id` AND u.`del_flg` = 0 WHERE p.`created_at` <= ? ORDER BY p.`created_at` DESC LIMIT ?',
    [maxCreatedAt, POSTS_PER_PAGE]
  )
  const posts = postRows as Post[]
  const me = await getSessionUser(c)
  const enriched = await hydratePosts(posts)
  return render(c, 'posts.ejs', { me, imageUrl, posts: enriched })
})

router.get('/posts/:id', async (c: AppContext) => {
  const id = c.req.param('id')
  const [postRows] = await db.query<RowDataPacket[]>('SELECT * FROM `posts` WHERE `id` = ?', [id])
  const posts = postRows as Post[]
  const enriched = await hydratePosts(posts, { allComments: true })
  const post = enriched[0]
  if (!post) return c.text('not found', 404)
  const me = await getSessionUser(c)
  return render(c, 'post.ejs', { imageUrl, post, me })
})

router.post('/', async (c: AppContext) => {
  const me = await getSessionUser(c)
  if (!me) return c.redirect('/login')
  const body = (await c.req.parseBody()) as ParsedBody
  const session = c.get('session') as SessionData
  if (body.csrf_token !== session.csrfToken) return c.text('invalid CSRF Token', 422)
  const file = ensureFile(body.file)
  if (!file) {
    session.flashNotice = '画像が必須です'
    return c.redirect('/')
  }
  let mime = file.type
  if (!(mime.includes('jpeg') || mime.includes('png') || mime.includes('gif'))) {
    session.flashNotice = '投稿できる画像形式はjpgとpngとgifだけです'
    return c.redirect('/')
  }
  if (file.size > UPLOAD_LIMIT) {
    session.flashNotice = 'ファイルサイズが大きすぎます'
    return c.redirect('/')
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  const [result] = await db.query<ResultSetHeader>('INSERT INTO `posts` (`user_id`, `mime`, `imgdata`, `body`) VALUES (?,?,?,?)', [me.id, mime, buffer, ensureString(body.body)])
  const insertId = result.insertId
  const ext = extFromMime(mime)
  if (ext) {
    await writeImageCache(`${insertId}.${ext}`, buffer)
  }
  return c.redirect(`/posts/${encodeURIComponent(String(insertId))}`)
})

router.get('/image/:filename{[0-9]+\\.(png|jpg|gif)}', async (c: AppContext) => {
  try {
    const filename = c.req.param('filename')!
    const [idString, ext] = filename.split('.')
    const id = Number(idString)
    if (id === 0) {
      return new Response('', { status: 200 })
    }

    try {
      const imgdata = await readFile(`${IMAGE_CACHE_DIR}/${filename}`)
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      return new Response(new Uint8Array(imgdata), { headers: { 'Content-Type': mime } })
    } catch {
      // cache miss
    }

    const [posts] = await db.query<RowDataPacket[]>('SELECT `id`, `mime`, `imgdata` FROM `posts` WHERE `id` = ?', [id])
    const post = (posts as Post[])[0]
    if (!post) return c.text('image not found', 404)
    if (mimeMatchesExt(post.mime, ext)) {
      await writeImageCache(filename, post.imgdata)
      return new Response(new Uint8Array(post.imgdata), { headers: { 'Content-Type': post.mime } })
    }
    return c.text('image not found', 404)
  } catch (e) {
    console.error(e)
    return c.text(String(e instanceof Error ? e.message : e), 500)
  }
})

router.post('/comment', async (c: AppContext) => {
  const me = await getSessionUser(c)
  if (!me) return c.redirect('/login')
  const body = (await c.req.parseBody()) as ParsedBody
  const session = c.get('session') as SessionData
  if (body.csrf_token !== session.csrfToken) return c.text('invalid CSRF Token', 422)
  const postIdString = ensureString(body.post_id)
  if (!/^[0-9]+$/.test(postIdString)) return c.text('post_idは整数のみです')
  await db.query<ResultSetHeader>('INSERT INTO `comments` (`post_id`, `user_id`, `comment`) VALUES (?,?,?)', [Number(postIdString), me.id, ensureString(body.comment)])
  return c.redirect(`/posts/${encodeURIComponent(postIdString)}`)
})

router.get('/admin/banned', async (c: AppContext) => {
  const me = await getSessionUser(c)
  if (!me) return c.redirect('/login')
  if (me.authority === 0) return c.text('authority is required', 403)
  const [userRows] = await db.query<RowDataPacket[]>('SELECT * FROM `users` WHERE `authority` = 0 AND `del_flg` = 0 ORDER BY `created_at` DESC')
  const users = userRows as User[]
  return render(c, 'banned.ejs', { me, users })
})

router.post('/admin/banned', async (c: AppContext) => {
  const me = await getSessionUser(c)
  if (!me) return c.redirect('/')
  if (me.authority === 0) return c.text('authority is required', 403)
  const body = (await c.req.parseBody()) as ParsedBody
  const session = c.get('session') as SessionData
  if (body.csrf_token !== session.csrfToken) return c.text('invalid CSRF Token', 422)
  const query = 'UPDATE `users` SET `del_flg` = ? WHERE `id` = ?'
  const ids = ensureStringArray(body.uid)
  await Promise.all(ids.map((id) => db.query<ResultSetHeader>(query, [1, id])))
  clearUserCache()
  return c.redirect('/admin/banned')
})
