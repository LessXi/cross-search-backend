const express = require('express');
const { createClient } = require('@libsql/client');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Turso database connection
const db = createClient({
  url: process.env.TURSO_URL || 'libsql://crosssearch-lessxi.aws-ap-northeast-1.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN || '',
});

// Simple password hashing
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'cross-search-salt').digest('hex');
}

function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
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

// Debug: check database connection
app.get('/api/debug', async (req, res) => {
  try {
    const result = await db.execute('SELECT 1 as test');
    res.json({ db: 'connected', result });
  } catch (err) {
    res.json({ db: 'error', error: err.message });
  }
});

// Debug: check tables
app.get('/api/debug/tables', async (req, res) => {
  try {
    const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table'");
    res.json({ tables: tables.rows });
  } catch (err) {
    res.json({ error: err.message });
  }
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

    const insertResult = await db.execute({
      sql: 'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
      args: [userId, email, passwordHash]
    });

    res.json({ success: true, userId, email, insertResult });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: '注册失败: ' + err.message });
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
      sql: 'SELECT id, email, password_hash FROM users WHERE email = ?',
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

    res.json({ success: true, userId: user.id, email: user.email });
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
      sql: 'SELECT result_id, result_data FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC',
      args: [userId]
    });

    const bookmarks = result.rows.map(row => ({
      id: row.result_id,
      data: JSON.parse(row.result_data)
    }));
    res.json({ bookmarks });
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

// SerpAPI search for baidu, google, bing, zhihu
async function searchViaSerpApi(engine, query) {
  const SERPAPI_KEY = process.env.SERPAPI_KEY;
  if (!SERPAPI_KEY) {
    throw new Error('SERPAPI_KEY not configured');
  }

  let url;
  if (engine === 'baidu') {
    url = `https://serpapi.com/search.json?engine=baidu&q=${encodeURIComponent(query)}&api_key=${SERPAPI_KEY}&num=50`;
  } else if (engine === 'google') {
    url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${SERPAPI_KEY}&num=50&gl=cn&hl=zh-cn`;
  } else if (engine === 'bing') {
    url = `https://serpapi.com/search.json?engine=bing&q=${encodeURIComponent(query)}&api_key=${SERPAPI_KEY}&num=50`;
  } else {
    return [];
  }

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!data.organic_results) return [];

    return data.organic_results.map(item => {
      const itemUrl = item.link || '';
      const detectedPlatform = detectPlatformFromUrl(itemUrl);

      const result = {
        platform: detectedPlatform !== 'website' ? detectedPlatform : engine,
        title: item.title || '无标题',
        description: item.snippet || '暂无描述',
        author: item.displayed_link || item.source || `${engine}搜索`,
        cover: '/placeholder.svg',
        url: itemUrl,
        contentType: detectContentType(itemUrl, item.title || ''),
      };

      // 知乎使用Google site搜索，结果URL需要标记为zhihu
      if (engine === 'google' && itemUrl.includes('zhihu.com')) {
        result.platform = 'zhihu';
        result.contentType = detectContentType(itemUrl, item.title || '');
      }

      return result;
    });
  } catch (err) {
    console.error(`SerpApi ${engine} error:`, err);
    return [];
  }
}

