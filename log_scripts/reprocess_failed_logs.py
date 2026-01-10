"""
重处理失败日志脚本

功能：
1. 读取 bqbq_download_full-*.log 中的 FALL_FAIL_HTTP 记录
2. 用公共 rkey 接口获取 group_rkey 替换原 URL 中的 rkey
3. 重新下载并上传到后端
4. 成功后更新日志状态为 FALLBACK_NEW 或 FALLBACK_DUP
5. 在内存中统一修改后写入，减少磁盘 IO

支持命令行参数指定日志文件路径
"""

import re
import sys
import time
import json
import httpx
import asyncio
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
from pathlib import Path

# ==========================
#   配置
# ==========================
DEFAULT_LOG_FILE = r"D:\bqbq_bot_dev\nonebot2-2.4.4\nonebot\plugins\bqbq\bqbq_download_full-日志1.log"
BACKEND_BASE_URL = "http://127.0.0.1:5001"
UPLOAD_API = f"{BACKEND_BASE_URL}/api/check_upload"

# rkey 公共接口列表（按优先级排序）
RKEY_APIS = [
    "https://secret-service.bietiaop.com/rkeys",
    "http://napcat-sign.wumiao.wang:2082/rkey",
    "https://llob.linyuchen.net/rkey",
]

# 匹配失败记录的状态
FAIL_PATTERNS = ["FALL_FAIL_HTTP", "RKEY_FAIL_HTTP", "RKEY_SKIPPED"]

# rkey 有效性测试 URL（不含 rkey 参数，需要替换后测试）
RKEY_TEST_URL = "https://gchat.qpic.cn/download?appid=1407&fileid=EhQ5BLRT4bxJ_-4xGJw0CPyUSdNP-hjxoQMg_woo97TXi4H5kQMyBHByb2RQgL2jAVoQkb0x_JXLKvxDpXsdrqdBoHoCz7SCAQJuag&rkey=PLACEHOLDER&spec=0"

# ==========================
#   rkey 获取（带缓存和计数）
# ==========================
RKEY_USE_LIMIT = 800  # 每个服务器的使用次数上限，防止风控
RKEY_USAGE_FILE = Path(__file__).parent / "rkey_usage.json"  # 持久化文件路径

_cached_rkey = {
    "group_rkey": None,
    "private_rkey": None,
    "expired_time": 0,
}

_rkey_usage = {
    "current_api_index": 0,  # 当前使用的 API 索引
    "use_count": 0,          # 当前 API 的使用次数
}


