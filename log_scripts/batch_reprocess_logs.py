# -*- coding: utf-8 -*-
"""
批量重处理日志脚本

功能：
1. 扫描指定目录下所有 bqbq_download_full-*.log 文件
2. 对每个文件执行：统计处理前状态 -> 重处理失败记录 -> 统计处理后状态
3. 输出前后对比统计

使用方式：
    python batch_reprocess_logs.py [日志目录]

默认目录: D:\\bqbq_bot_dev\\nonebot2-2.4.4\\nonebot\\plugins\\bqbq
"""

import os
import sys
import glob
import asyncio

# 导入本地模块
from analyze_log import parse_log
from reprocess_failed_logs import reprocess_failed_records

# ==========================
#   配置
# ==========================
DEFAULT_LOG_DIR = r"D:\bqbq_bot_dev\nonebot2-2.4.4\nonebot\plugins\bqbq"
LOG_PATTERN = "bqbq_download_full-*.log"


def find_log_files(log_dir: str) -> list:
    """扫描目录下所有匹配的日志文件"""
    pattern = os.path.join(log_dir, LOG_PATTERN)
    files = glob.glob(pattern)
    return sorted(files)


def print_comparison(before: dict, after: dict, reprocess_stats: dict):
    """打印前后对比统计"""
    print("\n" + "=" * 70)
    print("【处理前后对比】")
    print("=" * 70)

    # Res 类型对比
    all_res_types = set(before.get("res_counts", {}).keys()) | set(after.get("res_counts", {}).keys())
    fail_types = {"FALL_FAIL_HTTP", "RKEY_FAIL_HTTP", "RKEY_SKIPPED", "RKEY_API_FAIL", "RKEY_FAIL_NET"}

    print(f"\n{'Res 类型':<20} {'处理前':>10} {'处理后':>10} {'变化':>10}")
    print("-" * 50)

    for res_type in sorted(all_res_types):
        before_count = before.get("res_counts", {}).get(res_type, 0)
        after_count = after.get("res_counts", {}).get(res_type, 0)
        diff = after_count - before_count
        diff_str = f"+{diff}" if diff > 0 else str(diff)

        # 高亮失败类型
        marker = " *" if res_type in fail_types else ""
        print(f"{res_type:<20} {before_count:>10} {after_count:>10} {diff_str:>10}{marker}")

    # 重处理统计
    print("\n【重处理统计】")
    print(f"  处理总数: {reprocess_stats.get('total', 0)}")
    print(f"  成功-新增: {reprocess_stats.get('success_new', 0)}")
    print(f"  成功-重复: {reprocess_stats.get('success_dup', 0)}")
    print(f"  失败-下载: {reprocess_stats.get('fail_download', 0)}")
    print(f"  失败-上传: {reprocess_stats.get('fail_upload', 0)}")
    print(f"  失败-rkey: {reprocess_stats.get('fail_rkey', 0)}")

    print("=" * 70)


async def process_single_log(log_file: str):
    """处理单个日志文件"""
    print("\n" + "#" * 70)
    print(f"# 处理文件: {os.path.basename(log_file)}")
    print("#" * 70)

    # 1. 处理前统计
    print("\n>>> 处理前统计")
    before_stats = parse_log(log_file, silent=True)

    # 快速显示失败记录数
    fail_types = {"FALL_FAIL_HTTP", "RKEY_FAIL_HTTP", "RKEY_SKIPPED", "RKEY_API_FAIL", "RKEY_FAIL_NET"}
    fail_count = sum(before_stats.get("res_counts", {}).get(t, 0) for t in fail_types)
    print(f"    总记录数: {before_stats.get('parsed_lines', 0)}")
    print(f"    失败记录数: {fail_count}")

    if fail_count == 0:
        print("    无需处理，跳过")
        return {
            "file": log_file,
            "before": before_stats,
            "after": before_stats,
            "reprocess": {"total": 0, "success_new": 0, "success_dup": 0, "fail_download": 0, "fail_upload": 0, "fail_rkey": 0}
        }

    # 2. 执行重处理
    print("\n>>> 开始重处理")
    reprocess_stats = await reprocess_failed_records(log_file)

    # 3. 处理后统计
    print("\n>>> 处理后统计")
    after_stats = parse_log(log_file, silent=True)

    # 4. 输出对比
    print_comparison(before_stats, after_stats, reprocess_stats)

    return {
        "file": log_file,
        "before": before_stats,
        "after": after_stats,
        "reprocess": reprocess_stats
    }


async def batch_process(log_dir: str):
    """批量处理所有日志文件"""
    print("=" * 70)
    print("批量重处理日志脚本")
    print("=" * 70)
    print(f"日志目录: {log_dir}")
    print(f"匹配模式: {LOG_PATTERN}")

    # 查找日志文件
    log_files = find_log_files(log_dir)

    if not log_files:
        print(f"\n[警告] 未找到匹配的日志文件")
        return

    print(f"\n找到 {len(log_files)} 个日志文件:")
    for f in log_files:
        print(f"  - {os.path.basename(f)}")

    # 处理每个文件
    all_results = []
    for log_file in log_files:
        result = await process_single_log(log_file)
        all_results.append(result)

    # 汇总统计
    print("\n" + "=" * 70)
    print("【汇总统计】")
    print("=" * 70)

    total_before_fail = 0
    total_after_fail = 0
    total_new = 0
    total_dup = 0
    total_fail = 0

    fail_types = {"FALL_FAIL_HTTP", "RKEY_FAIL_HTTP", "RKEY_SKIPPED", "RKEY_API_FAIL", "RKEY_FAIL_NET"}

    for r in all_results:
        before_fail = sum(r["before"].get("res_counts", {}).get(t, 0) for t in fail_types)
        after_fail = sum(r["after"].get("res_counts", {}).get(t, 0) for t in fail_types)
        total_before_fail += before_fail
        total_after_fail += after_fail
        total_new += r["reprocess"].get("success_new", 0)
        total_dup += r["reprocess"].get("success_dup", 0)
        total_fail += r["reprocess"].get("fail_download", 0) + r["reprocess"].get("fail_upload", 0)

    print(f"处理文件数: {len(all_results)}")
    print(f"处理前失败记录总数: {total_before_fail}")
    print(f"处理后失败记录总数: {total_after_fail}")
    print(f"成功恢复: {total_before_fail - total_after_fail}")
    print(f"  - 新增: {total_new}")
    print(f"  - 重复: {total_dup}")
    print(f"仍然失败: {total_fail}")
    print("=" * 70)


if __name__ == "__main__":
    # 支持命令行参数指定日志目录
    log_dir = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_LOG_DIR

    if not os.path.isdir(log_dir):
        print(f"[错误] 目录不存在: {log_dir}")
        sys.exit(1)

    asyncio.run(batch_process(log_dir))