// Bilibili direct API search
async function searchBilibili(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodedQuery}&page=1&page_size=100`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.bilibili.com',
      },
    });

    const data = await response.json();
    if (data.code !== 0 || !data.data?.result) return [];

    const parseCount = (val) => {
      if (val === undefined) return undefined;
      if (typeof val === 'number') return val;
      const str = String(val);
      if (str.includes('万')) return Math.floor(parseFloat(str) * 10000);
      if (str.includes('亿')) return Math.floor(parseFloat(str) * 100000000);
      return parseInt(str) || undefined;
    };

    return data.data.result.map(item => ({
      platform: 'bilibili',
      title: (item.title || '').replace(/<[^>]*>/g, ''),
      description: item.description || '暂无简介',
      author: item.author || '未知UP主',
      cover: (item.pic || '').startsWith('//') ? `https:${item.pic}` : (item.pic || '/placeholder.svg'),
      url: item.arcurl || `https://www.bilibili.com/video/${item.bvid}`,
      publishTime: item.pubdate ? new Date(item.pubdate * 1000).toLocaleDateString() : undefined,
      contentType: 'video',
      metadata: {
        viewCount: parseCount(item.play),
        commentCount: parseCount(item.video_review),
        favoriteCount: parseCount(item.favorites),
        likeCount: parseCount(item.like),
        coinCount: parseCount(item.coin),
        duration: item.duration,
      },
    }));
  } catch (err) {
    console.error('Bilibili search error:', err);
    return [];
  }
}

function detectPlatformFromUrl(url) {
  if (!url) return 'website';
  const lower = url.toLowerCase();
  if (lower.includes('baidu.com')) return 'baidu';
  if (lower.includes('google.com') || lower.includes('google.cn')) return 'google';
  if (lower.includes('bilibili.com')) return 'bilibili';
  if (lower.includes('zhihu.com')) return 'zhihu';
  if (lower.includes('bing.com')) return 'bing';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('douyin.com') || lower.includes('tiktok.com')) return 'douyin';
  if (lower.includes('weibo.com') || lower.includes('weibo.cn')) return 'weibo';
  if (lower.includes('xiaohongshu.com') || lower.includes('xhs.com')) return 'xiaohongshu';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter';
  return 'website';
}

function detectContentType(url, title) {
  if (!url) return 'article';
  const lowerUrl = url.toLowerCase();
  const lowerTitle = (title || '').toLowerCase();

  if (lowerUrl.includes('/video/') || lowerUrl.includes('/watch?') ||
      lowerUrl.includes('v.qq.com') || lowerUrl.includes('iqiyi.com') ||
      lowerTitle.includes('视频') || lowerTitle.includes('直播')) {
    return 'video';
  }
  if (lowerUrl.includes('.pdf') || lowerUrl.includes('/doc/') ||
      lowerUrl.includes('wenku.baidu.com')) {
    return 'document';
  }
  return 'article';
}

// Aggregate search for all platforms
async function aggregateSearch(query, platforms) {
  const results = [];
  const errors = [];

  // 并行搜索所有平台
  const searchPromises = platforms.map(async (platform) => {
    try {
      let platformResults = [];

      switch (platform) {
        case 'baidu':
        case 'google':
        case 'bing':
          platformResults = await searchViaSerpApi(platform, query);
          break;
        case 'bilibili':
          platformResults = await searchBilibili(query);
          break;
        case 'zhihu':
          // 知乎使用Google site搜索
          platformResults = await searchViaSerpApi('google', `${query} site:zhihu.com`);
          platformResults = platformResults.filter(r => r.url.includes('zhihu.com'));
          platformResults.forEach(r => {
            r.platform = 'zhihu';
            r.contentType = detectContentType(r.url, r.title);
          });
          break;
        default:
          console.warn(`Unknown platform: ${platform}`);
      }

      return { platform, results: platformResults, error: null };
    } catch (err) {
      console.error(`${platform} search error:`, err);
      return { platform, results: [], error: err.message };
    }
  });

  const searchResults = await Promise.all(searchPromises);

  for (const sr of searchResults) {
    if (sr.error) {
      errors.push({ platform: sr.platform, error: sr.error });
    } else {
      results.push(...sr.results);
    }
  }

  return { results, errors };
}

// Search endpoint
app.post('/api/search', async (req, res) => {
  try {
    const { query, platforms } = req.body;

    if (!query || !platforms || !Array.isArray(platforms)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const { results, errors } = await aggregateSearch(query, platforms);
    res.json({ results, errors });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message || 'Search failed' });
  }
});

const PORT = process.env.PORT || 3001;
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
