# -*- coding: utf-8 -*-
import os
import json
import hashlib


import shutil

import sys

import time


import threading
import traceback
import concurrent.futures
import random
import sqlite3
from typing import List, Dict, Any, Set

# 新增: 导入 dotenv
from dotenv import load_dotenv

# 新增依赖: pip install jieba
import jieba

from flask import Flask, send_file, send_from_directory, request, jsonify, Response, stream_with_context, redirect
from PIL import Image
from flask_cors import CORS

# =========================
# 1. 配置与常量
# =========================

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
IMAGE_FOLDER = os.path.join(BASE_DIR, 'meme_images')
THUMBNAIL_FOLDER = os.path.join(BASE_DIR, 'meme_images_thumbnail')
TRASH_SUBDIR = 'trash_bin'
TRASH_TAG = TRASH_SUBDIR
TRASH_DIR = os.path.join(IMAGE_FOLDER, TRASH_SUBDIR)
DB_DIR = os.path.join(BASE_DIR, 'db') 
DB_PATH = os.path.join(DB_DIR, 'meme.db') # SQLite 数据库文件路径
THUMBNAIL_MAX_SIZE = 600

os.makedirs(IMAGE_FOLDER, exist_ok=True)
os.makedirs(TRASH_DIR, exist_ok=True)
os.makedirs(THUMBNAIL_FOLDER, exist_ok=True)
os.makedirs(DB_DIR, exist_ok=True)

ALLOWED_EXTS = {'jpg', 'jpeg', 'png', 'gif', 'webp'}

# 同步分析相关参数说明：
#   SYNC_ANALYSIS_BATCH_SIZE：每次线程池分配给子批的文件数量，数越大 CPU 利用越高但日志越少，环境变量能临时调小方便 debug。
#   SYNC_ANALYSIS_WORKERS：用于并发分析文件的线程数，通常设置为 CPU 核心数的 1~2 倍即可。
#   SYNC_MAX_FILES_PER_RUN：本次 sync 最多处理的文件数量，设为 <=0 表示不限制，每次执行会扫描到所有待分析文件。
SYNC_ANALYSIS_BATCH_SIZE = int(os.getenv('SYNC_ANALYSIS_BATCH_SIZE', '50'))
SYNC_ANALYSIS_WORKERS = int(os.getenv('SYNC_ANALYSIS_WORKERS', '16'))
# 0 或负值代表不限制，其它值会截断待处理列表，避免单次耗时过久。
SYNC_MAX_FILES_PER_RUN = int(os.getenv('SYNC_MAX_FILES_PER_RUN', '0'))

# 初始化 Jieba 分词 (首次运行会加载字典)
jieba.initialize()



# 获取终端宽度，用于计算需要填充多少空格来覆盖旧文字


def _print_status(msg, is_error=False):
    """
    修复了 ljust 导致中文换行问题的版本
    """
    import shutil
    import sys

    # 1. 获取终端宽度 (保留 1 字符余量非常重要)
    try:
        terminal_width = shutil.get_terminal_size((80, 20)).columns - 1
    except:
        terminal_width = 79

    if is_error:
        # 错误逻辑：清空行 -> 打印错误 -> 换行
        # 这里用 ' ' * terminal_width 清空是安全的
        sys.stdout.write(f"\r{' ' * terminal_width}\r")
        sys.stdout.write(f"{msg}\n")
    else:
        # --- 计算实际显示宽度 ---
        display_len = 0
        for char in msg:
            if ord(char) > 127: 
                display_len += 2
            else: 
                display_len += 1
        
        # --- 截断逻辑 ---
        if display_len > terminal_width:
            # 如果过长，进行截断
            keep_tail = max(10, terminal_width - 25)
            msg = msg[:15] + "..." + msg[-keep_tail:]
            
            # 【重要】截断后，必须重新计算 display_len，否则下面的填充计算会错
            display_len = 0
            for char in msg:
                if ord(char) > 127: display_len += 2
                else: display_len += 1

        # --- 【核心修复】手动计算填充空格 ---
        # 我们希望总视觉宽度等于 terminal_width
        # 需要填充的空格数 = 终端宽度 - 当前字符串的视觉宽度
        pad_len = max(0, terminal_width - display_len)
        padding = " " * pad_len

        # 输出：\r + 消息 + 填充空格
        sys.stdout.write(f"\r{msg}{padding}")
        
    sys.stdout.flush()






def calculate_md5(file_path=None, file_stream=None):
    hash_md5 = hashlib.md5()
    if file_path:
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
    elif file_stream:
        pos = file_stream.tell()
        if pos != 0: file_stream.seek(0)
        for chunk in iter(lambda: file_stream.read(4096), b""):
            hash_md5.update(chunk)
        file_stream.seek(pos)
    return hash_md5.hexdigest()

# =========================
# 2. Database Helper
# =========================

class DBHandler:
    """处理 SQLite 连接与基础操作"""
    def __init__(self, db_path):
        self.db_path = db_path
        self._init_tables()

    def get_conn(self):
        """获取数据库连接，配置 row_factory"""
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        # 开启 WAL 模式提高并发性能
        conn.execute("PRAGMA journal_mode=WAL;") 
        return conn


    def _init_tables(self):
        conn = self.get_conn()
        cursor = conn.cursor()
        
        # 1. 图片主表 (已移除 created_at)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS images (
                md5 TEXT PRIMARY KEY,
                filename TEXT NOT NULL
            )
        ''')
        # 创建 filename 索引加速排序
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_filename ON images (filename)')

        # 2. 标签表 (新增 ref_count 字段用于高性能统计)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                ref_count INTEGER DEFAULT 0
            )
        ''')
        # 创建 name 索引 (用于查找)
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_tag_name ON tags (name)')
        # [新增] 创建 ref_count 索引 (用于 get_common_tags 极速排序)
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_tag_ref_count ON tags (ref_count DESC)')

        # 3. 图片-标签关联表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS image_tags (
                image_md5 TEXT,
                tag_id INTEGER,
                PRIMARY KEY (image_md5, tag_id),
                FOREIGN KEY (image_md5) REFERENCES images(md5) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            )
        ''')
        
        # 4. 同义词表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS synonyms (
                main_tag TEXT,
                synonym TEXT,
                PRIMARY KEY (main_tag, synonym)
            )
        ''')

        # ================= [新增] 自动维护计数的触发器 =================
        
        # 触发器 A: 当图片打上标签时，计数 +1
        cursor.execute('''
            CREATE TRIGGER IF NOT EXISTS update_ref_count_inc 
            AFTER INSERT ON image_tags 
            BEGIN
                UPDATE tags 
                SET ref_count = ref_count + 1 
                WHERE id = NEW.tag_id;
            END;
        ''')
        
        # 触发器 B: 当标签被移除时 (或图片删除级联移除时)，计数 -1
        cursor.execute('''
            CREATE TRIGGER IF NOT EXISTS update_ref_count_dec 
            AFTER DELETE ON image_tags 
            BEGIN
                UPDATE tags 
                SET ref_count = ref_count - 1 
                WHERE id = OLD.tag_id;
            END;
        ''')
        
        conn.commit()
        conn.close()

