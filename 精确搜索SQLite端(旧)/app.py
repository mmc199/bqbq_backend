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
    def add_group(group_name):
        """创建一个新组"""
        def write_func(conn):
            # 获取当前最大的 group_id 并 +1 作为新 ID (简单实现)
            max_id = conn.execute("SELECT MAX(group_id) FROM search_groups").fetchone()[0]
            new_id = (max_id or 0) + 1
            
            conn.execute("INSERT INTO search_groups (group_id, group_name) VALUES (?, ?)", 
                        (new_id, group_name))
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
    def add_hierarchy(parent_id, child_id):
        """建立父子关系 (层级拖拽)"""
        def write_func(conn):
            # 检查父ID和子ID是否相同
            if parent_id == child_id:
                raise ValueError("Cannot link group to itself")
            
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
        """核心乐观锁和冲突处理逻辑"""
        
        result_value = None # 用于存储 write_func 可能返回的值 (如新 ID)


        with MemeService.get_conn() as conn:
            conn.execute("BEGIN EXCLUSIVE TRANSACTION")
            try:
                meta = conn.execute("SELECT version_id FROM system_meta WHERE key='rules_state'").fetchone()
                current_version = meta['version_id']

                if current_version != base_version:
                    # 冲突处理
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
                        "unique_modifiers": conflict_count_row[0]
                    }
                
                # 执行写操作（write_func 必须接收 conn 参数）
                result_value = write_func(conn)

                # 更新版本号
                new_version = current_version + 1
                now = time.time()
                conn.execute("UPDATE system_meta SET version_id=?, last_updated_at=? WHERE key='rules_state'", 
                            (new_version, now))
                conn.execute("INSERT INTO search_version_log (version_id, modifier_id, updated_at) VALUES (?, ?, ?)", 
                            (new_version, client_id, now))
                
                conn.commit()

                response_data = {"success": True, "version_id": new_version, "status": 200}
            
                if result_value is not None:
                        # 如果 write_func 返回了值，将其添加到响应中 (例如 group/add 返回 new_id)
                        response_data['new_id'] = result_value
                        
                return response_data

            except Exception as e:
                conn.rollback()
                print(f"Transaction failed: {e}")
                return {"success": False, "status": 500, "error": str(e)}

    @staticmethod
    def add_keyword_to_group(group_id, keyword):
        """用于 try_write 包装的示例写操作"""
        def write_func(conn):
            conn.execute("INSERT OR REPLACE INTO search_keywords (keyword, group_id) VALUES (?, ?)", 
                        (keyword, group_id))
        return write_func        



    @staticmethod
    def search(params):
        # ... (保持不变) ...
        offset = params.get('offset', 0)
        limit = params.get('limit', 50)
        keywords = params.get('keywords', [])
        excludes = params.get('excludes', [])
        sort_by = params.get('sort_by', 'date_desc')

        where_clauses = ["1=1"]
        sql_params = []

        for kw in keywords:
            where_clauses.append("f.tags_text LIKE ?")
            sql_params.append(f"%{kw}%")
        
        for ex in excludes:
            where_clauses.append("f.tags_text NOT LIKE ?")
            sql_params.append(f"%{ex}%")

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
        """使用指定的参数生成缩略图"""
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
        except Exception as e:
            print(f"Thumbnail generation failed for {source_path}: {e}")

    @staticmethod
    def handle_upload(file_obj):
        blob = file_obj.read()
        md5 = hashlib.md5(blob).hexdigest()
        file_obj.seek(0)
        
        with MemeService.get_conn() as conn:
            if conn.execute("SELECT 1 FROM images WHERE md5=?", (md5,)).fetchone():
                return False, "Duplicate image"
                
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

# Initialize DB
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
    base_version = data.get('base_version')
    client_id = data.get('client_id')
    group_name = data.get('group_name')

    if None in [base_version, client_id, group_name]:
        return jsonify({"success": False, "error": "Missing parameters"}), 400

    result = MemeService.try_write(
        base_version, client_id, 
        MemeService.add_group(group_name)
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

@app.route('/api/meta/tags')
def api_tags():
    with MemeService.get_conn() as conn:
        rows = conn.execute("SELECT name FROM tags_dict ORDER BY use_count DESC LIMIT 1000")
        tags = [r[0] for r in rows]
    return jsonify(tags)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)