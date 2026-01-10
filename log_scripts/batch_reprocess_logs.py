# -*- coding: utf-8 -*-
"""
批量重处理日志脚本

功能：
1. 扫描指定目录下所有 bqbq_download_full-*.log 文件
2. 对每个文件执行：统计处理前状态 -> 重处理失败记录 -> 统计处理后状态
3. 输出前后对比统计

使用方式：
    python batch_reprocess_logs.py [日志目录]
"""

import os
import sys
import glob
import asyncio

from log_utils import (
    DEFAULT_LOG_DIR, LOG_PATTERN, FAIL_STATUSES,
    parse_log_stats, count_failed
)
from reprocess_failed_logs import reprocess_failed_records


def find_log_files(log_dir: str) -> list:
    """扫描目录下所有匹配的日志文件"""
    return sorted(glob.glob(os.path.join(log_dir, LOG_PATTERN)))


def print_comparison(before, after, reprocess_stats: dict):
    """打印前后对比统计"""
    print("\n" + "=" * 70)
    print("【处理前后对比】")
    print("=" * 70)

    all_res = set(before.res_counts.keys()) | set(after.res_counts.keys())

    print(f"\n{'Res 类型':<20} {'处理前':>10} {'处理后':>10} {'变化':>10}")
    print("-" * 50)

    for res_type in sorted(all_res):
        b = before.res_counts.get(res_type, 0)
        a = after.res_counts.get(res_type, 0)
        diff = a - b
        marker = " *" if res_type in FAIL_STATUSES else ""
        print(f"{res_type:<20} {b:>10} {a:>10} {diff:>+10}{marker}")

    print("\n【重处理统计】")
    print(f"  总数={reprocess_stats.get('total', 0)} 新增={reprocess_stats.get('success_new', 0)} "
          f"重复={reprocess_stats.get('success_dup', 0)} 失败={reprocess_stats.get('fail', 0)}")
    print("=" * 70)


async def process_single_log(log_file: str) -> dict:
    """处理单个日志文件"""
    print("\n" + "#" * 70)
    print(f"# 处理文件: {os.path.basename(log_file)}")
    print("#" * 70)

    # 处理前统计
    before = parse_log_stats(log_file)
    fail_count = count_failed(before)
    print(f"\n>>> 处理前: 总记录={before.parsed_lines} 失败={fail_count}")

    if fail_count == 0:
        print("    无需处理，跳过")
        return {"file": log_file, "before": before, "after": before,
                "reprocess": {"total": 0, "success_new": 0, "success_dup": 0, "fail": 0}}

    # 执行重处理
    print("\n>>> 开始重处理")
    reprocess_stats = await reprocess_failed_records(log_file)

    # 处理后统计
    after = parse_log_stats(log_file)
    print_comparison(before, after, reprocess_stats)

    return {"file": log_file, "before": before, "after": after, "reprocess": reprocess_stats}


async def batch_process(log_dir: str):
    """批量处理所有日志文件"""
    print("=" * 70)
    print(f"批量重处理日志 | 目录: {log_dir} | 模式: {LOG_PATTERN}")
    print("=" * 70)

    log_files = find_log_files(log_dir)
    if not log_files:
        print(f"\n[警告] 未找到匹配的日志文件")
        return

    print(f"\n找到 {len(log_files)} 个日志文件:")
    for f in log_files:
        print(f"  - {os.path.basename(f)}")

    results = [await process_single_log(f) for f in log_files]

    # 汇总
    print("\n" + "=" * 70)
    print("【汇总统计】")
    print("=" * 70)

    total_before = sum(count_failed(r["before"]) for r in results)
    total_after = sum(count_failed(r["after"]) for r in results)
    total_new = sum(r["reprocess"].get("success_new", 0) for r in results)
    total_dup = sum(r["reprocess"].get("success_dup", 0) for r in results)
    total_fail = sum(r["reprocess"].get("fail", 0) for r in results)

    print(f"文件数: {len(results)}")
    print(f"处理前失败: {total_before} → 处理后失败: {total_after}")
    print(f"成功恢复: {total_before - total_after} (新增={total_new} 重复={total_dup})")
    print(f"仍然失败: {total_fail}")
    print("=" * 70)


if __name__ == "__main__":
    log_dir = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_LOG_DIR
    if not os.path.isdir(log_dir):
        print(f"[错误] 目录不存在: {log_dir}")
        sys.exit(1)
    asyncio.run(batch_process(log_dir))
