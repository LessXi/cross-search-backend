const express = require('express');
const { createClient } = require('@libsql/client');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Turso database connection
const db = createClient({
  url: process.env.TURSO_URL || 'libsql://crosssearch-lessxi.aws-ap-northeast-1.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN || '',
});

// Simple password hashing (in production, use bcrypt)
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'cross-search-salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, hash) {
  const passwordHash = await hashPassword(password);
  return passwordHash === hash;
}

// Initialize database tables
async function initDb() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        result_id TEXT NOT NULL,
        result_data TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    console.log('Database initialized');
  } catch (err) {
    console.error('Failed to init DB:', err);
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: '邮箱和密码不能为空' });
    }

    // Check if user exists
    const existing = await db.execute({
      sql: 'SELECT id FROM users WHERE email = ?',
      args: [email]
    });

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: '该邮箱已被注册' });
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    await db.execute({
      sql: 'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
      args: [userId, email, passwordHash]
    });

    res.json({ success: true, userId });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: '注册失败' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: '邮箱和密码不能为空' });
    }

    const result = await db.execute({
      sql: 'SELECT id, password_hash FROM users WHERE email = ?',
      args: [email]
    });

    if (result.rows.length === 0) {
      return res.status(401).json({ error: '用户不存在' });
    }

    const user = result.rows[0];
    const isValid = await verifyPassword(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: '密码错误' });
    }

    res.json({ success: true, userId: user.id });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: '登录失败' });
  }
});

// Get bookmarks
app.get('/api/bookmarks/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await db.execute({
      sql: 'SELECT result_id FROM bookmarks WHERE user_id = ?',
      args: [userId]
    });

    const bookmarkIds = result.rows.map(row => row.result_id);
    res.json({ bookmarks: bookmarkIds });
  } catch (err) {
    console.error('Get bookmarks error:', err);
    res.status(500).json({ error: '获取收藏失败' });
  }
});

// Add bookmark
app.post('/api/bookmarks', async (req, res) => {
  try {
    const { userId, resultId, resultData } = req.body;

    if (!userId || !resultId || !resultData) {
      return res.status(400).json({ error: '参数不完整' });
    }

    await db.execute({
      sql: 'INSERT OR IGNORE INTO bookmarks (user_id, result_id, result_data) VALUES (?, ?, ?)',
      args: [userId, resultId, resultData]
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Add bookmark error:', err);
    res.status(500).json({ error: '添加收藏失败' });
  }
});

// Remove bookmark
app.delete('/api/bookmarks', async (req, res) => {
  try {
    const { userId, resultId } = req.body;

    if (!userId || !resultId) {
      return res.status(400).json({ error: '参数不完整' });
    }

    await db.execute({
      sql: 'DELETE FROM bookmarks WHERE user_id = ? AND result_id = ?',
      args: [userId, resultId]
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Remove bookmark error:', err);
    res.status(500).json({ error: '删除收藏失败' });
  }
});

const PORT = process.env.PORT || 3001;
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
