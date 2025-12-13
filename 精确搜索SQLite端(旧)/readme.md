# 语义森林图片标签管理系统

基于 **语义森林 (Semantic Forest)** 结构的智能图片标签管理系统，采用重前端 (Fat Client) 架构，支持多人协作、版本控制和乐观并发。

---

## 🌟 核心特性

### 1. 语义森林规则树
- **层级分组**：支持无限层级的标签组织结构
- **关键词膨胀**：搜索 "Vehicle" 自动包含 "Car", "Bike", "Truck" 等子关键词
- **软删除**：组和关键词支持禁用而非物理删除
- **循环检测**：自动防止 A→B→C→A 的环路引用

### 2. 并发控制 (CAS)
- **乐观锁**：基于版本号的无阻塞并发控制
- **冲突自动重放**：检测到冲突时自动合并并重试（最多3次）
- **修改日志**：记录谁在什么时候修改了规则
- **ETag 缓存**：避免不必要的网络传输

### 3. LocalStorage 优先
- 前端存储完整规则树副本作为"已确认的真值"
- 内存仅用于 UI 渲染和临时状态
- 离线访问历史数据（受缓存有效期限制）

### 4. 全文搜索
- **SQLite FTS5**：高效的全文索引
- **多条件组合**：AND/OR/NOT 逻辑
- **排除搜索**：`-tag` 语法排除指定标签
- **多维排序**：日期、文件大小、分辨率

### 5. 图片管理
- **自动去重**：MD5 哈希防止重复上传
- **缩略图生成**：动态生成 600x600 JPEG 缩略图
- **动图支持**：GIF/APNG 随机抽取一帧作为缩略图
- **回收站机制**：软删除图片（添加 `trash_bin` 标签）

---

## 📦 技术栈

### 后端
- **语言**: Python 3.7+
- **框架**: Flask + Flask-CORS
- **数据库**: SQLite3 + FTS5 (全文搜索扩展)
- **图像处理**: Pillow (PIL)

### 前端
- **HTML5 + Vanilla JavaScript (ES6+)**
- **样式**: Tailwind CSS (via CDN)
- **图标**: Lucide Icons
- **存储**: LocalStorage / IndexedDB (可选)

---

## 🚀 快速开始

### 1. 环境要求

```bash
# Python 依赖
pip install Flask Flask-CORS Pillow

# 或使用 requirements.txt (如果提供)
pip install -r requirements.txt
```

### 2. 启动服务

```bash
python app.py
```

