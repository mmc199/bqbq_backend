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
        elif sort_by == 'resolution_desc': order_sql = "ORDER BY (i.width * i.height) DESC"
        elif sort_by == 'resolution_asc': order_sql = "ORDER BY (i.width * i.height) ASC"

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

@app.route('/api/meta/tags')
def api_tags():
    with MemeService.get_conn() as conn:
        rows = conn.execute("SELECT name FROM tags_dict ORDER BY use_count DESC LIMIT 1000")
        tags = [r[0] for r in rows]
    return jsonify(tags)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)