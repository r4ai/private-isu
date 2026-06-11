import { createPool, type Pool } from 'mysql2/promise'

export const db: Pool = createPool({
  host: process.env.ISUCONP_DB_HOST || 'localhost',
  port: Number(process.env.ISUCONP_DB_PORT) || 3306,
  user: process.env.ISUCONP_DB_USER || 'root',
  password: process.env.ISUCONP_DB_PASSWORD,
  database: process.env.ISUCONP_DB_NAME || 'isuconp',
  connectionLimit: Number(process.env.ISUCONP_DB_CONNECTION_LIMIT) || 8,
  charset: 'utf8mb4'
})
