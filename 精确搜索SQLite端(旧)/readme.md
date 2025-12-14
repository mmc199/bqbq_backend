# 语义森林图片标签管理系统

基于 **语义森林 (Semantic Forest)** 结构的智能图片标签管理系统，采用重前端 (Fat Client) 架构，支持多人协作、版本控制和乐观并发。

> **版本**: 1.0.0
> **最后更新**: 2025-12-15
> **维护状态**: 活跃开发中

---

## 核心特性

### 1. 语义森林规则树
- **层级分组**：支持无限层级的标签组织结构
- **关键词膨胀**：搜索 "Vehicle" 自动包含 "Car", "Bike", "Truck" 等子关键词
- **软删除/彻底删除**：组和关键词支持禁用或永久删除
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
- **自动去重**：MD5 哈希防止重复上传（客户端预检查）
- **缩略图生成**：动态生成 600x600 JPEG 缩略图
- **动图支持**：GIF/APNG 随机抽取一帧作为缩略图
- **回收站机制**：软删除图片（添加 `trash_bin` 标签）

### 6. 数据导入导出
- **JSON 导出**：完整备份图片元数据和规则树
- **JSON 导入**：支持数据迁移和多设备同步

---

## 技术栈

### 后端
- **语言**: Python 3.7+
- **框架**: Flask + Flask-CORS
- **数据库**: SQLite3 + FTS5 (全文搜索扩展)
- **图像处理**: Pillow (PIL)

### 前端
- **HTML5 + Vanilla JavaScript (ES6+)**
- **样式**: Tailwind CSS (via CDN)
- **图标**: Lucide Icons
- **MD5计算**: SparkMD5
- **存储**: LocalStorage

---

## 快速开始

### 1. 环境要求

```bash
# Python 依赖
pip install Flask Flask-CORS Pillow
```

### 2. 启动服务

```bash
cd "精确搜索SQLite端(旧)"
python app.py
```

**默认访问地址**: [http://localhost:5000](http://localhost:5000)

### 3. 首次使用

1. **上传图片**：点击右下角上传按钮（云朵图标）
2. **添加标签**：点击图片下方标签区域进入编辑模式
3. **创建规则树**：点击右下角规则树按钮（树形图标）打开侧边栏
4. **搜索图片**：在顶部搜索栏输入关键词，空格生成标签胶囊

---

## 数据库设计

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

## API 文档

### 规则树接口

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/rules` | GET | 获取规则树 (支持 ETag) |
| `/api/rules/group/add` | POST | 创建分组 |
| `/api/rules/group/update` | POST | 更新分组 |
| `/api/rules/group/toggle` | POST | 软删除/恢复 |
| `/api/rules/group/delete` | POST | 彻底删除 |
| `/api/rules/keyword/add` | POST | 添加关键词 |
| `/api/rules/keyword/remove` | POST | 删除关键词 |
| `/api/rules/hierarchy/add` | POST | 建立层级关系 |
| `/api/rules/hierarchy/remove` | POST | 删除层级关系 |

### 图片接口

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/upload` | POST | 上传图片 |
| `/api/search` | POST | 搜索图片 |
| `/api/update_tags` | POST | 更新标签 |
| `/api/check_md5` | POST | 检查 MD5 是否存在 |
| `/api/meta/tags` | GET | 获取标签建议 |

### 数据接口

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/export/all` | GET | 导出所有数据 |
| `/api/import/all` | POST | 导入 JSON 数据 |

---

## 前端架构

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

---

## 已修复的关键 Bug

| Bug | 位置 | 修复内容 |
|-----|------|---------|
| 并发控制事务泄漏 | app.py | 冲突时添加显式回滚 |
| 前端无限递归风险 | script.js | 添加 MAX_RETRIES = 3 |
| 循环引用检测缺失 | app.py | 实现 DFS 算法检测环路 |
| 数据库索引缺失 | app.py | 添加 7 个性能优化索引 |
| 缩略图生成失败处理 | app.py | 失败时自动降级为复制原图 |

---

## 安全性说明

- ✅ **SQL 注入防护**: 所有查询使用参数化语句
- ✅ **XSS 防护**: 用户内容使用 `textContent`
- ✅ **文件上传安全**: 类型验证、大小限制、MD5 去重
- ⚠️ **CSRF 防护**: 建议生产环境添加 Token

---

## 待办事项

### 高优先级
- [ ] 添加单元测试（后端 pytest，前端 Jest）
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

## 相关文档

- [RULES_TREE_GUIDE.md](RULES_TREE_GUIDE.md) - 规则树功能完整指南
- [FRONTEND_ENHANCEMENTS.md](FRONTEND_ENHANCEMENTS.md) - 前端功能增强记录
- [INTEGRATION_COMPLETE.md](INTEGRATION_COMPLETE.md) - 功能集成完成总结

---

## 贡献指南

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

## 许可证

本项目采用 MIT 许可证

---

## 致谢

- [Flask](https://flask.palletsprojects.com/) - 轻量级 Web 框架
- [Tailwind CSS](https://tailwindcss.com/) - 原子化 CSS 框架
- [Lucide Icons](https://lucide.dev/) - 开源图标库
- [SQLite FTS5](https://www.sqlite.org/fts5.html) - 全文搜索扩展
- [SparkMD5](https://github.com/nicmart/SparkMD5) - 客户端 MD5 计算