def load_rkey_usage():
    """从文件加载 rkey 使用计数和缓存的 rkey 信息"""
    global _rkey_usage, _cached_rkey
    if RKEY_USAGE_FILE.exists():
        try:
            with open(RKEY_USAGE_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                _rkey_usage["current_api_index"] = data.get("current_api_index", 0) % len(RKEY_APIS)
                _rkey_usage["use_count"] = data.get("use_count", 0)

                # 加载缓存的 rkey 信息
                cached = data.get("cached_rkey", {})
                _cached_rkey["group_rkey"] = cached.get("group_rkey")
                _cached_rkey["private_rkey"] = cached.get("private_rkey")
                _cached_rkey["expired_time"] = cached.get("expired_time", 0)

                # 计算剩余有效时间
                remaining = _cached_rkey["expired_time"] - time.time()
                if remaining > 0:
                    print(f"[rkey] 加载持久化: API索引={_rkey_usage['current_api_index']}, 使用次数={_rkey_usage['use_count']}, rkey剩余有效期={remaining:.0f}秒")
                else:
                    print(f"[rkey] 加载持久化: API索引={_rkey_usage['current_api_index']}, 使用次数={_rkey_usage['use_count']}, rkey已过期")
                    # 清除过期的 rkey 缓存
                    _cached_rkey["group_rkey"] = None
                    _cached_rkey["private_rkey"] = None
        except Exception as e:
            print(f"[rkey] 加载持久化文件失败: {e}，使用默认值")


def save_rkey_usage():
    """保存 rkey 使用计数和缓存的 rkey 信息到文件"""
    try:
        data = {
            "current_api_index": _rkey_usage["current_api_index"],
            "use_count": _rkey_usage["use_count"],
            "cached_rkey": {
                "group_rkey": _cached_rkey["group_rkey"],
                "private_rkey": _cached_rkey["private_rkey"],
                "expired_time": _cached_rkey["expired_time"],
            }
        }
        with open(RKEY_USAGE_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[rkey] 保存持久化文件失败: {e}")

async def fetch_rkey(client: httpx.AsyncClient, force_refresh: bool = False) -> dict:
    """从公共接口获取 rkey，带缓存机制

    Args:
        client: httpx 异步客户端
        force_refresh: 是否强制刷新（忽略缓存）
    """
    global _cached_rkey, _rkey_usage

    # 检查是否需要因为使用次数过多而切换 API
    if _rkey_usage["use_count"] >= RKEY_USE_LIMIT:
        print(f"[rkey] 当前 API 使用次数达到 {RKEY_USE_LIMIT}，切换到下一个服务器")
        _rkey_usage["current_api_index"] = (_rkey_usage["current_api_index"] + 1) % len(RKEY_APIS)
        _rkey_usage["use_count"] = 0
        save_rkey_usage()  # 切换后保存
        force_refresh = True  # 强制刷新以获取新服务器的 rkey

    # 检查缓存是否有效（非强制刷新时）
    if not force_refresh and _cached_rkey["expired_time"] > time.time() and _cached_rkey["group_rkey"]:
        remaining = _cached_rkey["expired_time"] - time.time()
        print(f"[rkey] 使用缓存，剩余有效期: {remaining:.0f}秒")
        return _cached_rkey

    # 从当前索引开始，依次尝试各个接口
    start_index = _rkey_usage["current_api_index"]
    for i in range(len(RKEY_APIS)):
        api_index = (start_index + i) % len(RKEY_APIS)
        api_url = RKEY_APIS[api_index]
        try:
            resp = await client.get(api_url, timeout=10.0)
            if resp.status_code == 200:
                data = resp.json()
                _cached_rkey["group_rkey"] = data.get("group_rkey")
                _cached_rkey["private_rkey"] = data.get("private_rkey")
                _cached_rkey["expired_time"] = data.get("expired_time", 0)
                # 更新当前使用的 API 索引
                if api_index != start_index:
                    _rkey_usage["current_api_index"] = api_index
                    _rkey_usage["use_count"] = 0
                # 保存新获取的 rkey 到持久化文件
                save_rkey_usage()
                remaining = _cached_rkey["expired_time"] - time.time()
                print(f"[rkey] 从 {api_url} 获取成功，剩余有效期: {remaining:.0f}秒，当前使用次数: {_rkey_usage['use_count']}")
                return _cached_rkey
        except Exception as e:
            print(f"[rkey] 从 {api_url} 获取失败: {e}")
            continue

    return {"group_rkey": None, "private_rkey": None, "expired_time": 0}


def increment_rkey_usage():
    """下载成功后增加 rkey 使用计数"""
    global _rkey_usage
    _rkey_usage["use_count"] += 1
    # 每 50 次保存一次，避免频繁写入磁盘
    if _rkey_usage["use_count"] % 50 == 0:
        save_rkey_usage()
        print(f"[rkey] 当前使用次数: {_rkey_usage['use_count']}/{RKEY_USE_LIMIT}")


def replace_rkey_in_url(url: str, new_rkey: str) -> str:
    """替换 URL 中的 rkey 参数"""
    parsed = urlparse(url)
    params = parse_qs(parsed.query, keep_blank_values=True)

    # 提取新 rkey 值（去掉 "&rkey=" 前缀）
    rkey_value = new_rkey.replace("&rkey=", "").replace("rkey=", "")
    params["rkey"] = [rkey_value]

    # 重建 URL
    new_query = urlencode(params, doseq=True)
    new_parsed = parsed._replace(query=new_query)
    return urlunparse(new_parsed)


def parse_log_file(file_path: str) -> list:
    """
    解析日志文件，返回所有记录
    每条记录包含：line_index, header_line, url_line, status, file_name, url
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    records = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # 匹配记录行: [Res: XXX] ...
        res_match = re.match(r'\[Res:\s*(\S+)\]', line)
        if res_match:
            status = res_match.group(1)

            # 提取文件名
            file_match = re.search(r'\[File:\s*([^\]]+)\]', line)
            file_name = file_match.group(1) if file_match else ""

            # 下一行应该是 URL
            url_line = ""
            url = ""
            if i + 1 < len(lines):
                url_line = lines[i + 1].strip()
                # 提取方括号内的 URL
                url_match = re.match(r'\[(.+)\]$', url_line)
                if url_match:
                    url = url_match.group(1)

            records.append({
                "line_index": i,
                "header_line": line,
                "url_line": url_line,
                "status": status,
                "file_name": file_name,
                "url": url,
            })

            i += 2  # 跳过 URL 行
        else:
            i += 1

    return records


async def reprocess_failed_records(log_file: str = None):
    """
    重处理失败记录

    Args:
        log_file: 日志文件路径，默认使用 DEFAULT_LOG_FILE

    Returns:
        dict: 处理统计结果
    """
    # 加载持久化的 rkey 使用计数
    load_rkey_usage()

    if log_file is None:
        log_file = DEFAULT_LOG_FILE

    print(f"[开始] 读取日志文件: {log_file}")

    # 读取并解析日志
    with open(log_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    records = parse_log_file(log_file)
    print(f"[解析] 共 {len(records)} 条记录")

    # 筛选失败记录
    failed_records = [r for r in records if r["status"] in FAIL_PATTERNS]
    print(f"[筛选] 需重处理 {len(failed_records)} 条失败记录")

    if not failed_records:
        print("[完成] 没有需要重处理的记录")
        return {"total": 0, "success_new": 0, "success_dup": 0, "fail_download": 0, "fail_upload": 0, "fail_rkey": 0}

    # 统计
    stats = {
        "total": len(failed_records),
        "success_new": 0,
        "success_dup": 0,
        "fail_rkey": 0,
        "fail_download": 0,
        "fail_upload": 0,
    }

    # 创建行号到记录的映射，用于更新
    line_updates = {}

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 先获取 rkey
        rkey_data = await fetch_rkey(client)
        group_rkey = rkey_data.get("group_rkey")

        if not group_rkey:
            print("[错误] 无法获取公共 rkey，退出")
            return

        for idx, record in enumerate(failed_records):
            url = record["url"]
            file_name = record["file_name"]
            line_index = record["line_index"]

            print(f"\n[{idx + 1}/{len(failed_records)}] 处理: {file_name}")

            # 检查 URL 是否包含 rkey
            if "rkey=" not in url:
                print(f"  跳过: URL 不包含 rkey")
                continue

            # 替换 rkey
            new_url = replace_rkey_in_url(url, group_rkey)
            print(f"  替换 rkey 后尝试下载...")

            # 尝试下载
            try:
                resp = await client.get(new_url)
                if resp.status_code != 200:
                    # 下载失败，可能是 rkey 过期，尝试刷新后重试一次
                    print(f"  下载失败: HTTP {resp.status_code}，尝试刷新 rkey...")
                    rkey_data = await fetch_rkey(client, force_refresh=True)
                    new_group_rkey = rkey_data.get("group_rkey")
                    if new_group_rkey and new_group_rkey != group_rkey:
                        group_rkey = new_group_rkey
                        new_url = replace_rkey_in_url(url, group_rkey)
                        resp = await client.get(new_url)
                        if resp.status_code != 200:
                            print(f"  重试后仍失败: HTTP {resp.status_code}")
                            stats["fail_download"] += 1
                            continue
                    else:
                        print(f"  无法获取新 rkey，跳过")
                        stats["fail_download"] += 1
                        continue

                content = resp.content
                print(f"  下载成功: {len(content)} 字节")
                increment_rkey_usage()  # 下载成功，增加使用计数

            except Exception as e:
                print(f"  下载异常: {e}")
                stats["fail_download"] += 1
                continue

            # 上传到后端
            try:
                upload_resp = await client.post(
                    UPLOAD_API,
                    files={"file": ("auto.gif", content, "image/gif")},
                )

                if upload_resp.status_code != 200:
                    print(f"  上传失败: HTTP {upload_resp.status_code}")
                    stats["fail_upload"] += 1
                    continue

                result = upload_resp.json()
                is_new = not result.get("exists", False)

                if is_new:
                    new_status = "FALLBACK_NEW"
                    stats["success_new"] += 1
                else:
                    new_status = "FALLBACK_DUP"
                    stats["success_dup"] += 1

                print(f"  上传成功: {new_status}")

                # 记录需要更新的行
                old_header = record["header_line"]
                new_header = re.sub(
                    r'\[Res:\s*\S+\]',
                    f'[Res: {new_status}]',
                    old_header
                )
                # 同时更新 Down 状态码
                new_header = re.sub(
                    r'\[Down:\s*\d+\]',
                    '[Down: 200]',
                    new_header
                )

                line_updates[line_index] = new_header
                line_updates[line_index + 1] = f"[{new_url}]"

            except Exception as e:
                print(f"  上传异常: {e}")
                stats["fail_upload"] += 1
                continue

    # 统一更新日志文件
    if line_updates:
        print(f"\n[写入] 更新 {len(line_updates)} 行...")
        for line_idx, new_content in line_updates.items():
            lines[line_idx] = new_content + "\n"

        with open(log_file, 'w', encoding='utf-8') as f:
            f.writelines(lines)
        print("[完成] 日志已更新")

    # 输出统计
    print("\n" + "=" * 50)
    print("处理统计:")
    print(f"  总数: {stats['total']}")
    print(f"  成功-新增: {stats['success_new']}")
    print(f"  成功-重复: {stats['success_dup']}")
    print(f"  失败-下载: {stats['fail_download']}")
    print(f"  失败-上传: {stats['fail_upload']}")
    print(f"  失败-rkey: {stats['fail_rkey']}")
    print("=" * 50)

    # 保存 rkey 使用计数
    save_rkey_usage()

    return stats


if __name__ == "__main__":
    # 支持命令行参数指定日志文件路径
    log_file = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(reprocess_failed_records(log_file))
