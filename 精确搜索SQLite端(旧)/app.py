# -*- coding: utf-8 -*-
import os
import json
import time
import sqlite3
import hashlib
import random  # 新增: 用于随机抽取帧
from flask import Flask, send_file, send_from_directory, request, jsonify
from flask_cors import CORS
from PIL import Image
from flask import abort

# --- Configuration ---
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
FOLDERS = {
    'img': os.path.join(BASE_DIR, 'meme_images'),
    'thumb': os.path.join(BASE_DIR, 'meme_images_thumbnail')
}
DB_PATH = os.path.join(BASE_DIR, 'meme.db')
THUMBNAIL_MAX_SIZE = 600  # 新增: 缩略图最大尺寸

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024
CORS(app)

# Ensure directories exist
for p in FOLDERS.values():
    os.makedirs(p, exist_ok=True)

# --- Database Service ---
class MemeService:
    @staticmethod
    def get_conn():
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def init_db():
        with MemeService.get_conn() as conn:
            # 创建表结构
            conn.execute("""CREATE TABLE IF NOT EXISTS images (
                md5 TEXT PRIMARY KEY, filename TEXT, created_at REAL,
                width INTEGER DEFAULT 0, height INTEGER DEFAULT 0, size INTEGER DEFAULT 0
            )""")
            conn.execute("CREATE TABLE IF NOT EXISTS tags_dict (name TEXT PRIMARY KEY, use_count INTEGER DEFAULT 0)")
            try:
                conn.execute("CREATE VIRTUAL TABLE images_fts USING fts5(md5 UNINDEXED, tags_text)")
            except sqlite3.OperationalError:
                pass

            conn.execute("""CREATE TABLE IF NOT EXISTS search_groups (
                group_id INTEGER PRIMARY KEY, group_name TEXT NOT NULL, is_enabled BOOLEAN DEFAULT 1
            )""")
            conn.execute("""CREATE TABLE IF NOT EXISTS search_keywords (
                keyword TEXT NOT NULL, group_id INTEGER, is_enabled BOOLEAN DEFAULT 1,
                FOREIGN KEY (group_id) REFERENCES search_groups(group_id),
                PRIMARY KEY (keyword, group_id)
            )""")
            conn.execute("""CREATE TABLE IF NOT EXISTS search_hierarchy (
                parent_id INTEGER, child_id INTEGER,
                FOREIGN KEY (parent_id) REFERENCES search_groups(group_id),
                FOREIGN KEY (child_id) REFERENCES search_groups(group_id),
                PRIMARY KEY (parent_id, child_id)
            )""")
            conn.execute("""CREATE TABLE IF NOT EXISTS system_meta (
                key TEXT PRIMARY KEY, version_id INTEGER DEFAULT 0, last_updated_at REAL
            )""")
            conn.execute("""CREATE TABLE IF NOT EXISTS search_version_log (
                version_id INTEGER PRIMARY KEY, modifier_id TEXT, updated_at REAL
            )""")

            # 创建性能优化索引
            try:
                conn.execute("CREATE INDEX IF NOT EXISTS idx_keywords_group ON search_keywords(group_id)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_hierarchy_child ON search_hierarchy(child_id)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_hierarchy_parent ON search_hierarchy(parent_id)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at DESC)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_images_size ON images(size DESC)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_images_resolution ON images(height DESC, width DESC)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_version_log_time ON search_version_log(updated_at DESC)")
            except sqlite3.OperationalError as e:
                print(f"Index creation warning (may already exist): {e}")

            # 插入初始 Meta 记录
            conn.execute("INSERT OR IGNORE INTO system_meta (key, version_id, last_updated_at) VALUES (?, 0, ?)",
                        ('rules_state', time.time()))
            conn.commit()

    @staticmethod
    def update_index(md5, tags):
        # ... (保持不变) ...
        clean_tags = [t.strip() for t in tags if t.strip()]
        tags_str = " ".join(clean_tags)
        
        with MemeService.get_conn() as conn:
            conn.execute("DELETE FROM images_fts WHERE md5=?", (md5,))
            if tags_str:
                conn.execute("INSERT INTO images_fts (md5, tags_text) VALUES (?, ?)", (md5, tags_str))
            
            for t in clean_tags:
                conn.execute("INSERT OR IGNORE INTO tags_dict (name, use_count) VALUES (?, 0)", (t,))
                conn.execute("UPDATE tags_dict SET use_count = use_count + 1 WHERE name = ?", (t,))
            conn.commit()

    @staticmethod
    def get_rules_data(conn):
        """获取所有规则的扁平化 JSON 结构和当前版本号"""
        meta = conn.execute("SELECT version_id FROM system_meta WHERE key='rules_state'").fetchone()
        current_version = meta['version_id'] if meta else 0

        groups = conn.execute("SELECT * FROM search_groups").fetchall()
        keywords = conn.execute("SELECT * FROM search_keywords").fetchall()
        hierarchy = conn.execute("SELECT * FROM search_hierarchy").fetchall()

        return {
            "version_id": current_version,
            "groups": [dict(row) for row in groups],
            "keywords": [dict(row) for row in keywords],
            "hierarchy": [dict(row) for row in hierarchy]
        }
    
    @staticmethod
    def add_group(group_name, is_enabled=1):
        """创建一个新组"""
        def write_func(conn):
            # 获取当前最大的 group_id 并 +1 作为新 ID (简单实现)
            max_id = conn.execute("SELECT MAX(group_id) FROM search_groups").fetchone()[0]
            new_id = (max_id or 0) + 1

            # 确保 group_name 不为空
            safe_name = group_name.strip() if group_name else ''
            if not safe_name:
                raise ValueError("group_name cannot be empty")

            conn.execute("INSERT INTO search_groups (group_id, group_name, is_enabled) VALUES (?, ?, ?)",
                        (new_id, safe_name, is_enabled))
            return new_id # 返回新 ID 供前端使用
        return write_func

    @staticmethod
    def update_group(group_id, group_name, is_enabled):
        """更新组名或软删状态"""
        def write_func(conn):
            conn.execute("UPDATE search_groups SET group_name=?, is_enabled=? WHERE group_id=?",
                        (group_name, is_enabled, group_id))
        return write_func

    @staticmethod
    def toggle_group_enabled(group_id, is_enabled):
        """仅切换组的启用/禁用状态（软删除/恢复）"""
        def write_func(conn):
            conn.execute("UPDATE search_groups SET is_enabled=? WHERE group_id=?",
                        (is_enabled, group_id))
        return write_func

    @staticmethod
    def delete_group_cascade(group_id):
        """
        彻底删除一个组及其所有子组、关键词和层级关系（递归删除）
        """
        def write_func(conn):
            # 递归收集所有需要删除的组ID（包括子组）
            def collect_all_descendants(gid):
                ids = [gid]
                children = conn.execute(
                    "SELECT child_id FROM search_hierarchy WHERE parent_id=?",
                    (gid,)
                ).fetchall()
                for child in children:
                    ids.extend(collect_all_descendants(child['child_id']))
                return ids

            all_group_ids = collect_all_descendants(group_id)

            # 删除所有相关的关键词
            for gid in all_group_ids:
                conn.execute("DELETE FROM search_keywords WHERE group_id=?", (gid,))

            # 删除所有相关的层级关系（作为父或子）
            for gid in all_group_ids:
                conn.execute("DELETE FROM search_hierarchy WHERE parent_id=? OR child_id=?", (gid, gid))

            # 删除所有组
            for gid in all_group_ids:
                conn.execute("DELETE FROM search_groups WHERE group_id=?", (gid,))

            return len(all_group_ids)  # 返回删除的组数量

        return write_func
    
    @staticmethod
    def has_hierarchy_cycle(conn, parent_id, child_id):
        """
        检测添加 parent_id -> child_id 关系是否会形成环路。

        算法：从 parent_id 开始，沿着 parent 方向 DFS，如果能走到 child_id，
        说明 child_id 是 parent_id 的祖先，添加此关系会形成环。

        Args:
            conn: 数据库连接
            parent_id: 待添加的父节点ID
            child_id: 待添加的子节点ID

        Returns:
            bool: True 表示会形成环，False 表示安全
        """
        if parent_id == child_id:
            return True  # 自引用必然成环

        visited = set()

        def dfs(current_node):
            """从 current_node 向上查找所有父节点，检测是否能到达 child_id"""
            if current_node == child_id:
                return True  # 找到 child_id，说明它是祖先，会形成环

            if current_node in visited:
                return False  # 已访问过，避免无限循环

            visited.add(current_node)

            # 查找 current_node 的所有父节点
            parents = conn.execute(
                "SELECT parent_id FROM search_hierarchy WHERE child_id=?",
                (current_node,)
            ).fetchall()

            # 递归检查每个父节点
            for parent_row in parents:
                if dfs(parent_row['parent_id']):
                    return True

            return False

        # 从 parent_id 开始向上查找，检测 child_id 是否是其祖先
        return dfs(parent_id)

    @staticmethod
    def add_hierarchy(parent_id, child_id):
        """建立父子关系 (层级拖拽) - 增强版循环检测"""
        def write_func(conn):
            # 检查父ID和子ID是否相同
            if parent_id == child_id:
                raise ValueError("Cannot link group to itself")

            # parent_id = 0 表示设置为根节点,无需检测循环
            if parent_id != 0:
                # 检查是否会形成环路（关键修复）
                if MemeService.has_hierarchy_cycle(conn, parent_id, child_id):
                    raise ValueError("Cannot create cycle in hierarchy")

            # 插入新关系，忽略已存在
            conn.execute("INSERT OR IGNORE INTO search_hierarchy (parent_id, child_id) VALUES (?, ?)",
                        (parent_id, child_id))
        return write_func
    
    @staticmethod
    def remove_hierarchy(parent_id, child_id):
        """删除父子关系"""
        def write_func(conn):
            conn.execute("DELETE FROM search_hierarchy WHERE parent_id=? AND child_id=?", 
                        (parent_id, child_id))
        return write_func

    @staticmethod
    def remove_keyword_from_group(group_id, keyword):
        """从指定组中删除关键词"""
        def write_func(conn):
            conn.execute("DELETE FROM search_keywords WHERE keyword=? AND group_id=?", 
                        (keyword, group_id))
        return write_func

    @staticmethod
    def try_write(base_version, client_id, write_func):
        """核心乐观锁和冲突处理逻辑（修复版）"""

        result_value = None # 用于存储 write_func 可能返回的值 (如新 ID)

        with MemeService.get_conn() as conn:
            try:
                # 开始独占事务
                conn.execute("BEGIN EXCLUSIVE TRANSACTION")

                # 读取当前版本号
                meta = conn.execute("SELECT version_id FROM system_meta WHERE key='rules_state'").fetchone()
                current_version = meta['version_id'] if meta else 0

                # 版本冲突检测
                if current_version != base_version:
                    # 显式回滚事务，释放锁
                    conn.rollback()

                    # 在事务外重新查询最新数据（避免持有锁）
                    conflict_count_row = conn.execute(
                        "SELECT COUNT(DISTINCT modifier_id) FROM search_version_log WHERE version_id > ?",
                        (base_version,)
                    ).fetchone()

                    latest_data = MemeService.get_rules_data(conn)

                    return {
                        "success": False,
                        "status": 409,
                        "error": "conflict",
                        "latest_data": latest_data,
                        "unique_modifiers": conflict_count_row[0] if conflict_count_row else 0
                    }

                # 执行写操作（write_func 必须接收 conn 参数）
                result_value = write_func(conn)

                # 更新版本号和日志
                new_version = current_version + 1
                now = time.time()
                conn.execute("UPDATE system_meta SET version_id=?, last_updated_at=? WHERE key='rules_state'",
                            (new_version, now))
                conn.execute("INSERT INTO search_version_log (version_id, modifier_id, updated_at) VALUES (?, ?, ?)",
                            (new_version, client_id, now))

                # 提交事务
                conn.commit()

                response_data = {"success": True, "version_id": new_version, "status": 200}

                if result_value is not None:
                    # 如果 write_func 返回了值，将其添加到响应中 (例如 group/add 返回 new_id)
                    response_data['new_id'] = result_value

                return response_data

            except Exception as e:
                # 确保异常时回滚
                conn.rollback()
                print(f"Transaction failed: {e}")
                import traceback
                traceback.print_exc()  # 打印完整堆栈，便于调试
                return {"success": False, "status": 500, "error": str(e)}

    @staticmethod
    def add_keyword_to_group(group_id, keyword):
        """用于 try_write 包装的示例写操作"""
        def write_func(conn):
            conn.execute("INSERT OR REPLACE INTO search_keywords (keyword, group_id) VALUES (?, ?)",
                        (keyword, group_id))
        return write_func

    @staticmethod
    def batch_toggle_groups(group_ids, is_enabled):
        """批量启用/禁用组"""
        def write_func(conn):
            if not group_ids:
                return 0
            placeholders = ','.join(['?'] * len(group_ids))
            conn.execute(
                f"UPDATE search_groups SET is_enabled=? WHERE group_id IN ({placeholders})",
                [is_enabled] + list(group_ids)
            )
            return len(group_ids)
        return write_func

    @staticmethod
    def batch_delete_groups(group_ids):
        """批量删除组及其所有子组、关键词和层级关系（递归删除）"""
        def write_func(conn):
            if not group_ids:
                return 0

            # 递归收集所有需要删除的组ID（包括子组）
            def collect_all_descendants(gid):
                ids = [gid]
                children = conn.execute(
                    "SELECT child_id FROM search_hierarchy WHERE parent_id=?",
                    (gid,)
                ).fetchall()
                for child in children:
                    ids.extend(collect_all_descendants(child['child_id']))
                return ids

            # 收集所有要删除的组ID
            all_group_ids = []
            for gid in group_ids:
                all_group_ids.extend(collect_all_descendants(gid))

            # 去重
            all_group_ids = list(set(all_group_ids))

            if not all_group_ids:
                return 0

            placeholders = ','.join(['?'] * len(all_group_ids))

            # 删除所有相关的关键词
            conn.execute(f"DELETE FROM search_keywords WHERE group_id IN ({placeholders})", all_group_ids)

            # 删除所有相关的层级关系（作为父或子）
            conn.execute(
                f"DELETE FROM search_hierarchy WHERE parent_id IN ({placeholders}) OR child_id IN ({placeholders})",
                all_group_ids + all_group_ids
            )

            # 删除所有组
            conn.execute(f"DELETE FROM search_groups WHERE group_id IN ({placeholders})", all_group_ids)

            return len(all_group_ids)

        return write_func

    @staticmethod
    def batch_move_hierarchy(parent_id, child_ids):
        """
        批量移动多个组到同一个父节点
        - 先移除每个子组的所有现有父关系
        - 再建立新的父子关系（如果 parent_id != 0）

        Args:
            parent_id: 目标父组 ID（0 表示移动到根节点）
            child_ids: 要移动的子组 ID 列表

        Returns:
            write_func: 用于 try_write 的写操作函数
        """
        def write_func(conn):
            if not child_ids:
                return {"moved": 0, "errors": []}

            moved_count = 0
            errors = []

            for child_id in child_ids:
                try:
                    # 跳过自引用
                    if parent_id == child_id:
                        errors.append({"child_id": child_id, "error": "Cannot link group to itself"})
                        continue

                    # 检查循环引用（parent_id != 0 时）
                    if parent_id != 0:
                        if MemeService.has_hierarchy_cycle(conn, parent_id, child_id):
                            errors.append({"child_id": child_id, "error": "Would create cycle"})
                            continue

                    # 移除所有现有父关系
                    conn.execute("DELETE FROM search_hierarchy WHERE child_id=?", (child_id,))

                    # 建立新的父子关系（如果不是移动到根节点）
                    if parent_id != 0:
                        conn.execute(
                            "INSERT OR IGNORE INTO search_hierarchy (parent_id, child_id) VALUES (?, ?)",
                            (parent_id, child_id)
                        )

                    moved_count += 1

                except Exception as e:
                    errors.append({"child_id": child_id, "error": str(e)})

            return {"moved": moved_count, "errors": errors}

        return write_func        



    @staticmethod
    def search(params):
        """
        搜索图片
        - keywords: 二维数组，每个子数组是一个标签膨胀后的关键词列表（子数组内OR，子数组间AND）
        - excludes: 二维数组，每个子数组是一个排除标签膨胀后的关键词列表（子数组内OR，子数组间AND排除）
        - excludes_and: 三维数组，交集排除，结构为 [[[kw1膨胀组], [kw2膨胀组]], ...]
                        每个胶囊内的关键词组需要同时匹配才排除（组内OR，组间AND，整体NOT）
        - extensions: 包含的扩展名列表（如 ['gif', 'png']）
        - exclude_extensions: 排除的扩展名列表
        - min_tags: 最小标签数量 (可选)
        - max_tags: 最大标签数量 (可选，-1 表示无限制)
        """
        offset = params.get('offset', 0)
        limit = params.get('limit', 50)
        keywords_groups = params.get('keywords', [])  # 二维数组: [[kw1a, kw1b], [kw2a, kw2b]]
        excludes_groups = params.get('excludes', [])  # 二维数组: [[ex1a, ex1b], [ex2a, ex2b]]
        excludes_and_groups = params.get('excludes_and', [])  # 三维数组: 交集排除 [[[kw1a, kw1b], [kw2a, kw2b]], ...]
        extensions = params.get('extensions', [])  # 扩展名列表: ['gif', 'png']
        exclude_extensions = params.get('exclude_extensions', [])  # 排除扩展名列表
        sort_by = params.get('sort_by', 'date_desc')

        # 新增：标签数量筛选参数
        min_tags = params.get('min_tags', 0)
        max_tags = params.get('max_tags', -1)

        # 参数类型转换和校验
        try:
            min_tags = int(min_tags) if min_tags is not None else 0
        except (TypeError, ValueError):
            min_tags = 0

        try:
            max_tags = int(max_tags) if max_tags is not None else -1
        except (TypeError, ValueError):
            max_tags = -1

        where_clauses = ["1=1"]
        sql_params = []

        # 处理包含关键词组（AND 关系，每组内部是 OR 关系）
        for kw_group in keywords_groups:
            if not kw_group:
                continue
            # 每个组内的关键词用 OR 连接
            or_conditions = []
            for kw in kw_group:
                or_conditions.append("f.tags_text LIKE ?")
                sql_params.append(f"%{kw}%")
            if or_conditions:
                where_clauses.append(f"({' OR '.join(or_conditions)})")

        # 处理排除关键词组（AND 排除，每组内部是 OR 关系 -> 任一命中即排除）
        for ex_group in excludes_groups:
            if not ex_group:
                continue
            # 每个组内的关键词用 OR 连接，整体取反
            or_conditions = []
            for ex in ex_group:
                or_conditions.append("f.tags_text LIKE ?")
                sql_params.append(f"%{ex}%")
            if or_conditions:
                where_clauses.append(f"NOT ({' OR '.join(or_conditions)})")

        # 处理交集排除关键词组（每个胶囊内的多个关键词组需要同时匹配才排除）
        # 结构: [[[kw1a, kw1b], [kw2a, kw2b]], ...]
        # 每个胶囊: [[kw1膨胀组], [kw2膨胀组], ...]
        # 排除条件: 所有关键词组都至少匹配一个时才排除
        for capsule in excludes_and_groups:
            if not capsule:
                continue
            # 每个关键词组内部是 OR 关系（膨胀后的同义词）
            # 关键词组之间是 AND 关系（交集）
            and_conditions = []
            for kw_group in capsule:
                if not kw_group:
                    continue
                or_conditions = []
                for kw in kw_group:
                    or_conditions.append("f.tags_text LIKE ?")
                    sql_params.append(f"%{kw}%")
                if or_conditions:
                    and_conditions.append(f"({' OR '.join(or_conditions)})")
            if and_conditions:
                # 所有条件都满足时才排除
                where_clauses.append(f"NOT ({' AND '.join(and_conditions)})")

        # 处理包含扩展名（多个扩展名之间是 OR 关系）
        if extensions:
            ext_conditions = []
            for ext in extensions:
                # 移除可能的前导点号，统一处理
                clean_ext = ext.lstrip('.')
                ext_conditions.append("i.filename LIKE ?")
                sql_params.append(f"%.{clean_ext}")
            if ext_conditions:
                where_clauses.append(f"({' OR '.join(ext_conditions)})")

        # 处理排除扩展名（多个扩展名之间是 OR 关系，整体取反）
        if exclude_extensions:
            ext_conditions = []
            for ext in exclude_extensions:
                clean_ext = ext.lstrip('.')
                ext_conditions.append("i.filename LIKE ?")
                sql_params.append(f"%.{clean_ext}")
            if ext_conditions:
                where_clauses.append(f"NOT ({' OR '.join(ext_conditions)})")

        # 新增：标签数量筛选逻辑
        # 计算每个图片的标签数量 (通过空格分割 tags_text 计算)
        # tags_text 格式: "tag1 tag2 tag3" 或空字符串/NULL
        tag_count_filter = ""

        # 检查是否需要应用标签数量筛选
        needs_tag_count_filter = min_tags > 0 or (max_tags >= 0)

        if needs_tag_count_filter:
            # 使用子查询计算标签数量
            # LENGTH(tags_text) - LENGTH(REPLACE(tags_text, ' ', '')) + 1 计算空格数 + 1 = 标签数
            # 对于空字符串/NULL，标签数为 0
            tag_count_expr = """
                CASE
                    WHEN f.tags_text IS NULL OR f.tags_text = '' THEN 0
                    ELSE LENGTH(f.tags_text) - LENGTH(REPLACE(f.tags_text, ' ', '')) + 1
                END
            """

            if min_tags > 0 and max_tags >= 0:
                # 同时有最小和最大限制
                where_clauses.append(f"({tag_count_expr}) >= {min_tags}")
                where_clauses.append(f"({tag_count_expr}) <= {max_tags}")
            elif min_tags > 0:
                # 只有最小限制
                where_clauses.append(f"({tag_count_expr}) >= {min_tags}")
            elif max_tags >= 0:
                # 只有最大限制 (包括 max_tags=0 表示无标签)
                where_clauses.append(f"({tag_count_expr}) <= {max_tags}")

        where_sql = " WHERE " + " AND ".join(where_clauses)

        order_sql = "ORDER BY i.created_at DESC"
        if sort_by == 'date_desc': order_sql = "ORDER BY i.created_at DESC"
        elif sort_by == 'date_asc': order_sql = "ORDER BY i.created_at ASC"
        elif sort_by == 'size_desc': order_sql = "ORDER BY i.size DESC"
        elif sort_by == 'size_asc': order_sql = "ORDER BY i.size ASC"
        elif sort_by == 'resolution_desc': order_sql = "ORDER BY i.height DESC, i.width DESC"
        elif sort_by == 'resolution_asc': order_sql = "ORDER BY i.height ASC, i.width ASC"

        query = f"""
            SELECT i.*, f.tags_text
            FROM images i
            LEFT JOIN images_fts f ON i.md5 = f.md5
            {where_sql}
            {order_sql}
            LIMIT ? OFFSET ?
        """
        count_query = f"""
            SELECT COUNT(*)
            FROM images i
            LEFT JOIN images_fts f ON i.md5 = f.md5
            {where_sql}
        """

        with MemeService.get_conn() as conn:
            total = conn.execute(count_query, sql_params).fetchone()[0]
            cursor = conn.execute(query, sql_params + [limit, offset])
            rows = cursor.fetchall()

        results = []
        for r in rows:
            tags_text = r['tags_text'] if r['tags_text'] else ""
            tags = tags_text.split(' ') if tags_text else []
            results.append({
                "md5": r['md5'],
                "filename": r['filename'],
                "tags": tags,
                "w": r['width'], "h": r['height'], "size": r['size'],
                "is_trash": 'trash_bin' in tags
            })
        return {"total": total, "results": results}

    # --- 新增/修改的核心部分 ---

    @staticmethod
    def _extract_random_frame(img):
        """如果是动图，随机抽取一帧"""
        try:
            if getattr(img, "is_animated", False) and img.n_frames > 1:
                img.seek(random.randint(0, img.n_frames - 1))
        except Exception:
            pass
        return img.copy()

    @staticmethod
    def _create_thumbnail_file(source_path, thumb_path):
        """
        使用指定的参数生成缩略图

        Returns:
            bool: True 表示成功，False 表示失败
        """
        try:
            with Image.open(source_path) as img:
                frame = MemeService._extract_random_frame(img)

                # 转换模式，确保兼容 JPEG
                if frame.mode not in ("RGB", "L"):
                    frame = frame.convert("RGB")
                elif frame.mode == "L":
                    frame = frame.convert("RGB") # 强制转RGB以保持一致性

                # 缩放
                frame.thumbnail((THUMBNAIL_MAX_SIZE, THUMBNAIL_MAX_SIZE), Image.LANCZOS)

                # 确保目录存在
                os.makedirs(os.path.dirname(thumb_path), exist_ok=True)

                # 保存为 JPEG
                frame.save(thumb_path, "JPEG", quality=85, optimize=True)
                return True

        except Exception as e:
            print(f"Thumbnail generation failed for {source_path}: {e}")
            import traceback
            traceback.print_exc()

            # 尝试复制原图作为缩略图（降级方案）
            try:
                import shutil
                print(f"Attempting to copy original as thumbnail fallback...")
                shutil.copy(source_path, thumb_path)
                print(f"Fallback successful: copied {source_path} to {thumb_path}")
                return True
            except Exception as fallback_error:
                print(f"Fallback copy also failed: {fallback_error}")
                return False

    @staticmethod
    def handle_upload(file_obj):
        blob = file_obj.read()
        md5 = hashlib.md5(blob).hexdigest()
        file_obj.seek(0)

        with MemeService.get_conn() as conn:
            existing = conn.execute("SELECT 1 FROM images WHERE md5=?", (md5,)).fetchone()
            if existing:
                # 重复图片：更新上传时间
                conn.execute("UPDATE images SET created_at=? WHERE md5=?", (time.time(), md5))
                conn.commit()
                return False, "Duplicate image (timestamp refreshed)"

            ext = os.path.splitext(file_obj.filename)[1].lower() or '.jpg'
            filename = f"{md5}{ext}"

            # 1. 保存原图
            original_path = os.path.join(FOLDERS['img'], filename)
            file_obj.save(original_path)

            # 2. 获取原图尺寸 (为了写入数据库)
            try:
                with Image.open(original_path) as img:
                    w, h = img.size
            except:
                w, h = 0, 0

            # 3. 生成缩略图 (强制使用 .jpg)
            thumb_filename = f"{md5}_thumbnail.jpg"
            thumb_path = os.path.join(FOLDERS['thumb'], thumb_filename)
            MemeService._create_thumbnail_file(original_path, thumb_path)

            # 4. 写入数据库
            conn.execute("INSERT INTO images (md5, filename, created_at, width, height, size) VALUES (?, ?, ?, ?, ?, ?)",
                         (md5, filename, time.time(), w, h, len(blob)))
            conn.commit()

            MemeService.update_index(md5, [])

        return True, md5

    @staticmethod
    def scan_and_import_folder():
        """
        启动时扫描 meme_images 文件夹，自动导入未在数据库中的图片。
        处理文件验证、重命名、去重、缩略图生成。

        优化策略：
        1. 并行处理文件（MD5计算、缩略图生成）
        2. 批量数据库插入
        3. 移除无意义的空标签索引调用
        """
        import glob
        from concurrent.futures import ThreadPoolExecutor, as_completed

        print("[Folder Scan] Starting automatic import from meme_images folder...")

        img_folder = FOLDERS['img']
        if not os.path.exists(img_folder):
            print(f"[Folder Scan] Image folder not found: {img_folder}")
            return

        # 支持的图片格式
        supported_formats = ['*.jpg', '*.jpeg', '*.png', '*.gif', '*.webp', '*.bmp']

        # 收集所有文件路径
        all_files = []
        for pattern in supported_formats:
            file_pattern = os.path.join(img_folder, pattern)
            all_files.extend(glob.glob(file_pattern, recursive=False))
            # 也扫描大写扩展名
            file_pattern_upper = os.path.join(img_folder, pattern.upper())
            all_files.extend(glob.glob(file_pattern_upper, recursive=False))

        # 去重（同一文件可能被多个模式匹配）
        all_files = list(set(all_files))
        total_files = len(all_files)

        if total_files == 0:
            print("[Folder Scan] No image files found.")
            return

        print(f"[Folder Scan] Found {total_files} files to process...")

        # 第一阶段：获取数据库中已存在的 MD5 集合
        with MemeService.get_conn() as conn:
            existing_md5s = set(row['md5'] for row in conn.execute("SELECT md5 FROM images").fetchall())
            # 同时获取 md5 -> filename 的映射用于重命名检查
            md5_to_filename = {row['md5']: row['filename'] for row in conn.execute("SELECT md5, filename FROM images").fetchall()}

        imported_count = 0
        skipped_count = 0
        error_count = 0
        renamed_count = 0

        # 用于批量插入的数据列表
        batch_insert_data = []
        # 用于并行生成缩略图的任务列表
        thumbnail_tasks = []

        def process_single_file(file_path):
            """处理单个文件：计算MD5、重命名、获取尺寸"""
            nonlocal skipped_count, renamed_count, error_count

            try:
                # 计算文件 MD5
                with open(file_path, 'rb') as f:
                    file_data = f.read()
                    md5 = hashlib.md5(file_data).hexdigest()

                current_filename = os.path.basename(file_path)

                # 检查是否已存在
                if md5 in existing_md5s:
                    # 检查是否需要重命名
                    expected_filename = md5_to_filename.get(md5)
                    if expected_filename and current_filename != expected_filename:
                        new_path = os.path.join(img_folder, expected_filename)
                        if not os.path.exists(new_path):
                            os.rename(file_path, new_path)
                            renamed_count += 1
                    return None  # 已存在，跳过

                # 新文件处理
                ext = os.path.splitext(file_path)[1].lower() or '.jpg'
                standard_filename = f"{md5}{ext}"
                standard_path = os.path.join(img_folder, standard_filename)

                # 重命名为标准格式
                if file_path != standard_path:
                    if os.path.exists(standard_path):
                        # 目标文件已存在，删除当前重复文件
                        os.remove(file_path)
                        return None  # 重复文件，跳过
                    else:
                        os.rename(file_path, standard_path)

                # 获取图片尺寸
                try:
                    with Image.open(standard_path) as img:
                        w, h = img.size
                except Exception:
                    w, h = 0, 0

                file_size = len(file_data)
                file_mtime = os.path.getmtime(standard_path)

                return {
                    'md5': md5,
                    'filename': standard_filename,
                    'path': standard_path,
                    'width': w,
                    'height': h,
                    'size': file_size,
                    'mtime': file_mtime
                }

            except Exception as e:
                print(f"[Folder Scan] Error processing {file_path}: {e}")
                return 'error'

        def generate_thumbnail(item):
            """生成单个缩略图"""
            thumb_filename = f"{item['md5']}_thumbnail.jpg"
            thumb_path = os.path.join(FOLDERS['thumb'], thumb_filename)
            MemeService._create_thumbnail_file(item['path'], thumb_path)
            return item['md5']

        # 第二阶段：并行处理文件（MD5计算、重命名、尺寸获取）
        print("[Folder Scan] Phase 1: Processing files (MD5, rename, dimensions)...")

        # 使用线程池并行处理
        max_workers = min(8, os.cpu_count() or 4)

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(process_single_file, fp): fp for fp in all_files}

            processed = 0
            for future in as_completed(futures):
                processed += 1
                result = future.result()

                if result is None:
                    skipped_count += 1
                elif result == 'error':
                    error_count += 1
                else:
                    batch_insert_data.append(result)
                    thumbnail_tasks.append(result)

                # 每处理100个文件输出一次进度
                if processed % 100 == 0:
                    print(f"[Folder Scan] Progress: {processed}/{total_files} files processed...")

        # 第三阶段：批量插入数据库
        if batch_insert_data:
            print(f"[Folder Scan] Phase 2: Batch inserting {len(batch_insert_data)} records to database...")

            with MemeService.get_conn() as conn:
                conn.executemany(
                    "INSERT INTO images (md5, filename, created_at, width, height, size) VALUES (?, ?, ?, ?, ?, ?)",
                    [(item['md5'], item['filename'], item['mtime'], item['width'], item['height'], item['size'])
                     for item in batch_insert_data]
                )
                conn.commit()

            imported_count = len(batch_insert_data)

        # 第四阶段：并行生成缩略图
        if thumbnail_tasks:
            print(f"[Folder Scan] Phase 3: Generating {len(thumbnail_tasks)} thumbnails in parallel...")

            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = [executor.submit(generate_thumbnail, item) for item in thumbnail_tasks]

                completed = 0
                for future in as_completed(futures):
                    completed += 1
                    if completed % 100 == 0:
                        print(f"[Folder Scan] Thumbnails: {completed}/{len(thumbnail_tasks)} generated...")

        print(f"\n[Folder Scan] Summary:")
        print(f"  - Imported: {imported_count}")
        print(f"  - Skipped (already in DB): {skipped_count}")
        print(f"  - Renamed: {renamed_count}")
        print(f"  - Errors: {error_count}")
        print(f"[Folder Scan] Automatic import completed.\n")