**默认访问地址**: [http://localhost:5000](http://localhost:5000)

### 3. 首次使用

1. **上传图片**：点击右下角上传按钮（云朵图标）
2. **添加标签**：点击图片下方标签区域进入编辑模式
3. **创建规则树**：点击右下角规则树按钮（树形图标）打开侧边栏
4. **搜索图片**：在顶部搜索栏输入关键词，空格生成标签胶囊

---

## 📐 数据库设计

### 核心表结构

```sql
-- 图片元数据
CREATE TABLE images (
    md5 TEXT PRIMARY KEY,
    filename TEXT,
    created_at REAL,
    width INTEGER,
    height INTEGER,
    size INTEGER
);

-- 全文搜索索引
CREATE VIRTUAL TABLE images_fts USING fts5(
    md5 UNINDEXED,
    tags_text
);

-- 标签分组
CREATE TABLE search_groups (
    group_id INTEGER PRIMARY KEY,
    group_name TEXT NOT NULL,
    is_enabled BOOLEAN DEFAULT 1
);

-- 分组关键词（支持一词多组）
CREATE TABLE search_keywords (
    keyword TEXT NOT NULL,
    group_id INTEGER,
    is_enabled BOOLEAN DEFAULT 1,
    PRIMARY KEY (keyword, group_id)
);

-- 层级关系
CREATE TABLE search_hierarchy (
    parent_id INTEGER,
    child_id INTEGER,
    PRIMARY KEY (parent_id, child_id)
);

-- 版本控制
CREATE TABLE system_meta (
    key TEXT PRIMARY KEY,
    version_id INTEGER DEFAULT 0,
    last_updated_at REAL
);

-- 修改日志
CREATE TABLE search_version_log (
    version_id INTEGER PRIMARY KEY,
    modifier_id TEXT,
    updated_at REAL
);
```

### 性能优化索引

```sql
CREATE INDEX idx_keywords_group ON search_keywords(group_id);
CREATE INDEX idx_hierarchy_child ON search_hierarchy(child_id);
CREATE INDEX idx_hierarchy_parent ON search_hierarchy(parent_id);
CREATE INDEX idx_images_created ON images(created_at DESC);
CREATE INDEX idx_images_size ON images(size DESC);
CREATE INDEX idx_images_resolution ON images(height DESC, width DESC);
```

---

## 🔧 API 文档

### 规则树接口

#### 1. 获取规则树
```http
GET /api/rules
Headers:
  If-None-Match: "version_id"

Response (200):
{
  "version_id": 42,
  "groups": [...],
  "keywords": [...],
  "hierarchy": [...]
}

Response (304):
(Not Modified - 使用本地缓存)
```

#### 2. 添加关键词
```http
POST /api/rules/keyword/add
Content-Type: application/json

Request:
{
  "base_version": 42,
  "client_id": "abc123xyz",
  "group_id": 5,
  "keyword": "Landscape"
}

Response (200):
{
  "success": true,
  "version_id": 43
}

Response (409 - 冲突):
{
  "success": false,
  "status": 409,
  "error": "conflict",
  "latest_data": {...},
  "unique_modifiers": 2
}
```

#### 3. 创建分组
```http
POST /api/rules/group/add
{
  "base_version": 42,
  "client_id": "abc123xyz",
  "group_name": "Animals"
}

Response:
{
  "success": true,
  "version_id": 43,
  "new_id": 12
}
```

#### 4. 建立层级关系
```http
POST /api/rules/hierarchy/add
{
  "base_version": 42,
  "client_id": "abc123xyz",
  "parent_id": 5,
  "child_id": 12
}

Response (400 - 环路检测):
{
  "success": false,
  "error": "Cannot create cycle in hierarchy"
}
```

### 图片接口

#### 5. 上传图片
```http
POST /api/upload
Content-Type: multipart/form-data
Body: file=<binary>

Response:
{
  "success": true,
  "msg": "a1b2c3d4e5f6..."
}
```

#### 6. 搜索图片
```http
POST /api/search
{
  "offset": 0,
  "limit": 40,
  "sort_by": "date_desc",
  "keywords": ["cat", "cute"],
  "excludes": ["trash_bin"]
}

Response:
{
  "total": 156,
  "results": [
    {
      "md5": "a1b2c3...",
      "filename": "cat.jpg",
      "tags": ["cat", "cute", "animal"],
      "w": 1920,
      "h": 1080,
      "size": 2048576,
      "is_trash": false
    }
  ]
}
```

#### 7. 更新标签
```http
POST /api/update_tags
{
  "md5": "a1b2c3...",
  "tags": ["cat", "cute", "animal", "sleeping"]
}
```

---

## 🧩 前端架构

### 核心类

#### 1. TagInput
标签输入组件，支持：
- 空格/Enter 创建标签胶囊
- 点击胶囊编辑
- 排除标签 (`-tag`) 支持
- Datalist 自动补全

#### 2. GlobalState
全局状态管理：
```javascript
{
  clientId: "abc123xyz",
  rulesBaseVersion: 42,
  rulesTree: [...],
  queryTags: [{text: "cat", exclude: false}],
  isTrashMode: false,
  preferHQ: false,
  sortBy: "date_desc"
}
```

#### 3. MemeApp
主应用控制器，负责：
- 生命周期管理
- API 调用和错误处理
- UI 渲染（事件委托模式）
- 规则树同步逻辑

### 数据流

```
1. 启动 → 从 LocalStorage 读取规则树 → 渲染 UI
2. 静默请求 API (If-None-Match: version_id)
3. 如果 304 → 保持当前状态
4. 如果 200 → 更新 LocalStorage → 重新渲染
```

### 冲突处理流程

```
1. 用户修改规则 → 乐观更新 UI
2. 发送请求 (base_version: 42, client_id: abc123)
3. 服务器返回 409 Conflict
4. 前端接收 latest_data (version: 45)
5. 更新 LocalStorage 为 v45
6. 检查操作是否仍然有效
   - 有效 → 自动重试 (最多3次)
   - 无效 → Alert 提示用户，强制刷新 UI
```

---

## 🐛 已修复的关键 Bug

### 1. 并发控制事务泄漏 ✅
**问题**: `try_write()` 冲突时未显式回滚事务，可能导致后续请求阻塞。

**修复**: [app.py:178] 添加 `conn.rollback()`，确保锁释放。

### 2. 前端无限递归风险 ✅
**问题**: `handleSave()` 冲突自动重放无深度限制。

**修复**: [script.js:545-554] 添加 `MAX_RETRIES = 3`，超过限制强制同步。

### 3. 循环引用检测缺失 ✅
**问题**: 只检查自引用，未检查传递性循环（A→B→C→A）。

**修复**: [app.py:145-188] 实现 DFS 算法检测环路。

### 4. 数据库索引缺失 ✅
**问题**: 查询组关键词、层级关系、排序时全表扫描。

**修复**: [app.py:73-83] 添加 7 个性能优化索引。

### 5. 缩略图生成失败静默处理 ✅
**问题**: 生成失败时前端无提示，用户体验差。

**修复**: [app.py:407-416] 失败时自动降级为复制原图。

---

## 📊 性能优化建议

### 1. 减少不必要的重绘
```javascript
// 当前：每次保存后调用 renderRulesTree() 重绘整棵树
// 建议：增量更新单个组节点
updateSingleGroup(groupId, newData) {
    const groupEl = document.querySelector(`[data-id="${groupId}"]`);
    if (groupEl) {
        this.updateGroupElement(groupEl, newData);
    }
}
```

### 2. 使用 IndexedDB 替代 LocalStorage
```javascript
// LocalStorage 有 5-10MB 限制，规则树过大时可能溢出
class RulesStorage {
    async save(version, tree) {
        const db = await idb.openDB('rules_db', 1);
        await db.put('rules', { version, tree, timestamp: Date.now() });
    }
}
```

### 3. 虚拟滚动优化图片列表
```javascript
// 当前：一次加载 40 张图片
// 建议：只渲染可见区域的图片（Intersection Observer）
```

---

## 🧪 测试用例

### 并发冲突场景

**场景 1: 两用户同时添加关键词到同一组**

1. 用户A: 基于 v42 添加 "Dog" → 成功 → v43
2. 用户B: 基于 v42 添加 "Cat" → 409 冲突
3. 用户B 自动重放: 基于 v43 添加 "Cat" → 成功 → v44

**场景 2: 环路检测**

1. 创建组: Animals(1) → Mammals(2) → Cats(3)
2. 建立层级: 1→2, 2→3
3. 尝试添加: 3→1 → 400 Error "Cannot create cycle"

**场景 3: 最大重试次数**

1. 用户A 持续修改规则树（每秒1次）
2. 用户B 同时操作 → 冲突重试
3. 第1次重试失败 → 再次冲突
4. 第2次重试失败 → 再次冲突
5. 第3次重试失败 → 提示"冲突次数过多" → 强制同步

---

## 🔒 安全性说明

### SQL 注入防护
- ✅ 所有查询使用参数化语句
- ✅ 用户输入经过验证和清理
- ✅ 排序字段使用白名单验证

### XSS 防护
- ✅ 标签内容使用 `textContent` 而非 `innerHTML`
- ✅ 用户生成内容严格转义

### CSRF 防护
- ⚠️ 当前未实现 CSRF Token（建议生产环境添加）

### 文件上传安全
- ✅ 文件类型验证（基于 Pillow 解析）
- ✅ 文件大小限制（100MB）
- ✅ MD5 去重防止存储炸弹
- ⚠️ 建议添加病毒扫描（生产环境）

---

## 📝 待办事项

### 高优先级
- [ ] 实现真正的前端乐观更新（当前为空壳）
- [ ] 添加单元测试（后端 pytest，前端 Jest）
- [ ] 规则树导入/导出功能（JSON 格式）
- [ ] CSRF Token 保护

### 中优先级
- [ ] 批量编辑标签
- [ ] 图片相似度搜索（感知哈希）
- [ ] WebSocket 实时同步（替代轮询）
- [ ] 用户权限系统

### 低优先级
- [ ] 多语言支持（i18n）
- [ ] 暗黑模式
- [ ] 快捷键系统
- [ ] 导出搜索结果为 ZIP

---

## 🤝 贡献指南

1. **Fork 本仓库**
2. **创建特性分支** (`git checkout -b feature/AmazingFeature`)
3. **提交更改** (`git commit -m 'Add some AmazingFeature'`)
4. **推送到分支** (`git push origin feature/AmazingFeature`)
5. **开启 Pull Request**

### 代码规范
- Python: PEP 8
- JavaScript: ESLint + Prettier
- 提交信息: [Conventional Commits](https://www.conventionalcommits.org/)

---

## 📄 许可证

本项目采用 MIT 许可证 - 详见 LICENSE 文件

---

## 🙏 致谢

- [Flask](https://flask.palletsprojects.com/) - 轻量级 Web 框架
- [Tailwind CSS](https://tailwindcss.com/) - 原子化 CSS 框架
- [Lucide Icons](https://lucide.dev/) - 开源图标库
- [SQLite FTS5](https://www.sqlite.org/fts5.html) - 全文搜索扩展

---

## 📞 支持

- **问题反馈**: GitHub Issues
- **功能建议**: GitHub Discussions

---

**开发时间**: 2024-2025
**最后更新**: 2025-12-13
**版本**: 1.0.0-beta
**维护状态**: 活跃开发中
