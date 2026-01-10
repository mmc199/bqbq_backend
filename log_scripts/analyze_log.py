# -*- coding: utf-8 -*-
"""
日志统计脚本 - 解析 bqbq_download_full-*.log 并统计各变量求和
支持命令行参数指定日志文件路径
"""

import re
import sys
from collections import defaultdict

DEFAULT_LOG_PATH = r"D:\bqbq_bot_dev\nonebot2-2.4.4\nonebot\plugins\bqbq\bqbq_download_full-日志1.log"

def parse_log(log_path: str = None, silent: bool = False):
    """
    解析日志文件并统计

    Args:
        log_path: 日志文件路径，默认使用 DEFAULT_LOG_PATH
        silent: 静默模式，不打印输出，直接返回统计结果

    Returns:
        dict: 统计结果字典（仅在 silent=True 时返回）
    """
    if log_path is None:
        log_path = DEFAULT_LOG_PATH

    # 统计计数器
    res_counts = defaultdict(int)      # Res 类型计数
    check_counts = defaultdict(int)    # Check 状态码计数
    down_counts = defaultdict(int)     # Down 状态码计数
    fb_counts = {"Yes": 0, "No": 0}    # FB 计数

    # 数值求和
    sums = {
        "T": 0, "D": 0, "N": 0, "DD": 0,
        "CS": 0, "CF": 0, "FS": 0, "FF": 0,
        "CN": 0, "CD": 0, "FN": 0, "FD": 0
    }

    total_lines = 0
    parsed_lines = 0

    # 正则表达式 - 支持带 [Try:x] 的行
    pattern = re.compile(
        r'\[Res:\s*(\w+)\]\s*'
        r'\[Check:\s*(\d+)\]\s*'
        r'\[Down:\s*(\d+)\]\s*\|\s*'
        r'\[T:(\d+)\s+D:(\d+)\s+N:(\d+)\s+DD:(\d+)\s*\|\s*'
        r'CS:(\d+)\s+CF:(\d+)\s+FS:(\d+)\s+FF:(\d+)\s*\|\s*'
        r'CN:(\d+)\s+CD:(\d+)\s+FN:(\d+)\s+FD:(\d+)\]\s*\|\s*'
        r'(?:\[Try:\d+\]\s*)?'  # 可选的 [Try:x]
        r'\[FB:(\w+)\]'
    )

    with open(log_path, 'r', encoding='utf-8') as f:
        for line in f:
            total_lines += 1
            match = pattern.search(line)
            if match:
                parsed_lines += 1
                groups = match.groups()

                # Res 类型
                res_counts[groups[0]] += 1

                # Check 和 Down 状态码
                check_counts[groups[1]] += 1
                down_counts[groups[2]] += 1

                # 数值求和
                sums["T"] += int(groups[3])
                sums["D"] += int(groups[4])
                sums["N"] += int(groups[5])
                sums["DD"] += int(groups[6])
                sums["CS"] += int(groups[7])
                sums["CF"] += int(groups[8])
                sums["FS"] += int(groups[9])
                sums["FF"] += int(groups[10])
                sums["CN"] += int(groups[11])
                sums["CD"] += int(groups[12])
                sums["FN"] += int(groups[13])
                sums["FD"] += int(groups[14])

                # FB 计数
                fb_val = groups[15]
                if fb_val in fb_counts:
                    fb_counts[fb_val] += 1

    # 构建结果字典
    result = {
        "log_path": log_path,
        "total_lines": total_lines,
        "parsed_lines": parsed_lines,
        "res_counts": dict(res_counts),
        "check_counts": dict(check_counts),
        "down_counts": dict(down_counts),
        "sums": sums,
        "fb_counts": fb_counts,
    }

    # 静默模式直接返回
    if silent:
        return result

    # 输出结果
    print("=" * 60)
    print(f"日志统计结果: {log_path}")
    print("=" * 60)
    print(f"总行数: {total_lines}, 解析成功: {parsed_lines}")
    print()

    print("【Res 类型统计】")
    for res_type, count in sorted(res_counts.items(), key=lambda x: -x[1]):
        print(f"  {res_type}: {count}")
    print()

    print("【Check 状态码统计】")
    for code, count in sorted(check_counts.items(), key=lambda x: -x[1]):
        print(f"  {code}: {count}")
    print()

    print("【Down 状态码统计】")
    for code, count in sorted(down_counts.items(), key=lambda x: -x[1]):
        print(f"  {code}: {count}")
    print()

    print("【数值求和】")
    print(f"  第一组: T={sums['T']}, D={sums['D']}, N={sums['N']}, DD={sums['DD']}")
    print(f"  第二组: CS={sums['CS']}, CF={sums['CF']}, FS={sums['FS']}, FF={sums['FF']}")
    print(f"  第三组: CN={sums['CN']}, CD={sums['CD']}, FN={sums['FN']}, FD={sums['FD']}")
    print()

    print("【FB 统计】")
    print(f"  Yes: {fb_counts['Yes']}, No: {fb_counts['No']}")
    print("=" * 60)

    return result

if __name__ == "__main__":
    # 支持命令行参数指定日志文件路径
    log_path = sys.argv[1] if len(sys.argv) > 1 else None
    parse_log(log_path)