# =========================
# 3. DataManager (Core)
# =========================

class DataManager:
    """核心数据管理器：处理图片、标签、同义词等逻辑"""

    def __init__(self):
        # [清理] 移除了所有参数，初始化时保持绝对静默
        _print_status("[DataManager] 初始化 (静态资源就绪)...\n")
        self.db = DBHandler(DB_PATH)
        
        # 任务锁：用于互斥“后台自动扫描”和“手动导入/导出”
        self.task_lock = threading.Lock()
        
        # 标志位：记录扫描线程是否已启动
        self.scan_thread_started = False

        # 内存缓存同义词
        self.synonym_map = {} 
        self.synonym_leaf_to_root = {} 
        self._load_metadata()
        
        # 注意：这里不再启动任何线程，完全由 start_scan_thread 控制


    def start_scan_thread(self):
        """统一启动入口：安全启动后台扫描线程和缩略图生成"""
        if not self.scan_thread_started:
            self.scan_thread_started = True
            _print_status("[System] 正在启动后台服务 (扫描 + 缩略图)...\n")
            
            # 1. 启动缩略图生成
            threading.Thread(target=self._generate_missing_thumbnails, daemon=True).start()
            
            # 2. 启动核心同步扫描
            threading.Thread(target=self._sync_files_to_db, daemon=True).start()



    def _load_metadata(self):
        """从 SQLite 加载同义词到内存"""
        conn = self.db.get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT main_tag, synonym FROM synonyms")
        rows = cursor.fetchall()
        conn.close()

        self.synonym_map = {}
        self.synonym_leaf_to_root = {}
        
        for r in rows:
            main, syn = r['main_tag'], r['synonym']
            if main not in self.synonym_map:
                self.synonym_map[main] = []
            self.synonym_map[main].append(syn)
            self.synonym_leaf_to_root[syn] = main
            self.synonym_leaf_to_root[main] = main # 根也是自己的根

    def _save_synonyms(self, new_map):
        """保存同义词：全量覆盖逻辑"""
        conn = self.db.get_conn()
        try:
            conn.execute("DELETE FROM synonyms")
            data_to_insert = []
            for main, syns in new_map.items():
                # 确保存入根节点自己（虽然逻辑上不需要，但为了完整性）
                for s in syns:
                    data_to_insert.append((main, s))
            
            if data_to_insert:
                conn.executemany("INSERT OR IGNORE INTO synonyms (main_tag, synonym) VALUES (?, ?)", data_to_insert)
            conn.commit()
            
            # 更新内存
            self.synonym_map = new_map
            self._rebuild_reverse_map()
        except Exception as e:
            print(f"Error saving synonyms: {e}")
            conn.rollback()
        finally:
            conn.close()

    def _rebuild_reverse_map(self):
        self.synonym_leaf_to_root = {}
        for main, children in self.synonym_map.items():
            self.synonym_leaf_to_root[main] = main
            for child in children:
                self.synonym_leaf_to_root[child] = main

    # --- 辅助工具 ---
    def _path_join(self, base_dir, relative_path):
        return os.path.join(base_dir, *relative_path.split('/'))

    def _thumbnail_rel_path(self, filename):
        base, _ = os.path.splitext(filename)
        return f"{base}_thumbnail.jpg"
    
    def _normalize_rel_path(self, rel_path):
        if not rel_path: return ''
        return rel_path.replace('\\', '/').strip('/')

    def _is_trash_path(self, rel_path):
        if not rel_path: return False
        return self._normalize_rel_path(rel_path).startswith(f"{TRASH_SUBDIR}/")

    def _get_tags_for_image(self, conn, md5):
        """获取单张图片的 tags 列表"""
        cursor = conn.cursor()
        cursor.execute('''
            SELECT t.name FROM tags t
            JOIN image_tags it ON t.id = it.tag_id
            WHERE it.image_md5 = ?
        ''', (md5,))
        return [r['name'] for r in cursor.fetchall()]

    def _build_image_payload(self, filename, tags=None, md5=None, score=None):
        thumb_rel = self._ensure_thumbnail_exists(filename)
        thumb_url = f"/thumbnails/{thumb_rel}" if thumb_rel else None
        
        # 如果 tags 为 None，尝试懒加载（视情况而定，这里假设通常传入了 tags）
        if tags is None and md5:
            # 注意：在循环中慎用，会产生 N+1 查询
            pass 

        data = {
            "filename": filename,
            "tags": tags or [],
            "url": f"/images/{filename}",
            "thumbnail_url": thumb_url or f"/images/{filename}",
            "md5": md5 if md5 else os.path.splitext(os.path.basename(filename))[0]
        }
        data["is_trashed"] = TRASH_TAG in (data["tags"] or [])
        if score is not None:
            data["score"] = score
        return data

    # --- 缩略图逻辑 (保持原样) ---
    def _extract_random_frame(self, img: Image.Image):
        frames = getattr(img, "n_frames", 1)
        if frames > 1:
            try: img.seek(random.randrange(frames))
            except: img.seek(0)
        return img.copy()

    def _create_thumbnail_file(self, source_path, thumb_path):
        with Image.open(source_path) as img:
            frame = self._extract_random_frame(img)
            if frame.mode not in ("RGB", "L"): frame = frame.convert("RGB")
            elif frame.mode == "L": frame = frame.convert("RGB")
            frame.thumbnail((THUMBNAIL_MAX_SIZE, THUMBNAIL_MAX_SIZE), Image.LANCZOS)
            os.makedirs(os.path.dirname(thumb_path), exist_ok=True)
            frame.save(thumb_path, "JPEG", quality=85, optimize=True)

    def _ensure_thumbnail_exists(self, filename):
        if not filename: return None
        thumb_rel = self._thumbnail_rel_path(filename)
        thumb_full = self._path_join(THUMBNAIL_FOLDER, thumb_rel)
        src_full = self._path_join(IMAGE_FOLDER, filename)
        try:
            if not os.path.exists(src_full): return None
            if os.path.exists(thumb_full): return thumb_rel
            self._create_thumbnail_file(src_full, thumb_full)
            return thumb_rel
        except Exception as e:
            _print_status(f"[Thumb] 生成缩略图失败 {thumb_rel}: {e}", is_error=True)
            return None

    def _generate_missing_thumbnails(self):
        _print_status("[Thumb] 开始检查/补全缩略图...\n")
        for root, _, files in os.walk(IMAGE_FOLDER):
            for fname in files:
                if fname.rsplit('.', 1)[-1].lower() in ALLOWED_EXTS:
                    rel = os.path.relpath(os.path.join(root, fname), IMAGE_FOLDER).replace('\\', '/')
                    self._ensure_thumbnail_exists(rel)
        _print_status("[Thumb] 缩略图检查完成\n")

    # --- 核心同步逻辑 (DB版) ---



    def _process_file_standardization(self, file_path):
        """
        计算MD5，校验真实格式，并标准化重命名。
        [修改版]：移除了后缀名初筛，只要内容是图片都能识别并修复。
        """
        try:
            dir_path = os.path.dirname(file_path)
            fname = os.path.basename(file_path)
            
            # ================= [PIL 真实格式校验] =================
            # 我们直接尝试打开文件，不关心它原来的后缀是什么
            # 哪怕是 "readme.txt" 或 "data"，只要内容是图片，这里就能通过
            real_ext = None
            try:
                with Image.open(file_path) as img:
                    format_name = img.format.lower() if img.format else ""
                    

                    # 只要识别出的格式在允许列表里，就直接用它
                    if format_name in ALLOWED_EXTS:
                        real_ext = format_name
                        if real_ext == 'jpeg': 
                            real_ext = 'jpg'
                    

            except Exception:
                # 无法用 PIL 打开，说明文件头损坏、不是图片、或者文件为空
                # 这里静默跳过，不报错，因为文件夹里可能有正常的非图片文件（如 .gitignore）
                return None
            
            # 如果没获取到后缀（理论上上面逻辑会返回），则跳过
            if not real_ext: 
                return None
            # ========================================================

            # 2. 计算 MD5
            md5_val = calculate_md5(file_path=file_path)
            
            # 3. 构造期望文件名 (使用校验后的 real_ext)
            expected_name = f"{md5_val}.{real_ext}"
            
            final_name_in_dir = expected_name
            
            # 4. 重命名逻辑
            if fname != expected_name:
                new_full_path = os.path.join(dir_path, expected_name)
                try:
                    # 如果目标文件名已存在
                    if not os.path.exists(new_full_path):
                        os.rename(file_path, new_full_path)
                        _print_status(f"[Sync] 修正文件/后缀: {fname} -> {expected_name}\n")
                    else:
                        # 目标已存在，说明是重复文件，删除当前这个
                        old_rel = os.path.relpath(file_path, IMAGE_FOLDER).replace('\\', '/')
                        new_rel = os.path.relpath(new_full_path, IMAGE_FOLDER).replace('\\', '/')
                        _print_status(f"[Sync] 去重: 已删除重复文件 {old_rel} (保留 {new_rel})\n")
                        os.remove(file_path) 
                except OSError as e:
                    _print_status(f"[Sync] 重命名失败 {fname}: {e}", is_error=True)
                    return None 
            
            abs_final_path = os.path.join(dir_path, final_name_in_dir)
            rel_path = os.path.relpath(abs_final_path, IMAGE_FOLDER).replace('\\', '/')
            return (md5_val, rel_path)

        except Exception:
            # 捕获其他非预期的系统错误（如权限问题）
            traceback.print_exc()
            return None



    def _sync_files_to_db(self):
        """后台同步：磁盘文件 <-> SQLite (高性能 Map-Reduce 版)"""
        with self.task_lock:
            # ... (这部分获取 db_files 和 disk_md5_map 的代码保持不变) ...
            _print_status("[Sync] 已获得锁，开始执行同步...\n")
            conn = self.db.get_conn()
            try:
                # 1. 获取 DB 现状
                db_files = {} 
                cursor = conn.cursor()
                cursor.execute("SELECT md5, filename FROM images")
                for row in cursor.fetchall():
                    db_files[row['md5']] = row['filename']
                
                _print_status(f"[Sync] DB 已索引 {len(db_files)} 张图片\n")
                
                # 2. 扫描磁盘 - 收集待处理列表
                disk_md5_map = {} 
                files_to_process = [] # 这里只存路径
                total_disk_files = 0
                matched_cached = 0
               
                if os.path.exists(IMAGE_FOLDER):
                    for root, dirs, files in os.walk(IMAGE_FOLDER):
                        for fname in files:
                            total_disk_files += 1
                            full_path = os.path.join(root, fname)
                            fname_base = os.path.basename(fname)
                            fname_stem = fname_base.rsplit('.', 1)[0]
                            
                            # 捷径逻辑 (保留以提高速度)
                            if fname_stem in db_files:
                                db_filename = db_files[fname_stem]
                                db_ext = os.path.splitext(db_filename)[1].lower().lstrip('.')
                                current_ext = fname.rsplit('.', 1)[1].lower() if '.' in fname else ''
                                
                                if db_ext == current_ext:
                                    # 完全匹配，直接登记
                                    rel = os.path.relpath(full_path, IMAGE_FOLDER).replace('\\', '/')
                                    disk_md5_map[fname_stem] = rel
                                    matched_cached += 1
                                    continue
                            
                            # 未命中捷径，加入待处理
                            files_to_process.append(full_path)
                _print_status(f"[Sync] 磁盘扫描: {total_disk_files} 个文件, {matched_cached} 个从 DB 缓存命中, {len(files_to_process)} 个待分析\n")
                # ========================================================
                # Phase 1: 批次化并行分析
                # ========================================================
                total_candidates = len(files_to_process)
                if SYNC_MAX_FILES_PER_RUN > 0:
                    max_run = min(total_candidates, SYNC_MAX_FILES_PER_RUN)
                    if total_candidates > max_run:
                        _print_status(f"[Sync] 受限于 SYNC_MAX_FILES_PER_RUN={SYNC_MAX_FILES_PER_RUN}，本次只处理 {max_run} 个文件。\n")
                else:
                    max_run = total_candidates
                files_to_process = files_to_process[:max_run]
                total_to_process = len(files_to_process)
                if total_candidates:
                    _print_status(f"[Sync] 本次扫描共发现 {total_candidates} 个未缓存文件，准备处理 {total_to_process} 个 (批次大小 {SYNC_ANALYSIS_BATCH_SIZE})。\n")
                    if total_candidates > total_to_process:
                        _print_status(f"[Sync] 其余 {total_candidates - total_to_process} 个留待下一次扫描。\n")
                else:
                    _print_status("[Sync] Phase 1: 暂无新文件待分析。\n")
                if total_to_process:
                    processed_global = 0
                    with concurrent.futures.ThreadPoolExecutor(max_workers=SYNC_ANALYSIS_WORKERS) as executor:
                        for batch_start in range(0, total_to_process, SYNC_ANALYSIS_BATCH_SIZE):
                            batch = files_to_process[batch_start:batch_start + SYNC_ANALYSIS_BATCH_SIZE]
                            batch_end = batch_start + len(batch)
                            futures = {executor.submit(self._process_file_standardization, f): f for f in batch}
                            valid = 0
                            for future in concurrent.futures.as_completed(futures):
                                res = future.result()
                                processed_global += 1
                                if res:
                                    md5_val, rel_path = res
                                    disk_md5_map[md5_val] = rel_path
                                    valid += 1
                            invalid_count = len(batch) - valid
                            processed_msg = f"{processed_global}/{total_candidates}"
                            if valid:
                                _print_status(f"[Sync] {processed_msg} - 批次 {batch_start + 1}-{batch_end} 解析成功 {valid}/{len(batch)}")
                            if invalid_count:
                                _print_status(f"[Sync] {processed_msg} - 批次 {batch_start + 1}-{batch_end} 跳过 {invalid_count} 个无效文件。\n")
                    _print_status(f"[Sync] Phase 1 完成: 已处理 {processed_global}/{total_candidates} 个文件。\n")

                # ========================================================
                # Phase 2: 继续与数据库比较
                # ========================================================
                disk_ids = set(disk_md5_map.keys())
                db_ids = set(db_files.keys())
                
                to_add = disk_ids - db_ids
                to_delete = db_ids - disk_ids
                to_update_path = []
                
                for mid in disk_ids & db_ids:
                    if db_files[mid] != disk_md5_map[mid]:
                        to_update_path.append((mid, disk_md5_map[mid]))
                        new_is_trash = self._is_trash_path(disk_md5_map[mid])
                        self._sync_trash_tag_in_db(conn, mid, new_is_trash)

                _print_status(f"[Sync] Phase 2 差异 -> 新增 {len(to_add)} 张, 删除 {len(to_delete)} 张, 路径更新 {len(to_update_path)} 条\n")
                if not (to_add or to_delete or to_update_path):
                    _print_status("[Sync] Phase 2: 无需更新数据库记录。\n")

                if to_delete:
                    conn.executemany("DELETE FROM images WHERE md5 = ?", [(x,) for x in to_delete])
                
                if to_update_path:
                    # 替换 print
                    _print_status(f"[Sync] DB路径更新: {len(to_update_path)} 条\n")
                    conn.executemany(
                        "UPDATE images SET filename = ? WHERE md5 = ?",
                        [(new_path, mid) for mid, new_path in to_update_path]
                    )
                        
                if to_add:
                    # 替换 print
                    _print_status(f"[Sync] 新文件入库: {len(to_add)} 张\n")
                    conn.executemany(
                        "INSERT OR IGNORE INTO images (md5, filename) VALUES (?, ?)",
                        [(mid, disk_md5_map[mid]) for mid in to_add]
                    )
                    # 同步 trash 标签状态
                    for mid in to_add:
                        self._sync_trash_tag_in_db(conn, mid, self._is_trash_path(disk_md5_map[mid]))

                conn.commit()
                # 替换 print
                _print_status("[Sync] 同步完成\n")

            except Exception as e:
                # 替换 print 为 _print_status(..., is_error=True)
                _print_status(f"[Sync] 异常: {e}", is_error=True)
                # 保持 traceback 打印 (通常会打印多行，不受 _print_status 控制)
                traceback.print_exc() 
            finally:
                conn.close()
                
                

    def _sync_trash_tag_in_db(self, conn, md5, should_be_trash):
        """确保 DB 中的标签与物理路径一致"""
        # 1. 查找 tag_id
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM tags WHERE name = ?", (TRASH_TAG,))
        row = cursor.fetchone()
        trash_tag_id = row['id'] if row else None

        if should_be_trash:
            if not trash_tag_id:
                cursor.execute("INSERT INTO tags (name) VALUES (?)", (TRASH_TAG,))
                trash_tag_id = cursor.lastrowid
            cursor.execute("INSERT OR IGNORE INTO image_tags (image_md5, tag_id) VALUES (?, ?)", (md5, trash_tag_id))
        else:
            if trash_tag_id:
                cursor.execute("DELETE FROM image_tags WHERE image_md5 = ? AND tag_id = ?", (md5, trash_tag_id))

    def _add_tag_to_image(self, conn, md5, tag_name):
        cursor = conn.cursor()
        # 确保 tag 存在
        cursor.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag_name,))
        # 获取 tag id (如果是刚插入的，需要 select)
        cursor.execute("SELECT id FROM tags WHERE name = ?", (tag_name,))
        tag_id = cursor.fetchone()['id']
        # 插入关联
        cursor.execute("INSERT OR IGNORE INTO image_tags (image_md5, tag_id) VALUES (?, ?)", (md5, tag_id))


    # --- 业务逻辑 ---

    def get_all_variants(self, tag):
        root = self.synonym_leaf_to_root.get(tag, tag)
        variants = {root}
        if root in self.synonym_map:
            variants.update(self.synonym_map[root])
        return list(variants)

    def get_next_untagged_image(self, current_filename=None, filter_type='untagged'):
        conn = self.db.get_conn()
        cursor = conn.cursor()
        
        # 基础 SQL：找出所有有关联标签的图片 MD5
        # 优化：filter_type logic
        
        # 排除 trash 的图片
        trash_exclude_clause = f"""
            md5 NOT IN (
                SELECT image_md5 FROM image_tags 
                JOIN tags ON image_tags.tag_id = tags.id 
                WHERE tags.name = '{TRASH_TAG}'
            )
        """

        where_clauses = [trash_exclude_clause]
        
        if filter_type == 'untagged':
            # 没有标签 (left join image_tags is null)
            where_clauses.append("md5 NOT IN (SELECT DISTINCT image_md5 FROM image_tags)")
        elif filter_type == 'tagged':
            where_clauses.append("md5 IN (SELECT DISTINCT image_md5 FROM image_tags)")
        
        if current_filename:
            where_clauses.append("filename > ?")
            params = [current_filename]
        else:
            params = []

        query = f"SELECT * FROM images WHERE {' AND '.join(where_clauses)} ORDER BY filename ASC LIMIT 1"
        
        cursor.execute(query, params)
        row = cursor.fetchone()
        
        # 如果到底了，循环回到头部
        if not row and current_filename:
            # 去掉 filename > ? 条件重查
            base_clauses = where_clauses[:-1] 
            query_loop = f"SELECT * FROM images WHERE {' AND '.join(base_clauses)} ORDER BY filename ASC LIMIT 1"
            cursor.execute(query_loop)
            row = cursor.fetchone()
            if row:
                tags = self._get_tags_for_image(conn, row['md5'])
                return {"success": True, "message": "循环回到第一张", **self._build_image_payload(row['filename'], tags, row['md5'])}
        
        if row:
            tags = self._get_tags_for_image(conn, row['md5'])
            conn.close()
            return {"success": True, **self._build_image_payload(row['filename'], tags, row['md5'])}
        
        conn.close()
        return {"success": False, "message": "没有更多图片了"}

    def save_tags(self, filename, tags):
        if not filename: return {"success": False, "message": "缺少 filename 参数"}
        normalized_filename = self._normalize_rel_path(filename)
        md5_id = os.path.basename(normalized_filename).rsplit('.', 1)[0]
        
        tag_candidates = tags if isinstance(tags, list) else []
        cleaned_tags = sorted({str(t).strip() for t in tag_candidates if str(t).strip()})
        should_be_trash = TRASH_TAG in cleaned_tags
        
        conn = self.db.get_conn()
        try:
            # 1. 检查图片是否存在
            cursor = conn.cursor()
            cursor.execute("SELECT filename FROM images WHERE md5 = ?", (md5_id,))
            row = cursor.fetchone()
            if not row:
                return {"success": False, "message": "未找到该图片信息"}
            
            current_path = row['filename']
            currently_in_trash = self._is_trash_path(current_path)
            
            # 2. 处理物理文件移动
            final_path = current_path
            action_msg = "标签已保存"
            
            if should_be_trash and not currently_in_trash:
                # 移入垃圾箱
                new_rel = f"{TRASH_SUBDIR}/{os.path.basename(current_path)}"
                final_path = self._relocate_image(current_path, new_rel)
                action_msg = "已移入回收站"
            elif not should_be_trash and currently_in_trash:
                # 移出垃圾箱 (移到根目录)
                new_rel = os.path.basename(current_path)
                final_path = self._relocate_image(current_path, new_rel)
                action_msg = "已恢复"

            # 3. 更新 images 表路径
            if final_path != current_path:
                cursor.execute("UPDATE images SET filename = ? WHERE md5 = ?", (final_path, md5_id))
            
            # 4. 更新标签 (全量替换)
            # a. 获取所有目标 tag 的 id (如果不存在则创建)
            tag_ids = []
            for t in cleaned_tags:
                cursor.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (t,))
                cursor.execute("SELECT id FROM tags WHERE name = ?", (t,))
                tag_ids.append(cursor.fetchone()['id'])
            
            # b. 删除旧关联
            cursor.execute("DELETE FROM image_tags WHERE image_md5 = ?", (md5_id,))
            
            # c. 插入新关联
            if tag_ids:
                cursor.executemany("INSERT INTO image_tags (image_md5, tag_id) VALUES (?, ?)", 
                                   [(md5_id, tid) for tid in tag_ids])
            
            conn.commit()
            return {"success": True, "message": action_msg}
            
        except Exception as e:
            conn.rollback()
            print(f"[Save Tags] 更新索引失败: {e}")
            traceback.print_exc()
            return {"success": False, "message": str(e)}
        finally:
            conn.close()


    def _relocate_image(self, src_rel, dst_rel):
        """移动物理文件和缩略图"""
        if not src_rel or not dst_rel:
            raise ValueError("来源或目标路径不能为空")
        src_full = self._path_join(IMAGE_FOLDER, src_rel)
        dst_full = self._path_join(IMAGE_FOLDER, dst_rel)
        
        if not os.path.exists(src_full):
            raise FileNotFoundError(f"源文件不存在: {src_full}")

        if os.path.abspath(src_full) == os.path.abspath(dst_full):
            return src_rel
            
        os.makedirs(os.path.dirname(dst_full), exist_ok=True)
        if os.path.exists(dst_full):
            try:
                os.remove(dst_full) # 覆盖
            except Exception as e:
                # 替换 print
                _print_status(f"[Relocate Image] 删除目标文件失败: {e}", is_error=True)
                raise
            
        try:
            shutil.move(src_full, dst_full)
        except Exception as e:
            # 替换 print
            _print_status(f"[Save Tags] 移动文件失败: {e}", is_error=True)
            raise
        
        # 移动缩略图
        src_thumb = self._path_join(THUMBNAIL_FOLDER, self._thumbnail_rel_path(src_rel))
        dst_thumb = self._path_join(THUMBNAIL_FOLDER, self._thumbnail_rel_path(dst_rel))
        if os.path.exists(src_thumb):
            os.makedirs(os.path.dirname(dst_thumb), exist_ok=True)
            if os.path.exists(dst_thumb): os.remove(dst_thumb)
            try:
                shutil.move(src_thumb, dst_thumb)
            except Exception as e:
                # 替换 print
                _print_status(f"[Thumb Move] 无法移动缩略图: {e}", is_error=True)
                raise
            
        return dst_rel



    def get_common_tags(self, limit=100, offset=0, query=""):
        conn = self.db.get_conn()
        conn.row_factory = sqlite3.Row  # 确保可以通过列名访问
        cursor = conn.cursor()
        
        # [优化点]
        # 不再通过 JOIN image_tags 实时计算 (那个太慢了)。
        # 而是直接读取 tags 表里的 ref_count 字段 (这个极快)。
        # 注意：这里不能在 SQL 里分页，必须全量拉取，否则同义词合并会数据不全。
        
        sql = "SELECT name, ref_count FROM tags WHERE ref_count > 0"
        cursor.execute(sql)
        raw_rows = cursor.fetchall() # 结果示例: [{'name': '猫', 'ref_count': 100}, ...]
        conn.close()
        
        # --- Python 层面聚合 (处理同义词合并) ---
        merged_stats = {}
        
        for row in raw_rows:
            raw_tag = row['name']
            count = row['ref_count']
            
            # 找到根标签 (如果自己就是根，返回自己)
            root = self.synonym_leaf_to_root.get(raw_tag, raw_tag)
            
            if root not in merged_stats:
                merged_stats[root] = {
                    "tag": root, 
                    "count": 0, 
                    "synonyms": self.synonym_map.get(root, [])
                }
            # 累加计数 (比如把 '猫咪' 的 5 次加到 '猫' 的 100 次上)
            merged_stats[root]["count"] += count
            
        # --- 过滤 (搜索) ---
        result_list = []
        q_lower = query.lower().strip()
        
        for root, data in merged_stats.items():
            # 如果有搜索词，检查 根标签 或 任意同义词 是否匹配
            if q_lower:
                match_main = q_lower in root.lower()
                match_syn = any(q_lower in s.lower() for s in data['synonyms'])
                if not (match_main or match_syn): 
                    continue
            result_list.append(data)
            
        # --- 排序 ---
        # 按总引用次数倒序
        result_list.sort(key=lambda x: x['count'], reverse=True)
        
        # --- 分页 (Slice) ---
        total = len(result_list)

        # 1. 如果 limit 是 -1，直接返回全量列表，【千万不要走下面的切片逻辑】
        if limit == -1:
            return {
                "tags": result_list, 
                "total": total
            }
            
        # 2. 常规分页逻辑 (只有 limit > 0 时才走这里)
        return {
            "tags": result_list[offset : offset + limit], 
            "total": total
        }
    


    def _build_search_query(self, include_tags, exclude_tags, min_tags=None, max_tags=None):
        """
        修正点 1: 修复了 max_tags=-1 时导致查询结果为空的问题。
        修正点 2: 当 min_tags=0 且无上限时，跳过数量筛选，确保能搜到无标签图片。
        修正点 3: 移除了导致 SQLite 语法错误的嵌套括号。
        """
        # 1. Include: 图片必须包含所有指定的标签 (INTERSECT)
        include_sqls = []
        params = []
        
        for tag in include_tags:
            variants = self.get_all_variants(tag)
            placeholders = ','.join(['?'] * len(variants))
            sql = f"""
                SELECT image_md5 FROM image_tags 
                JOIN tags ON image_tags.tag_id = tags.id 
                WHERE tags.name IN ({placeholders})
            """
            include_sqls.append(sql)
            params.extend(variants)
            
        # 2. Exclude: 图片不能包含任一指定的标签 (EXCEPT)
        exclude_sql = ""
        if exclude_tags:
            all_exclude_variants = []
            for tag in exclude_tags:
                all_exclude_variants.extend(self.get_all_variants(tag))
            
            if all_exclude_variants:
                placeholders = ','.join(['?'] * len(all_exclude_variants))
                exclude_sql = f"""
                    SELECT image_md5 FROM image_tags 
                    JOIN tags ON image_tags.tag_id = tags.id 
                    WHERE tags.name IN ({placeholders})
                """
                params.extend(all_exclude_variants)

        # 3. Min/Max Tags Count (数量筛选)
        count_filter_sql = ""
        
        # 解析参数
        try:
            p_min = int(min_tags) if min_tags is not None else 0
        except (ValueError, TypeError): 
            p_min = 0
            
        try:
            p_max = int(max_tags) if max_tags is not None else -1
        except (ValueError, TypeError): 
            p_max = -1

        # 逻辑修正：如果 max_tags 为负数 (如 -1)，视为无上限 (999999)
        real_max = p_max if p_max >= 0 else 999999
        
        # 优化：只有当限制条件有效时（不是 0 到 无穷大），才生成 SQL
        # 这样不仅解决了 max_tags=-1 的问题，还保证了 min_tags=0 时能搜到"无标签图片"
        if not (p_min <= 0 and real_max >= 999999):
            count_filter_sql = f"""
                SELECT image_md5 FROM image_tags 
                GROUP BY image_md5 
                HAVING COUNT(*) >= {p_min} AND COUNT(*) <= {real_max}
            """

        # --- 组合最终 SQL (扁平链式结构) ---
        
        # 基础集合: 如果没有 include 条件，基础就是"所有图片"
        if include_sqls:
            md5_set_sql = " INTERSECT ".join(include_sqls)
        else:
            md5_set_sql = "SELECT md5 FROM images"

        # 应用数量筛选 (INTERSECT)
        if count_filter_sql:
            md5_set_sql = f"{md5_set_sql} INTERSECT {count_filter_sql}"

        # 应用排除筛选 (EXCEPT)
        if exclude_sql:
            md5_set_sql = f"{md5_set_sql} EXCEPT {exclude_sql}"

        # 包裹进最终查询
        final_sql = f"SELECT md5, filename FROM images WHERE md5 IN ({md5_set_sql})"

        # 自动过滤回收站 (除非显式包含)
        has_trash_in_include = any(TRASH_TAG in self.get_all_variants(t) for t in include_tags)
        if not has_trash_in_include:
            trash_filter_sql = f"""
                SELECT image_md5 FROM image_tags 
                JOIN tags ON image_tags.tag_id = tags.id 
                WHERE tags.name = '{TRASH_TAG}'
            """
            # 使用 EXCEPT 剔除回收站图片
            final_sql = f"SELECT md5, filename FROM images WHERE md5 IN (SELECT md5 FROM ({final_sql}) EXCEPT {trash_filter_sql})"

        return final_sql, params

    def search(self, include, exclude, offset, limit):
        sql, params = self._build_search_query(include, exclude)
        
        # 添加分页和排序
        full_sql = f"{sql} ORDER BY filename ASC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        
        conn = self.db.get_conn()
        cursor = conn.cursor()
        
        # 获取总数 (有点慢，但这在 SQLite 也是标准做法)
        count_sql = f"SELECT COUNT(*) as cnt FROM ({sql})"
        cursor.execute(count_sql, params[:-2])
        total = cursor.fetchone()['cnt']
        
        # 获取数据
        cursor.execute(full_sql, params)
        rows = cursor.fetchall()
        
        results = []
        for r in rows:
            # 性能注意：这里 N+1 获取 tags，为了前端展示。
            # 如果太慢，可以考虑 group_concat
            tags = self._get_tags_for_image(conn, r['md5'])
            results.append(self._build_image_payload(r['filename'], tags, r['md5']))
            
        conn.close()
        return {"results": results, "total": total}


    def semantic_search(self, query_text, offset, limit):
        if not query_text: return {"results": [], "total": 0}
        
        # 1. 使用 Jieba 分词
        tokens = list(jieba.cut_for_search(query_text))
        tokens = [t.strip() for t in tokens if t.strip()]
        
        if not tokens: return {"results": [], "total": 0}
        
        # 2. 扩展同义词
        where_clauses = []
        params = []
        
        for token in tokens:
            variants = self.get_all_variants(token)
            for v in variants:
                where_clauses.append("t.name LIKE ?")
                params.append(f"%{v}%")
                
        where_str = " OR ".join(where_clauses)
        
        # Inner Query (defines alias 'i')
        sql = f"""
            SELECT DISTINCT i.md5, i.filename 
            FROM images i
            JOIN image_tags it ON i.md5 = it.image_md5
            JOIN tags t ON it.tag_id = t.id
            WHERE {where_str}
        """
        
        # Outer Query (filters trash)
        # Note: Alias 'i' is lost here, but 'filename' is available as a column
        sql = f"""
            SELECT * FROM ({sql}) 
            WHERE md5 NOT IN (
                SELECT image_md5 FROM image_tags 
                JOIN tags ON image_tags.tag_id = tags.id 
                WHERE tags.name = '{TRASH_TAG}'
            )
        """
        
        # FIXED: Changed 'ORDER BY i.filename' to 'ORDER BY filename'
        full_sql = f"{sql} ORDER BY filename LIMIT ? OFFSET ?"
        count_sql = f"SELECT COUNT(*) as cnt FROM ({sql})"
        
        conn = self.db.get_conn()
        cursor = conn.cursor()
        
        cursor.execute(count_sql, params)
        total = cursor.fetchone()['cnt']
        
        cursor.execute(full_sql, params + [limit, offset])
        rows = cursor.fetchall()
        
        results = []
        for r in rows:
            tags = self._get_tags_for_image(conn, r['md5'])
            results.append(self._build_image_payload(r['filename'], tags, r['md5']))
            
        conn.close()
        return {"results": results, "total": total}

    def browse(self, filter_type, tags, offset, limit, min_tags=None, max_tags=None):
        # 复用 search 逻辑，但加入 filter_type 处理
        # browse 接口通常用于特定 tag 点击或筛选
        
        # 如果是 filter_type='untagged'，可以复用 get_next_untagged 的逻辑思路，
        # 但这里需要分页。
        
        include = tags if tags else []
        exclude = []
        
        # 特殊处理 untagged
        if filter_type == 'untagged':
            # 在 search 中很难直接表达 "untagged" 同时又 include tags (矛盾)
            # 通常 untagged 不会带 include tags
            sql = f"SELECT md5, filename FROM images WHERE md5 NOT IN (SELECT image_md5 FROM image_tags)"
            # 过滤 trash
            sql += f" AND md5 NOT IN (SELECT image_md5 FROM image_tags JOIN tags ON image_tags.tag_id=tags.id WHERE tags.name='{TRASH_TAG}')"
            params = []
        else:
            # filter_type == 'all' or 'tagged'
            # 如果是 tagged，我们加上 min_tags=1 的隐含条件 (如果用户没指定 min)
            if filter_type == 'tagged':
                try:
                    parsed_min = int(min_tags) if min_tags is not None else 0
                except (TypeError, ValueError):
                    parsed_min = 0
                min_tags = parsed_min if parsed_min >= 1 else 1
            sql, params = self._build_search_query(include, exclude, min_tags, max_tags)
            
        # 分页执行
        full_sql = f"{sql} ORDER BY filename ASC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        
        conn = self.db.get_conn()
        cursor = conn.cursor()
        
        cursor.execute(f"SELECT COUNT(*) as cnt FROM ({sql})", params[:-2])
        total = cursor.fetchone()['cnt']
        
        cursor.execute(full_sql, params)
        rows = cursor.fetchall()
        
        results = []
        for r in rows:
            tags = self._get_tags_for_image(conn, r['md5'])
            results.append(self._build_image_payload(r['filename'], tags, r['md5']))
            
        conn.close()
        return {"results": results, "total": total}

    # --- 导入/导出/检查 ---

    def check_md5_exists(self, md5_val: str):
        if not md5_val: return {"exists": False, "message": "缺少 md5 参数"}
        conn = self.db.get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT filename FROM images WHERE md5 = ?", (md5_val,))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            # 还要获取 tags
            conn = self.db.get_conn()
            tags = self._get_tags_for_image(conn, md5_val)
            conn.close()
            payload = self._build_image_payload(row['filename'], tags, md5_val)
            payload["exists"] = True
            payload["message"] = "图片已存在"
            return payload
        return {"exists": False, "md5": md5_val, "message": "未找到重复图片"}



    def check_upload(self, file_obj, provided_md5=None):
        md5_calc = calculate_md5(file_stream=file_obj)
        file_obj.seek(0)
        
        if provided_md5 and provided_md5.lower() != md5_calc:
            return {"exists": False, "error": True, "message": "MD5 校验失败，文件与声明值不一致"}
            
        check = self.check_md5_exists(md5_calc)
        if check.get("exists"):
            check["message"] = "图片已存在（未重复上传）"
            return check
            
        # ================= 改动开始 =================
        # 1. 尝试通过 PIL 识别真实的图片格式，而不是依赖 filename
        try:
            with Image.open(file_obj) as img:
                real_format = img.format.lower() # 例如 'jpeg', 'png', 'gif', 'webp'
                
                # 格式名称标准化
                if real_format == 'jpeg':
                    ext = 'jpg'
                else:
                    ext = real_format
        except Exception:
            # 如果 PIL 无法识别（不是图片），则回退到文件名或报错
            ext = os.path.splitext(file_obj.filename)[1].lower().lstrip('.')

        # 重置文件指针，因为 Image.open 可能会读取文件头
        file_obj.seek(0)
        
        # 2. 校验格式是否在白名单中
        if not ext or ext not in ALLOWED_EXTS:
            ext_list = ', '.join(sorted(ALLOWED_EXTS))
            return {"exists": False, "error": True, "message": f"不支持的文件类型或无法识别，仅支持: {ext_list}"}
        # ================= 改动结束 =================

        new_fname = f"{md5_calc}.{ext}"
        save_path = os.path.join(IMAGE_FOLDER, new_fname)
        
        try:
            file_obj.save(save_path)
        except Exception as e:
             return {"exists": False, "error": True, "message": f"保存文件失败: {str(e)}"}

        self._ensure_thumbnail_exists(new_fname)
        
        # 写入 DB
        conn = self.db.get_conn()
        try:
            conn.execute("INSERT INTO images (md5, filename) VALUES (?, ?)", (md5_calc, new_fname))
            conn.commit()
        finally:
            conn.close()
            
        payload = self._build_image_payload(new_fname, [], md5_calc)
        payload["message"] = "上传成功"
        return payload

    def import_json(self, data):
        if self.task_lock.locked():
             yield json.dumps({"status": "waiting", "message": "正在等待后台扫描完成..."}) + "\n"
             
        with self.task_lock:
            try:
                # 1. Synonyms
                if "tag_synonyms" in data:
                    self._save_synonyms(data["tag_synonyms"])


                # 【新增】2. Common Tags (预设标签库)
                if "common_tags" in data:
                    conn = self.db.get_conn()
                    # 批量插入所有标签
                    conn.executemany("INSERT OR IGNORE INTO tags (name) VALUES (?)", 
                                     [(t,) for t in data["common_tags"]])
                    conn.commit()
                    conn.close()    
                    
                # 3. Images
                if "images" in data:
                    conn = self.db.get_conn()
                    cursor = conn.cursor()
                    images = data["images"]
                    count = 0
                    
                    # 为了性能，使用事务
                    cursor.execute("BEGIN TRANSACTION")
                    for fname, info in images.items():
                        md5 = info.get("md5")
                        tags = info.get("tags", [])
                        if not md5: continue
                        
                        # Update Image (ensure exists)
                        cursor.execute("INSERT OR IGNORE INTO images (md5, filename) VALUES (?, ?)", (md5, fname))
                        # 如果已存在，更新 filename
                        cursor.execute("UPDATE images SET filename = ? WHERE md5 = ?", (fname, md5))
                        
                        # Update Tags
                        # 先清空旧 tags
                        cursor.execute("DELETE FROM image_tags WHERE image_md5 = ?", (md5,))
                        
                        # 插入新 tags
                        for t in tags:
                            t = str(t).strip()
                            if not t: continue
                            cursor.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (t,))
                            cursor.execute("SELECT id FROM tags WHERE name = ?", (t,))
                            tid = cursor.fetchone()['id']
                            cursor.execute("INSERT OR IGNORE INTO image_tags (image_md5, tag_id) VALUES (?, ?)", (md5, tid))
                            
                        count += 1
                        if count % 100 == 0:
                            pass # batch commit handled by outer transaction
                            
                    cursor.execute("COMMIT")
                    conn.close()
                    yield json.dumps({"status": "success", "message": f"导入成功！已恢复 {count} 条记录。"}) + "\n"
                    
            except Exception as e:
                traceback.print_exc()
                yield json.dumps({"status": "error", "message": f"导入失败: {str(e)}"}) + "\n"


    def export_json(self):
        conn = self.db.get_conn()
        cursor = conn.cursor()
        
        export_data = {
            "tag_synonyms": self.synonym_map,
            "images": {},
            "common_tags": [] 
        }
        
        try:
            # 1. 导出标签库 (Common Tags)
            cursor.execute("SELECT name FROM tags")
            export_data["common_tags"] = [row['name'] for row in cursor.fetchall()]
            
            # 2. 导出图片及关联
            cursor.execute("""
                SELECT i.filename, i.md5, GROUP_CONCAT(t.name) as tags_str
                FROM images i
                LEFT JOIN image_tags it ON i.md5 = it.image_md5
                LEFT JOIN tags t ON it.tag_id = t.id
                GROUP BY i.md5
            """)
            
            for row in cursor.fetchall():
                tags = row['tags_str'].split(',') if row['tags_str'] else []
                export_data["images"][row['filename']] = {
                    "md5": row['md5'],
                    "tags": tags
                }
        finally:
            conn.close()

        # 3. [保留控制台输出] 检测触发扫描
        # 这里只做动作，不给前端发信号，保持接口简单
        if not self.scan_thread_started:
            _print_status("[Trigger] 检测到导出操作，结束【待机模式】，立即启动后台扫描...\n")
            self.start_scan_thread()
            
        return json.dumps(export_data, ensure_ascii=False, indent=2)

    def update_tag_group(self, main_tag, synonyms):
        new_map = self.synonym_map.copy()
        new_map[main_tag] = synonyms
        # 清理反向冲突
        for s in synonyms:
            if s in new_map and s != main_tag:
                del new_map[s]
        self._save_synonyms(new_map)
        return True