# Initialize DB (轻量操作，可在模块级别执行)
MemeService.init_db()

# --- Routes ---

@app.route('/')
def idx(): return send_file('index.html')

@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory('.', filename)

@app.route('/images/<path:f>')
def serve_img(f): 
    return send_from_directory(FOLDERS['img'], f)

# --- 修正后的缩略图读取接口 ---
@app.route('/thumbnails/<path:f>')
def serve_thumb(f):
    # 1. 获取不带后缀的文件名 (即 md5)
    base_name = os.path.splitext(f)[0]
    
    # 2. 拼接出强制的 jpg 缩略图文件名 (修改为 _thumbnail.jpg)
    thumb_name = f"{base_name}_thumbnail.jpg"
    
    # 3. 检查 jpg 缩略图是否存在
    p = os.path.join(FOLDERS['thumb'], thumb_name)
    if os.path.exists(p):
        return send_from_directory(FOLDERS['thumb'], thumb_name)

@app.route('/api/search', methods=['POST'])
def api_search():
    return jsonify(MemeService.search(request.json))

@app.route('/api/upload', methods=['POST'])
def api_upload():
    f = request.files.get('file')
    if not f: return jsonify({"success": False})
    ok, msg = MemeService.handle_upload(f)
    return jsonify({"success": ok, "msg": msg})

