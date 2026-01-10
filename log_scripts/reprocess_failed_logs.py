"""
重处理失败日志脚本

功能：
1. 读取 bqbq_download_full-*.log 中的失败记录
2. 使用公共 image_downloader 模块重新下载并上传
3. 成功后更新日志状态
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
from log_utils import (
    DEFAULT_LOG_FILE, parse_log_records, filter_failed_records
)

# ==========================
#   配置
# ==========================
BACKEND_BASE_URL = "http://127.0.0.1:5001"
_downloader = ImageDownloader(backend_url=BACKEND_BASE_URL)


async def reprocess_failed_records(log_file: str = None) -> dict:
    """
    重处理失败记录

    Args:
        log_file: 日志文件路径，默认使用 DEFAULT_LOG_FILE

    Returns:
        dict: 处理统计结果
    """
    load_rkey_usage()

    if log_file is None:
        log_file = DEFAULT_LOG_FILE

    print(f"[开始] 读取日志文件: {log_file}")

    # 解析日志
    lines, records = parse_log_records(log_file)
    print(f"[解析] 共 {len(records)} 条记录")

    # 筛选失败记录
    failed = filter_failed_records(records)
    print(f"[筛选] 需重处理 {len(failed)} 条失败记录")

    if not failed:
        print("[完成] 没有需要重处理的记录")
        return {"total": 0, "success_new": 0, "success_dup": 0, "fail": 0}

    stats = {"total": len(failed), "success_new": 0, "success_dup": 0, "fail": 0}
    line_updates = {}

    async with httpx.AsyncClient(timeout=30.0) as client:
        for idx, rec in enumerate(failed):
            print(f"\n[{idx + 1}/{len(failed)}] 处理: {rec.file_name}")

            if "rkey=" not in rec.url:
                print(f"  跳过: URL 不包含 rkey")
                continue

            md5_val = rec.file_name.split(".")[0] if rec.file_name else ""
            ctx = DownloadContext(md5=md5_val, original_url=rec.url, file_name=rec.file_name)
            result = await _downloader.process(client, ctx)

            if result.success and result.download_method != "PRE_DUP":
                new_status = "FALLBACK_NEW" if result.is_new else "FALLBACK_DUP"
                stats["success_new" if result.is_new else "success_dup"] += 1
                print(f"  成功: {new_status}")

                # 更新行
                new_header = re.sub(r'\[Res:\s*\S+\]', f'[Res: {new_status}]', rec.header_line)
                new_header = re.sub(r'\[Down:\s*\d+\]', '[Down: 200]', new_header)
                line_updates[rec.line_index] = new_header
                line_updates[rec.line_index + 1] = f"[{result.final_url}]"

            elif result.download_method == "PRE_DUP":
                print(f"  跳过: 图片已存在（预查重）")
                stats["success_dup"] += 1
                new_header = re.sub(r'\[Res:\s*\S+\]', '[Res: PRE_DUP]', rec.header_line)
                line_updates[rec.line_index] = new_header

            else:
                print(f"  失败: {result.error_info or 'UNKNOWN'}")
                stats["fail"] += 1

    # 写入更新
    if line_updates:
        print(f"\n[写入] 更新 {len(line_updates)} 行...")
        for idx, content in line_updates.items():
            lines[idx] = content + "\n"
        with open(log_file, 'w', encoding='utf-8') as f:
            f.writelines(lines)
        print("[完成] 日志已更新")

    # 输出统计
    print("\n" + "=" * 50)
    print(f"处理统计: 总数={stats['total']} 新增={stats['success_new']} 重复={stats['success_dup']} 失败={stats['fail']}")
    print("=" * 50)
    print("\n下载器统计:")
    print(_downloader.get_stats_string())

    save_rkey_usage()
    return stats


if __name__ == "__main__":
    log_file = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(reprocess_failed_records(log_file))