# =========================
# 4. Flask App
# =========================

dm = DataManager()
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 30 * 1024 * 1024

@app.route('/')
def idx(): return send_file('index.html')
@app.route('/script.js')
def js(): return send_file('script.js')
@app.route('/style.css')
def css(): return send_file('style.css')
@app.route('/favicon.ico')
def fav(): return send_file('favicon.ico')
@app.route('/images/<path:f>')
def img(f): return send_from_directory(IMAGE_FOLDER, f)
@app.route('/thumbnails/<path:f>')
def thumbnail(f): return send_from_directory(THUMBNAIL_FOLDER, f)

@app.route('/api/get_next_untagged_image')
def next_img(): 
    return jsonify(dm.get_next_untagged_image(request.args.get('current'), request.args.get('filter', 'untagged')))

@app.route('/api/save_tags', methods=['POST'])
def save_t(): return jsonify(dm.save_tags(request.json.get('filename'), request.json.get('tags', [])))

@app.route('/api/search')
def search():
    i = [x.strip() for x in request.args.get('include', '').split(',') if x.strip()]
    e = [x.strip() for x in request.args.get('exclude', '').split(',') if x.strip()]
    return jsonify(dm.search(i, e, request.args.get('offset', 0, int), request.args.get('limit', 50, int)))