@app.route('/api/update_tags', methods=['POST'])
def api_update_tags():
    data = request.json
    MemeService.update_index(data['md5'], data['tags'])
    return jsonify({"success": True})

@app.route('/api/rules', methods=['GET'])
def api_get_rules():
    """获取规则树数据并支持 ETag 缓存"""
    with MemeService.get_conn() as conn:
        meta = conn.execute("SELECT version_id FROM system_meta WHERE key='rules_state'").fetchone()
        version_id = meta['version_id'] if meta else 0
        etag = str(version_id)
        
        if request.headers.get('If-None-Match') == etag:
            return '', 304
            
        rules_data = MemeService.get_rules_data(conn)
        
        response = jsonify(rules_data)
        response.headers['ETag'] = etag
        return response

@app.route('/api/rules/keyword/add', methods=['POST'])
def api_add_keyword():
    data = request.json
    base_version = data.get('base_version')
    client_id = data.get('client_id')
    group_id = data.get('group_id')
    keyword = data.get('keyword')

    if None in [base_version, client_id, group_id, keyword]:
        return jsonify({"success": False, "error": "Missing parameters"}), 400

    result = MemeService.try_write(
        base_version, client_id, 
        MemeService.add_keyword_to_group(group_id, keyword)
    )

    if result['status'] == 409:
        return jsonify(result), 409
    
    return jsonify({"success": result['success'], "version_id": result.get('version_id')})

