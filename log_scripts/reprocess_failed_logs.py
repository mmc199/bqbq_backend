"""
重处理失败日志脚本

功能：
1. 读取 bqbq_download_full-*.log 中的失败记录
2. 使用公共 image_downloader 模块重新下载并上传
3. 成功后更新日志状态为 FALLBACK_NEW 或 FALLBACK_DUP
4. 在内存中统一修改后写入，减少磁盘 IO

支持命令行参数指定日志文件路径
"""

import re
import sys
import httpx
import asyncio

# ==========================
#   导入公共模块
# ==========================
BQBQ_PLUGIN_DIR = r"D:\bqbq_bot_dev\nonebot2-2.4.4\nonebot\plugins\bqbq"
if BQBQ_PLUGIN_DIR not in sys.path:
    sys.path.insert(0, BQBQ_PLUGIN_DIR)

from image_downloader import ImageDownloader, DownloadContext
from rkey_manager import load_rkey_usage, save_rkey_usage

# ==========================
#   配置
# ==========================
DEFAULT_LOG_FILE = r"D:\bqbq_bot_dev\nonebot2-2.4.4\nonebot\plugins\bqbq\bqbq_download_full-日志1.log"
BACKEND_BASE_URL = "http://127.0.0.1:5001"

# 匹配失败记录的状态
FAIL_PATTERNS = ["RKEY_FAIL_HTTP", "RKEY_FAIL_NET", "RKEY_API_FAIL", "RKEY_EXPIRED"]

# 创建下载器实例
_downloader = ImageDownloader(backend_url=BACKEND_BASE_URL)


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
        return {"total": 0, "success_new": 0, "success_dup": 0, "fail": 0}

    # 统计
    stats = {
        "total": len(failed_records),
        "success_new": 0,
        "success_dup": 0,
        "fail": 0,
    }

    # 创建行号到记录的映射，用于更新
    line_updates = {}

    async with httpx.AsyncClient(timeout=30.0) as client:
        for idx, record in enumerate(failed_records):
            url = record["url"]
            file_name = record["file_name"]
            line_index = record["line_index"]

            print(f"\n[{idx + 1}/{len(failed_records)}] 处理: {file_name}")

            # 检查 URL 是否包含 rkey
            if "rkey=" not in url:
                print(f"  跳过: URL 不包含 rkey")
                continue

            # 提取 MD5（从文件名）
            md5_val = file_name.split(".")[0] if file_name else ""

            # 构造下载上下文
            ctx = DownloadContext(
                md5=md5_val,
                original_url=url,
                file_name=file_name,
            )

            # 调用下载器处理
            result = await _downloader.process(client, ctx)

            if result.success and result.download_method != "PRE_DUP":
                # 成功
                if result.is_new:
                    new_status = "FALLBACK_NEW"
                    stats["success_new"] += 1
                else:
                    new_status = "FALLBACK_DUP"
                    stats["success_dup"] += 1

                print(f"  成功: {new_status}")

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
                line_updates[line_index + 1] = f"[{result.final_url}]"

            elif result.download_method == "PRE_DUP":
                # 预查重发现已存在
                print(f"  跳过: 图片已存在（预查重）")
                stats["success_dup"] += 1

                # 更新状态为 PRE_DUP
                old_header = record["header_line"]
                new_header = re.sub(
                    r'\[Res:\s*\S+\]',
                    '[Res: PRE_DUP]',
                    old_header
                )
                line_updates[line_index] = new_header

            else:
                # 失败
                print(f"  失败: {result.error_info or 'UNKNOWN'}")
                stats["fail"] += 1

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
    print(f"  失败: {stats['fail']}")
    print("=" * 50)

    # 输出下载器统计
    print("\n下载器统计:")
    print(_downloader.get_stats_string())

    # 保存 rkey 使用计数
    save_rkey_usage()

    return stats


if __name__ == "__main__":
    # 支持命令行参数指定日志文件路径
    log_file = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(reprocess_failed_records(log_file))