@app.route('/api/semantic_search')
def semantic():
    return jsonify(dm.semantic_search(request.args.get('q', ''), request.args.get('offset', 0, int), request.args.get('limit', 50, int)))

@app.route('/api/browse')
def browse():
    t = [x.strip() for x in request.args.get('tag', '').split(',') if x.strip()]
    return jsonify(dm.browse(
        request.args.get('filter', 'all'), 
        t, 
        request.args.get('offset', 0, int), 
        request.args.get('limit', 50, int),
        min_tags=request.args.get('min_tags'),
        max_tags=request.args.get('max_tags')
    ))

@app.route('/api/get_common_tags')
def common():
    return jsonify(dm.get_common_tags(request.args.get('limit', 100, int), request.args.get('offset', 0, int), request.args.get('query', '')))

@app.route('/api/import_json', methods=['POST'])
def import_data():
    if 'file' not in request.files: return jsonify({"success": False}), 400
    try:
        data = json.loads(request.files['file'].read())
        return Response(stream_with_context(dm.import_json(data)), mimetype='application/json')
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 400

@app.route('/api/export_json')
def export(): 
    return Response(dm.export_json(), mimetype='application/json', headers={'Content-Disposition': 'attachment;filename=meme_db_sqlite_backup.json'})

@app.route('/api/check_md5_exists')
def chk_md5(): return jsonify(dm.check_md5_exists(request.args.get('md5', '').strip()))