@app.route('/api/rules/group/add', methods=['POST'])
def api_add_group():
    data = request.json
    print(f"[DEBUG] api_add_group received data: {data}")  # 调试日志

    base_version = data.get('base_version')
    client_id = data.get('client_id')
    group_name = data.get('group_name')
    is_enabled = data.get('is_enabled', 1)  # 默认启用

    print(f"[DEBUG] Extracted: base_version={base_version}, client_id={client_id}, group_name='{group_name}', is_enabled={is_enabled}")  # 调试日志

    if None in [base_version, client_id, group_name]:
        print(f"[DEBUG] Missing parameters! base_version={base_version}, client_id={client_id}, group_name={group_name}")
        return jsonify({"success": False, "error": "Missing parameters"}), 400

    # 检查 group_name 是否为空字符串
    if not group_name or not group_name.strip():
        print(f"[DEBUG] Empty group_name!")
        return jsonify({"success": False, "error": "group_name cannot be empty"}), 400

    result = MemeService.try_write(
        base_version, client_id,
        MemeService.add_group(group_name, is_enabled)
    )

    if result['status'] == 409:
        return jsonify(result), 409

    return jsonify({"success": result['success'], "version_id": result.get('version_id'), "new_id": result.get('new_id')})

@app.route('/api/rules/group/update', methods=['POST'])
def api_update_group():
    data = request.json
    base_version = data.get('base_version')
    client_id = data.get('client_id')
    group_id = data.get('group_id')
    group_name = data.get('group_name')
    is_enabled = data.get('is_enabled', 1) # 默认启用

    if None in [base_version, client_id, group_id, group_name]:
        return jsonify({"success": False, "error": "Missing parameters"}), 400

    result = MemeService.try_write(
        base_version, client_id, 
        MemeService.update_group(group_id, group_name, is_enabled)
    )

    if result['status'] == 409:
        return jsonify(result), 409

    return jsonify({"success": result['success'], "version_id": result.get('version_id')})


