# -*- coding: utf-8 -*-
import os
import json
import time
import sqlite3
import hashlib
import shutil

from PIL import Image

import threading
from flask import Flask, send_file, send_from_directory, request, jsonify, Response, stream_with_context
from werkzeug.utils import secure_filename

from flask_cors import CORS

# 配置
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
IMAGE_FOLDER = os.path.join(BASE_DIR, 'meme_images')
THUMB_FOLDER = os.path.join(BASE_DIR, 'meme_images_thumbnail')
DB_PATH = os.path.join(BASE_DIR, 'meme.db')
TRASH_TAG = 'trash_bin'

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB

# 确保目录存在
os.makedirs(IMAGE_FOLDER, exist_ok=True)
os.makedirs(THUMB_FOLDER, exist_ok=True)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    
    # 基础表

    c.execute("""CREATE TABLE IF NOT EXISTS images (
        md5 TEXT PRIMARY KEY, filename TEXT, created_at REAL, 
        width INTEGER DEFAULT 0, height INTEGER DEFAULT 0, size INTEGER DEFAULT 0
    )""")
    
    c.execute("CREATE TABLE IF NOT EXISTS tags_dict (name TEXT PRIMARY KEY, use_count INTEGER DEFAULT 0)")

    # [修改] 升级为通用规则表
    c.execute("CREATE TABLE IF NOT EXISTS search_rules (keyword TEXT, target_word TEXT, type TEXT)")

    c.execute("CREATE TABLE IF NOT EXISTS user_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, qq_id TEXT, action_type TEXT, target_md5 TEXT, timestamp REAL)")

    # FTS5 表 (如果不存在)
    # 技巧: FTS5 不支持 IF NOT EXISTS，需捕获异常或检查表是否存在
    try:
        # 使用 unicode61 tokenizer 支持中文分词基础 (或者 simple)
        c.execute("CREATE VIRTUAL TABLE images_fts USING fts5(md5 UNINDEXED, tags_text)")
    except sqlite3.OperationalError:
        pass # 表已存在

    conn.commit()
    conn.close()

init_db()

# --- 核心辅助函数 ---

def update_image_index(conn, md5, tags_list):
    """同时更新 Tags 字典和 FTS 索引"""
    tags_str = " ".join(tags_list)
    
    # 1. 更新 FTS (先删后插，保持同步)
    conn.execute("DELETE FROM images_fts WHERE md5=?", (md5,))
    if tags_list:
        conn.execute("INSERT INTO images_fts (md5, tags_text) VALUES (?, ?)", (md5, tags_str))
    
    # 2. 更新 Tags 字典 (Upsert logic)
    for tag in tags_list:
        conn.execute("INSERT OR IGNORE INTO tags_dict (name, use_count) VALUES (?, 0)", (tag,))
        conn.execute("UPDATE tags_dict SET use_count = use_count + 1 WHERE name = ?", (tag,))

def log_user_action(conn, qq_id, action, md5):
    """记录用户行为"""
    if not qq_id: qq_id = "anonymous"
    conn.execute("INSERT INTO user_logs (qq_id, action_type, target_md5, timestamp) VALUES (?, ?, ?, ?)",
                 (str(qq_id), action, md5, time.time()))

# --- [新增] 元数据与规则接口 ---

@app.route('/api/meta/version')
def get_version():
    return jsonify({"version": int(time.time())}) # 简单用时间戳做版本号

@app.route('/api/meta/rules')
def get_rules():
    conn = get_db()
    # 获取高频标签
    tags = [r['name'] for r in conn.execute("SELECT name FROM tags_dict ORDER BY use_count DESC LIMIT 2000")]
    # 获取规则
    rules = {}
    rows = conn.execute("SELECT keyword, target_word FROM search_rules")
    for r in rows:
        if r['keyword'] not in rules: rules[r['keyword']] = []
        rules[r['keyword']].append(r['target_word'])
    conn.close()
    return jsonify({"version": int(time.time()), "tags": tags, "synonyms": rules})

# --- API 接口 ---

@app.route('/')
def idx(): return send_file('index.html')
@app.route('/style.css')
def css(): return send_file('style.css')
@app.route('/script.js')
def js(): return send_file('script.js')
@app.route('/images/<path:f>')
def img(f): return send_from_directory(IMAGE_FOLDER, f)
@app.route('/thumbnails/<path:f>')
def thumb(f): 
    # 如果缩略图不存在，回退到原图
    if not os.path.exists(os.path.join(THUMB_FOLDER, f)):
        return send_from_directory(IMAGE_FOLDER, f)
    return send_from_directory(THUMB_FOLDER, f)