@app.route('/api/check_upload', methods=['POST'])
def chk_up(): 
    if 'file' not in request.files: return jsonify({"success": False}), 400
    return jsonify(dm.check_upload(request.files['file'], request.form.get('md5')))

@app.route('/api/update_synonyms', methods=['POST'])
def up_syn(): return jsonify({"success": dm.update_tag_group(request.json.get('main_tag'), request.json.get('synonyms', []))})

@app.route('/api/manual_scan')
def manual_scan():
    if request.args.get('key') != 'bqbq_secure_scan_key_2025_v1': return "密钥验证失败 (Invalid Key)", 403
    _print_status("[API] 收到手动扫描请求，开始执行...\n")
    threading.Thread(target=dm._sync_files_to_db).start()
    return "扫描与同步任务已执行完毕 (Sync Completed)."

@app.route('/api/get_image_info')
def get_info():
    md5 = request.args.get('md5')
    fname = request.args.get('filename')
    conn = dm.db.get_conn()
    cursor = conn.cursor()
    if md5: cursor.execute("SELECT * FROM images WHERE md5=?", (md5,))
    elif fname: cursor.execute("SELECT * FROM images WHERE filename=?", (fname,))
    else: return jsonify({"success": False, "message": "请提供 filename 或 md5 参数"}), 400
    
    row = cursor.fetchone()
    if row:
        tags = dm._get_tags_for_image(conn, row['md5'])
        conn.close()
        return jsonify({"success": True, **dm._build_image_payload(row['filename'], tags, row['md5'])})
    conn.close()
    return jsonify({"success": False, "message": "未找到该图片信息"}), 404