@app.route('/api/rules/group/toggle', methods=['POST'])
def api_toggle_group():
    """专用接口：切换组的启用/禁用状态（软删除/恢复）"""
    data = request.json
    base_version = data.get('base_version')
    client_id = data.get('client_id')
    group_id = data.get('group_id')
    is_enabled = data.get('is_enabled')

    if None in [base_version, client_id, group_id, is_enabled]:
        return jsonify({"success": False, "error": "Missing parameters"}), 400

    result = MemeService.try_write(
        base_version, client_id,
        MemeService.toggle_group_enabled(group_id, is_enabled)
    )

    if result['status'] == 409:
        return jsonify(result), 409

    return jsonify({"success": result['success'], "version_id": result.get('version_id')})


@app.route('/api/rules/group/delete', methods=['POST'])
def api_delete_group():
    """彻底删除一个组及其所有子组、关键词和层级关系"""
    data = request.json
    base_version = data.get('base_version')
    client_id = data.get('client_id')
    group_id = data.get('group_id')

    if None in [base_version, client_id, group_id]:
        return jsonify({"success": False, "error": "Missing parameters"}), 400

    result = MemeService.try_write(
        base_version, client_id,
        MemeService.delete_group_cascade(group_id)
    )

    if result['status'] == 409:
        return jsonify(result), 409

    return jsonify({
        "success": result['success'],
        "version_id": result.get('version_id'),
        "deleted_count": result.get('new_id')  # new_id 存储的是删除的组数量
    })