@app.route('/api/explore', methods=['POST']) # [修改] 改为 POST 接收复杂参数
def explore():
    data = request.json
    offset = data.get('offset', 0)
    limit = data.get('limit', 50)
    sort_by = data.get('sort_by', 'date_desc')
    conditions = data.get('conditions', []) # AND 组
    excludes = data.get('excludes', [])

    conn = get_db()
    fts_parts = []
    
    # 1. 构建 FTS 查询 (把前端传来的 OR 组转为 SQL)
    for group in conditions:
        words = [f'"{w.replace('"', '""')}"' for w in group if w.strip()]
        if words:
            if len(words) > 1:
                fts_parts.append(f"({' OR '.join(words)})")
            else:
                fts_parts.append(words[0])
    
    for ex in excludes:
        if ex.strip():
            fts_parts.append(f"NOT \"{ex.replace('"', '""')}\"")

    where_clause = ""
    params = []

    if fts_parts:

            
        fts_query = " AND ".join(fts_parts)
        where_clause = "WHERE i.md5 IN (SELECT md5 FROM images_fts WHERE images_fts MATCH ?)"
        params.append(fts_query)
    
    # [新增] 获取总数用于前端分页计算
    count_sql = f"SELECT COUNT(*) FROM images i {where_clause}"
    total_count = conn.execute(count_sql, params[:-2] if params else []).fetchone()[0]

    # 2. 处理排序
    order_map = {
        'size_desc': "ORDER BY i.size DESC",
        'res_desc': "ORDER BY (i.width * i.height) DESC",
        'date_asc': "ORDER BY i.created_at ASC",
        'date_desc': "ORDER BY i.created_at DESC"
    }
    order_sql = order_map.get(sort_by, order_map['date_desc'])

    sql = f"""
        SELECT i.*, f.tags_text 
        FROM images i LEFT JOIN images_fts f ON i.md5 = f.md5 
        {where_clause} {order_sql} LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])

    cursor = conn.execute(sql, params)
    rows = cursor.fetchall()
    
    results = []
    for r in rows:
        tags = r['tags_text'].split(' ') if r['tags_text'] else []
        results.append({
            "md5": r['md5'],
            "filename": r['filename'],
            "url": f"/images/{r['filename']}",
            "tags": tags,
            "w": r['width'], "h": r['height'], "size": r['size'],
            "is_trash": TRASH_TAG in tags
        })
       
    conn.close()
    return jsonify({"results": results, "total": total_count})       




@app.route('/api/operate', methods=['POST'])
def operate():
    """统一处理上传和保存"""
    # 接收参数
    action = request.form.get('action') # 'upload' or 'update_tags'
    qq_id = request.form.get('qq_id')
    tags_str = request.form.get('tags', '') # JSON string list
    
    conn = get_db()
    try:
        tags = json.loads(tags_str)
        tags = [t.strip() for t in tags if t.strip()]
        
        if action == 'upload':
            f = request.files.get('file')
            if not f: return jsonify({"success": False, "msg": "No file"})
            
            # MD5 计算
            file_blob = f.read()
            md5 = hashlib.md5(file_blob).hexdigest()
            f.seek(0)
            file_size = len(file_blob) # [新增] 获取大小
            
            # 查重
            exists = conn.execute("SELECT md5 FROM images WHERE md5=?", (md5,)).fetchone()
            if exists:
                return jsonify({"success": False, "msg": "Image exists", "md5": md5})
            
            # 保存
            ext = os.path.splitext(f.filename)[1]
            fname = f"{md5}{ext}"            
            # [新增] 用 Pillow 读取尺寸
            try:
                img_obj = Image.open(f)
                w, h = img_obj.size
            except: w, h = 0, 0
            
            f.seek(0)
            f.save(os.path.join(IMAGE_FOLDER, fname))
            
            conn.execute("INSERT INTO images (md5, filename, created_at, width, height, size) VALUES (?, ?, ?, ?, ?, ?)", 
                         (md5, fname, time.time(), w, h, file_size))

            update_image_index(conn, md5, tags)
            log_user_action(conn, qq_id, 'UPLOAD', md5)
            
        elif action == 'update_tags':
            md5 = request.form.get('md5')
            update_image_index(conn, md5, tags)
            log_user_action(conn, qq_id, 'EDIT', md5)
            
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "msg": str(e)})
    finally:
        conn.close()

# 保持原来的 IO 接口 (略作简化)
@app.route('/api/io/export')
def export_data():
    conn = get_db()
    # 简单导出所有数据为 JSON
    c = conn.cursor()
    c.execute("SELECT i.md5, i.filename, f.tags_text FROM images i LEFT JOIN images_fts f ON i.md5 = f.md5")
    data = [{"md5": r[0], "filename": r[1], "tags": r[2].split() if r[2] else []} for r in c.fetchall()]
    conn.close()
    return Response(json.dumps(data, ensure_ascii=False), mimetype='application/json', 
                   headers={'Content-Disposition': 'attachment;filename=backup.json'})

if __name__ == '__main__':
    
    CORS(app) 
    app.run(host='0.0.0.0', port=5000, debug=True)