# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指导。

## 语言偏好

本项目使用**中文**进行问答和代码注释。请始终使用中文回复。

## 项目概述

BQBQ（表情标签）是一个基于语义森林的图片标签管理系统，用于组织和搜索表情包/梗图。采用胖客户端架构，后端使用 Python Flask，前端使用原生 JavaScript。

## 常用命令

```bash
# 安装依赖
pip install Flask Flask-CORS Pillow

# 启动后端服务器（默认地址：http://localhost:5000）
cd "精确搜索SQLite端(旧)"
python app.py
```

无需构建流程，直接运行即可。

## 架构设计

### 核心模式：语义森林

层级树状结构的关键词管理：
- 搜索"车辆"会自动匹配子节点如"汽车"、"自行车"、"卡车"（关键词膨胀）
- 支持无限层级嵌套
- 循环检测防止 A→B→C→A 的循环引用

### 并发模型：乐观锁（CAS）

- 基于版本号的冲突检测（每次规则修改都会递增 `version_id`）
- 前端冲突时自动重试最多3次
- ETag 缓存减少不必要的网络传输（HTTP 304）

### 数据流

```
前端                              后端
────                              ────
LocalStorage（本地真相源）         SQLite3 + FTS5
       ↓                               ↓
  If-None-Match: version_id  →   检查版本号
       ↓                               ↓
  304: 保持缓存                   200: 更新 LocalStorage
```

## 代码结构

主要应用代码位于 `精确搜索SQLite端(旧)/` 目录：

| 文件 | 说明 |
|------|------|
| `app.py` | Flask 后端 - 23个 API 端点，所有数据库逻辑 |
| `script.js` | 前端控制器 - TagInput、GlobalState、MemeApp 类 |
| `index.html` | 使用 Tailwind CSS 的 UI 结构 |
| `meme.db` | SQLite 数据库（首次运行时自动创建） |

### 后端核心数据表

- `images` + `images_fts` - 图片元数据及 FTS5 全文搜索索引
- `search_groups` / `search_keywords` / `search_hierarchy` - 规则树结构
- `system_meta` / `search_version_log` - CAS 版本控制

### 前端核心类

- `TagInput` - 可复用的标签胶囊组件，支持自动补全
- `GlobalState` - 集中式状态管理（clientId、rulesTree、queryTags 等）
- `MemeApp` - 主控制器，负责生命周期、API 调用、UI 渲染

## API 模式

所有规则修改请求需要携带 `client_id` 和 `base_version` 用于 CAS：
```json
{
  "client_id": "abc123",
  "base_version": 42,
  "group_name": "车辆"
}
```

响应包含冲突统计：`{"success": true, "new_version": 43, "conflicts": 0}`

## 代码风格

- Python: PEP 8
- JavaScript: ESLint + Prettier
- 提交信息: Conventional Commits 格式