@app.route('/api/rules/group/batch', methods=['POST'])
def api_batch_group():
    """
    批量操作组（启用/禁用/删除）
    Request: {
        "group_ids": [1, 2, 3],
        "action": "enable" | "disable" | "delete",
        "base_version": 42,
        "client_id": "xxx"
    }
    Response: {
        "success": true,
        "version_id": 43,
        "affected_count": 3
    }
    """
    data = request.json
    base_version = data.get('base_version')
    client_id = data.get('client_id')
    group_ids = data.get('group_ids', [])
    action = data.get('action')

    if None in [base_version, client_id, action]:
        return jsonify({"success": False, "error": "Missing parameters"}), 400

    if not isinstance(group_ids, list) or len(group_ids) == 0:
        return jsonify({"success": False, "error": "group_ids must be a non-empty array"}), 400

    if action not in ['enable', 'disable', 'delete']:
        return jsonify({"success": False, "error": "Invalid action. Must be 'enable', 'disable', or 'delete'"}), 400

    # 根据 action 选择对应的写操作
    if action == 'enable':
        write_func = MemeService.batch_toggle_groups(group_ids, 1)
    elif action == 'disable':
        write_func = MemeService.batch_toggle_groups(group_ids, 0)
    else:  # delete
        write_func = MemeService.batch_delete_groups(group_ids)

    result = MemeService.try_write(base_version, client_id, write_func)

    if result['status'] == 409:
        return jsonify(result), 409

    return jsonify({
        "success": result['success'],
        "version_id": result.get('version_id'),
        "affected_count": result.get('new_id', len(group_ids))  # new_id 存储返回值（受影响数量）
    })