@app.route('/api/get_by_offset')
def get_offset():
    offset = request.args.get('offset', 0, int)
    mode = request.args.get('mode', 'json')
    conn = dm.db.get_conn()
    cursor = conn.cursor()
    
    # 获取总数
    cursor.execute("SELECT COUNT(*) as cnt FROM images")
    total = cursor.fetchone()['cnt']
    
    # 获取指定 offset 的图
    # 必须保证排序一致性
    cursor.execute("SELECT * FROM images ORDER BY filename ASC LIMIT 1 OFFSET ?", (offset,))
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        return jsonify({"success": False, "message": "偏移量超出范围或库为空"}), 404
        
    tags = dm._get_tags_for_image(conn, row['md5'])
    conn.close()
    payload = dm._build_image_payload(row['filename'], tags, row['md5'])
    
    if mode == 'image': return redirect(payload['url'])
    return jsonify({"success": True, "total": total, "offset": offset, **payload})


if __name__ == '__main__':
    load_dotenv()
    host = os.getenv('HOST', '127.0.0.1')
    try:
        port = int(os.getenv('PORT', 5000))
    except ValueError:
        port = 5000

    import argparse
    parser = argparse.ArgumentParser(description='BQBQ 表情包服务器')
    # 参数存在则为 True，不存在则为 False
    parser.add_argument('--init-import', action='store_true', help='启动进入等待模式，暂不扫描硬盘，允许先从前端导入数据')
    args = parser.parse_args()

    _print_status(f"[*] Starting server on {host}:{port}\n")

    # [逻辑梳理]
    if args.init_import:
        # Case 1: 用户加了 --init-import 参数
        # 行为：保持静默，打印提示，不调用 start_scan_thread()
        _print_status("\n" + "="*60 + "\n")
        _print_status("[System] ⚠ 已启用【初始化导入模式】(init-import)\n")
        _print_status("[System] 后台扫描线程已暂停。\n")
        _print_status("[System] 请在网页端【数据管理】->【导入数据】恢复 JSON。\n")
        _print_status("[System] 导入完成后，点击【导出数据】按钮，系统将自动激活后台扫描。\n")
        _print_status("="*60 + "\n\n")
    else:
        # Case 2: 用户没加参数 (默认情况)
        # 行为：立即启动扫描
        _print_status("[System] 默认模式启动，激活后台扫描与缩略图生成...\n")
        dm.start_scan_thread()

    CORS(app) 
    app.run(host=host, port=port, debug=True)
