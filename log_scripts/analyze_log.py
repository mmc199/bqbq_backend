# -*- coding: utf-8 -*-
"""
日志统计脚本 - 解析 bqbq_download_full-*.log 并统计各变量求和
支持命令行参数指定日志文件路径
"""

import sys
from log_utils import DEFAULT_LOG_FILE, parse_log_stats, print_log_stats, LogStats


def parse_log(log_path: str = None, silent: bool = False) -> dict:
    """
    解析日志文件并统计（兼容旧接口）

    Args:
        log_path: 日志文件路径，默认使用 DEFAULT_LOG_FILE
        silent: 静默模式，不打印输出

    Returns:
        dict: 统计结果字典
    """
    if log_path is None:
        log_path = DEFAULT_LOG_FILE

    stats = parse_log_stats(log_path)

    if not silent:
        print_log_stats(stats)

    # 返回兼容旧格式的字典
    return {
        "log_path": stats.log_path,
        "total_lines": stats.total_lines,
        "parsed_lines": stats.parsed_lines,
        "res_counts": stats.res_counts,
        "check_counts": stats.check_counts,
        "down_counts": stats.down_counts,
        "sums": stats.sums,
        "fb_counts": stats.fb_counts,
    }


if __name__ == "__main__":
    log_path = sys.argv[1] if len(sys.argv) > 1 else None
    parse_log(log_path)
