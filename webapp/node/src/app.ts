import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Variables } from './types.js'
import { sessionMiddleware } from './session.js'
import { router } from './router.js'

const app = new Hono<{ Variables: Variables }>()

app.use('*', sessionMiddleware)
app.route('/', router)
app.use('/*', serveStatic({ root: '../public' }))

serve(
  { fetch: app.fetch, port: 8080 },
  (info: { port: number }) => {
    console.log(`server started on ${info.port}`)
  }
)