@app.route('/api/rules/keyword/remove', methods=['POST'])
def api_remove_keyword():
    data = request.json
    base_version = data.get('base_version')
    client_id = data.get('client_id')
    group_id = data.get('group_id')
    keyword = data.get('keyword')

    if None in [base_version, client_id, group_id, keyword]:
        return jsonify({"success": False, "error": "Missing parameters"}), 400

    result = MemeService.try_write(
        base_version, client_id, 
        MemeService.remove_keyword_from_group(group_id, keyword)
    )

    if result['status'] == 409:
        return jsonify(result), 409
    
    return jsonify({"success": result['success'], "version_id": result.get('version_id')})


@app.route('/api/rules/hierarchy/add', methods=['POST'])
def api_add_hierarchy():
    data = request.json
    base_version = data.get('base_version')
    client_id = data.get('client_id')
    parent_id = data.get('parent_id')
    child_id = data.get('child_id')

    if None in [base_version, client_id, parent_id, child_id]:
        return jsonify({"success": False, "error": "Missing parameters"}), 400

    result = MemeService.try_write(
        base_version, client_id, 
        MemeService.add_hierarchy(parent_id, child_id)
    )

    if result['status'] == 409:
        return jsonify(result), 409
    
    # 捕获 write_func 中抛出的 ValueError
    if result.get('error') == "Cannot link group to itself":
        return jsonify({"success": False, "error": "Cannot link group to itself"}), 400
    
    return jsonify({"success": result['success'], "version_id": result.get('version_id')})


@app.route('/api/rules/hierarchy/remove', methods=['POST'])
def api_remove_hierarchy():
    data = request.json
    base_version = data.get('base_version')
    client_id = data.get('client_id')
    parent_id = data.get('parent_id')
    child_id = data.get('child_id')

    if None in [base_version, client_id, parent_id, child_id]:
        return jsonify({"success": False, "error": "Missing parameters"}), 400

    result = MemeService.try_write(
        base_version, client_id,
        MemeService.remove_hierarchy(parent_id, child_id)
    )

    if result['status'] == 409:
        return jsonify(result), 409

    return jsonify({"success": result['success'], "version_id": result.get('version_id')})


@app.route('/api/rules/hierarchy/batch_move', methods=['POST'])
def api_batch_move_hierarchy():
    """
    批量移动多个组到同一个父节点

    Request: {
        "parent_id": 123,      // 目标父组 ID（0 表示移动到根节点）
        "child_ids": [1, 2, 3], // 要移动的子组 ID 列表
        "base_version": 42,
        "client_id": "xxx"
    }

    Response: {
        "success": true,
        "version_id": 43,
        "moved": 3,
        "errors": []
    }
    """
    data = request.json
    base_version = data.get('base_version')
    client_id = data.get('client_id')
    parent_id = data.get('parent_id')
    child_ids = data.get('child_ids', [])

    if None in [base_version, client_id, parent_id]:
        return jsonify({"success": False, "error": "Missing parameters"}), 400

    if not isinstance(child_ids, list) or len(child_ids) == 0:
        return jsonify({"success": False, "error": "child_ids must be a non-empty array"}), 400

    result = MemeService.try_write(
        base_version, client_id,
        MemeService.batch_move_hierarchy(parent_id, child_ids)
    )

    if result['status'] == 409:
        return jsonify(result), 409

    # 从 new_id 中提取移动结果
    move_result = result.get('new_id', {"moved": 0, "errors": []})
    moved_count = move_result.get('moved', 0)
    errors = move_result.get('errors', [])

    # 修复：当所有操作都失败时（moved=0），返回 success=false
    # 只有至少成功移动一个时才算成功
    is_success = result['success'] and moved_count > 0

    return jsonify({
        "success": is_success,
        "version_id": result.get('version_id'),
        "moved": moved_count,
        "errors": errors
    })

