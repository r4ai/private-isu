import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { writeFile } from 'fs/promises'
import inspector from 'inspector'
import type { Variables } from './types.js'
import { sessionMiddleware } from './session.js'
import { router } from './router.js'

const app = new Hono<{ Variables: Variables }>()

function startCpuProfiler(): void {
  const profilePath = process.env.ISUCONP_NODE_PROFILE_PATH
  if (!profilePath) return

  const session = new inspector.Session()
  session.connect()
  session.post('Profiler.enable')
  session.post('Profiler.start')

  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    session.post('Profiler.stop', (err, params) => {
      if (err) {
        console.error(err)
        process.exit(1)
      }
      writeFile(profilePath, JSON.stringify(params.profile))
        .catch((e) => {
          console.error(e)
          process.exitCode = 1
        })
        .finally(() => {
          session.disconnect()
          process.exit()
        })
    })
  }

  process.once('SIGUSR2', stop)
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

startCpuProfiler()

type AccessStats = {
  count: number
  totalMs: number
  durations: number[]
  statuses: Map<number, number>
  bytes: number
  paths: Map<string, number>
}

function accessLogEnabled(): boolean {
  const value = process.env.ISUCONP_ACCESS_LOG?.toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

if (accessLogEnabled()) {
  const accessStats = new Map<string, AccessStats>()

  function percentile(values: number[], ratio: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]
  }

  app.get('/__access_summary', (c) => {
    const rows = [...accessStats.entries()].map(([key, stats]) => {
      const [method, route] = key.split(' ', 2)
      const topPaths = [...stats.paths.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
      return {
        method,
        route,
        count: stats.count,
        total_ms: Number(stats.totalMs.toFixed(3)),
        avg_ms: Number((stats.totalMs / stats.count).toFixed(3)),
        p95_ms: Number(percentile(stats.durations, 0.95).toFixed(3)),
        max_ms: Number(Math.max(...stats.durations).toFixed(3)),
        statuses: Object.fromEntries([...stats.statuses.entries()].sort((a, b) => a[0] - b[0])),
        bytes: stats.bytes,
        top_paths: topPaths.map(([path, count]) => ({ path, count }))
      }
    })

    rows.sort((a, b) => b.total_ms - a.total_ms || b.count - a.count)
    return c.json({ rows })
  })

  app.use('*', async (c, next) => {
    const startedAt = process.hrtime.bigint()
    let error: unknown

    try {
      await next()
    } catch (e) {
      error = e
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
      const route = c.req.routePath || c.req.path
      const key = `${c.req.method} ${route}`
      const contentLength = Number(c.res.headers.get('content-length') ?? 0)
      const status = error ? 500 : c.res.status
      const stats = accessStats.get(key) ?? {
        count: 0,
        totalMs: 0,
        durations: [],
        statuses: new Map<number, number>(),
        bytes: 0,
        paths: new Map<string, number>()
      }

      stats.count += 1
      stats.totalMs += durationMs
      stats.durations.push(durationMs)
      stats.statuses.set(status, (stats.statuses.get(status) ?? 0) + 1)
      stats.bytes += contentLength
      stats.paths.set(c.req.path, (stats.paths.get(c.req.path) ?? 0) + 1)
      accessStats.set(key, stats)
    }

    if (error) throw error
  })
}

app.use('*', sessionMiddleware)
app.route('/', router)
app.use('/*', serveStatic({ root: '../public' }))

serve(
  { fetch: app.fetch, port: 8080 },
  (info: { port: number }) => {
    console.log(`server started on ${info.port}`)
  }
)
