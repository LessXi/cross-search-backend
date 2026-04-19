# Cross-Search Backend

Cross-Search 扩展的后端 API 服务，提供用户认证、收藏管理和聚合搜索功能。

## 技术栈

- **Express.js** - Web 框架
- **Turso** - 数据库（libSQL）
- **SerpAPI** - 搜索引擎结果获取
- **Tavily** - AI 搜索增强（当提供 API Key 时自动路由）

## 快速开始

```bash
npm install
npm start
```

服务器将在 `http://localhost:3001` 启动。

## 环境变量

在 `.env` 文件中配置：

```env
TURSO_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-auth-token
SERPAPI_KEY=your-serpapi-key
TAVILY_API_KEY=your-tavily-key
PORT=3001
```

## API 接口

### 健康检查

```
GET /health
```

### 用户认证

#### 注册

```
POST /api/register
Body: { "email": "user@example.com", "password": "password" }
```

#### 登录

```
POST /api/login
Body: { "email": "user@example.com", "password": "password" }
```

### 收藏管理

#### 获取收藏

```
GET /api/bookmarks/:userId
```

#### 添加收藏

```
POST /api/bookmarks
Body: { "userId": "...", "resultId": "...", "resultData": {...} }
```

#### 删除收藏

```
DELETE /api/bookmarks
Body: { "userId": "...", "resultId": "..." }
```

### 搜索

```
POST /api/search
Body: {
  "query": "关键词",
  "platforms": ["baidu", "google", "bing", "bilibili", "zhihu"],
  "apiKey": "可选",
  "tavilyApiKey": "可选"
}
```

**自动路由**：当提供 `tavilyApiKey` 时，系统自动使用 Tavily 替代 SerpAPI 进行搜索，返回更多结果。

支持的平台：`baidu`、`google`、`bing`、`bilibili`、`zhihu`

## 数据库

使用 Turso (libSQL)，包含两张表：

- **users** - 用户表（id, email, password_hash, created_at）
- **bookmarks** - 收藏表（id, user_id, result_id, result_data, created_at）

## 部署

已配置 Railway 部署，无需额外配置。

## 相关项目

[Cross-Search 聚合搜索](https://github.com/LessXi/cross-search-extension) - Chrome 扩展前端