@app.route('/api/meta/tags')
def api_tags():
    with MemeService.get_conn() as conn:
        rows = conn.execute("SELECT name FROM tags_dict ORDER BY use_count DESC LIMIT 1000")
        tags = [r[0] for r in rows]
    return jsonify(tags)

@app.route('/api/check_md5', methods=['POST'])
def api_check_md5():
    """
    检查MD5是否已存在，用于前端上传前预检查。
    Request: {"md5": "abc123...", "refresh_time": true/false (optional)}
    Response: {"exists": true/false, "filename": "..." (if exists), "time_refreshed": true/false}
    """
    data = request.json
    md5 = data.get('md5')
    refresh_time = data.get('refresh_time', False)

    if not md5:
        return jsonify({"error": "Missing md5 parameter"}), 400

    with MemeService.get_conn() as conn:
        row = conn.execute("SELECT filename FROM images WHERE md5=?", (md5,)).fetchone()

        if row:
            time_refreshed = False
            if refresh_time:
                conn.execute("UPDATE images SET created_at=? WHERE md5=?", (time.time(), md5))
                conn.commit()
                time_refreshed = True
            return jsonify({"exists": True, "filename": row['filename'], "time_refreshed": time_refreshed})
        else:
            return jsonify({"exists": False})

@app.route('/api/export/all', methods=['GET'])
def api_export_all():
    """
    导出所有数据为JSON（图片标签 + 规则树）。
    注意：不包含图片文件本身，只包含元数据。
    """
    with MemeService.get_conn() as conn:
        # 1. 导出图片和标签
        images_rows = conn.execute("""
            SELECT i.md5, i.filename, i.created_at, i.width, i.height, i.size, f.tags_text
            FROM images i
            LEFT JOIN images_fts f ON i.md5 = f.md5
        """).fetchall()

        images_data = []
        for row in images_rows:
            tags_text = row['tags_text'] if row['tags_text'] else ""
            tags = tags_text.split(' ') if tags_text else []
            images_data.append({
                "md5": row['md5'],
                "filename": row['filename'],
                "created_at": row['created_at'],
                "width": row['width'],
                "height": row['height'],
                "size": row['size'],
                "tags": tags
            })

        # 2. 导出规则树
        rules_data = MemeService.get_rules_data(conn)

        # 3. 导出标签字典
        tags_dict_rows = conn.execute("SELECT name, use_count FROM tags_dict").fetchall()
        tags_dict = [{"name": r['name'], "use_count": r['use_count']} for r in tags_dict_rows]

        export_data = {
            "export_time": time.time(),
            "version": "1.0",
            "images": images_data,
            "rules": rules_data,
            "tags_dict": tags_dict
        }

        return jsonify(export_data)

@app.route('/api/import/all', methods=['POST'])
def api_import_all():
    """
    导入JSON数据（图片标签 + 规则树）。
    警告：这会覆盖现有规则树数据！图片数据会合并（相同MD5跳过）。
    """
    data = request.json

    if not data or 'images' not in data or 'rules' not in data:
        return jsonify({"success": False, "error": "Invalid import data format"}), 400

    try:
        with MemeService.get_conn() as conn:
            imported_images = 0
            skipped_images = 0

            # 1. 导入图片标签数据
            for img in data.get('images', []):
                md5 = img.get('md5')
                if not md5:
                    continue

                # 检查是否已存在
                existing = conn.execute("SELECT 1 FROM images WHERE md5=?", (md5,)).fetchone()

                if existing:
                    # 更新标签
                    tags = img.get('tags', [])
                    MemeService.update_index(md5, tags)
                    skipped_images += 1
                else:
                    # 新图片（但文件可能不存在，仅导入元数据）
                    conn.execute(
                        "INSERT INTO images (md5, filename, created_at, width, height, size) VALUES (?, ?, ?, ?, ?, ?)",
                        (md5, img.get('filename', f"{md5}.jpg"), img.get('created_at', time.time()),
                         img.get('width', 0), img.get('height', 0), img.get('size', 0))
                    )
                    tags = img.get('tags', [])
                    MemeService.update_index(md5, tags)
                    imported_images += 1

            # 2. 清空并重建规则树（覆盖模式）
            conn.execute("DELETE FROM search_keywords")
            conn.execute("DELETE FROM search_hierarchy")
            conn.execute("DELETE FROM search_groups")

            rules = data.get('rules', {})

            # 导入组
            for group in rules.get('groups', []):
                conn.execute(
                    "INSERT INTO search_groups (group_id, group_name, is_enabled) VALUES (?, ?, ?)",
                    (group['group_id'], group['group_name'], group.get('is_enabled', 1))
                )

            # 导入关键词
            for keyword in rules.get('keywords', []):
                conn.execute(
                    "INSERT INTO search_keywords (keyword, group_id, is_enabled) VALUES (?, ?, ?)",
                    (keyword['keyword'], keyword['group_id'], keyword.get('is_enabled', 1))
                )

            # 导入层级关系
            for hierarchy in rules.get('hierarchy', []):
                conn.execute(
                    "INSERT INTO search_hierarchy (parent_id, child_id) VALUES (?, ?)",
                    (hierarchy['parent_id'], hierarchy['child_id'])
                )

            # 3. 重置版本号
            conn.execute("UPDATE system_meta SET version_id=?, last_updated_at=? WHERE key='rules_state'",
                        (rules.get('version_id', 0), time.time()))

            # 4. 导入标签字典（如果提供）
            if 'tags_dict' in data:
                conn.execute("DELETE FROM tags_dict")
                for tag_info in data['tags_dict']:
                    conn.execute("INSERT INTO tags_dict (name, use_count) VALUES (?, ?)",
                                (tag_info['name'], tag_info.get('use_count', 0)))

            conn.commit()

        return jsonify({
            "success": True,
            "imported_images": imported_images,
            "skipped_images": skipped_images,
            "message": "Import completed successfully"
        })

    except Exception as e:
        print(f"Import failed: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    # 检查是否是 werkzeug reloader 的子进程
    # debug 模式下，werkzeug 会启动两个进程，只有 WERKZEUG_RUN_MAIN='true' 的才是实际运行的子进程
    is_reloader_process = os.environ.get('WERKZEUG_RUN_MAIN') == 'true'
    is_first_run = not is_reloader_process  # 如果不是 reloader 子进程，说明是首次启动

    # 只在首次启动时扫描文件夹（避免 debug 模式下执行两次）
    # 或者在非 debug 模式下正常执行
    if is_first_run:
        MemeService.scan_and_import_folder()

    app.run(host='0.0.0.0', port=5000, debug=True)