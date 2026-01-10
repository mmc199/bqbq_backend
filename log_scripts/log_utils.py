# -*- coding: utf-8 -*-
"""
日志工具公共模块

功能：
1. 统一的日志解析函数
2. 统一的配置常量
3. 统一的失败类型定义
"""

import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional

# ==========================
#   配置常量
# ==========================
DEFAULT_LOG_DIR = r"D:\bqbq_bot_dev\nonebot2-2.4.4\nonebot\plugins\bqbq"
DEFAULT_LOG_FILE = r"D:\bqbq_bot_dev\nonebot2-2.4.4\nonebot\plugins\bqbq\bqbq_download_full-日志1.log"
LOG_PATTERN = "bqbq_download_full-*.log"

# 失败状态类型（用于筛选需要重处理的记录）
FAIL_STATUSES = frozenset([
    "RKEY_FAIL_HTTP", "RKEY_FAIL_NET", "RKEY_API_FAIL", "RKEY_EXPIRED",
    "FALL_FAIL_HTTP", "RKEY_SKIPPED"
])


# ==========================
#   数据类
# ==========================
@dataclass
class LogRecord:
    """单条日志记录"""
    line_index: int          # 行号
    header_line: str         # 头部行原文
    url_line: str            # URL 行原文
    status: str              # Res 状态
    file_name: str           # 文件名
    url: str                 # URL


@dataclass
class LogStats:
    """日志统计结果"""
    log_path: str
    total_lines: int
    parsed_lines: int
    res_counts: dict
    check_counts: dict
    down_counts: dict
    sums: dict
    fb_counts: dict


# ==========================
#   日志解析函数
# ==========================

# 统计用正则（支持带 [Try:x] 的行）
_STATS_PATTERN = re.compile(
    r'\[Res:\s*(\w+)\]\s*'
    r'\[Check:\s*(\d+)\]\s*'
    r'\[Down:\s*(\d+)\]\s*\|\s*'
    r'\[T:(\d+)\s+D:(\d+)\s+N:(\d+)\s+DD:(\d+)\s*\|\s*'
    r'CS:(\d+)\s+CF:(\d+)\s+FS:(\d+)\s+FF:(\d+)\s*\|\s*'
    r'CN:(\d+)\s+CD:(\d+)\s+FN:(\d+)\s+FD:(\d+)\]\s*\|\s*'
    r'(?:\[Try:\d+\]\s*)?'
    r'\[FB:(\w+)\]'
)

# 简单解析用正则
_RECORD_PATTERN = re.compile(r'\[Res:\s*(\S+)\]')
_FILE_PATTERN = re.compile(r'\[File:\s*([^\]]+)\]')
_URL_PATTERN = re.compile(r'^\[(.+)\]$')


def parse_log_records(file_path: str) -> tuple[list[str], list[LogRecord]]:
    """
    解析日志文件，返回原始行列表和记录列表

    Args:
        file_path: 日志文件路径

    Returns:
        (lines: list[str], records: list[LogRecord])
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    records = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()

        res_match = _RECORD_PATTERN.match(line)
        if res_match:
            status = res_match.group(1)

            # 提取文件名
            file_match = _FILE_PATTERN.search(line)
            file_name = file_match.group(1) if file_match else ""

            # 下一行是 URL
            url_line = ""
            url = ""
            if i + 1 < len(lines):
                url_line = lines[i + 1].strip()
                url_match = _URL_PATTERN.match(url_line)
                if url_match:
                    url = url_match.group(1)

            records.append(LogRecord(
                line_index=i,
                header_line=line,
                url_line=url_line,
                status=status,
                file_name=file_name,
                url=url,
            ))
            i += 2
        else:
            i += 1

    return lines, records


def parse_log_stats(file_path: str) -> LogStats:
    """
    解析日志文件并统计

    Args:
        file_path: 日志文件路径

    Returns:
        LogStats 统计结果
    """
    res_counts = defaultdict(int)
    check_counts = defaultdict(int)
    down_counts = defaultdict(int)
    fb_counts = {"Yes": 0, "No": 0}
    sums = {
        "T": 0, "D": 0, "N": 0, "DD": 0,
        "CS": 0, "CF": 0, "FS": 0, "FF": 0,
        "CN": 0, "CD": 0, "FN": 0, "FD": 0
    }

    total_lines = 0
    parsed_lines = 0

    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            total_lines += 1
            match = _STATS_PATTERN.search(line)
            if match:
                parsed_lines += 1
                g = match.groups()

                res_counts[g[0]] += 1
                check_counts[g[1]] += 1
                down_counts[g[2]] += 1

                sums["T"] += int(g[3])
                sums["D"] += int(g[4])
                sums["N"] += int(g[5])
                sums["DD"] += int(g[6])
                sums["CS"] += int(g[7])
                sums["CF"] += int(g[8])
                sums["FS"] += int(g[9])
                sums["FF"] += int(g[10])
                sums["CN"] += int(g[11])
                sums["CD"] += int(g[12])
                sums["FN"] += int(g[13])
                sums["FD"] += int(g[14])

                if g[15] in fb_counts:
                    fb_counts[g[15]] += 1

    return LogStats(
        log_path=file_path,
        total_lines=total_lines,
        parsed_lines=parsed_lines,
        res_counts=dict(res_counts),
        check_counts=dict(check_counts),
        down_counts=dict(down_counts),
        sums=sums,
        fb_counts=fb_counts,
    )


def print_log_stats(stats: LogStats):
    """打印日志统计结果"""
    print("=" * 60)
    print(f"日志统计结果: {stats.log_path}")
    print("=" * 60)
    print(f"总行数: {stats.total_lines}, 解析成功: {stats.parsed_lines}")
    print()

    print("【Res 类型统计】")
    for res_type, count in sorted(stats.res_counts.items(), key=lambda x: -x[1]):
        print(f"  {res_type}: {count}")
    print()

    print("【Check 状态码统计】")
    for code, count in sorted(stats.check_counts.items(), key=lambda x: -x[1]):
        print(f"  {code}: {count}")
    print()

    print("【Down 状态码统计】")
    for code, count in sorted(stats.down_counts.items(), key=lambda x: -x[1]):
        print(f"  {code}: {count}")
    print()

    print("【数值求和】")
    s = stats.sums
    print(f"  第一组: T={s['T']}, D={s['D']}, N={s['N']}, DD={s['DD']}")
    print(f"  第二组: CS={s['CS']}, CF={s['CF']}, FS={s['FS']}, FF={s['FF']}")
    print(f"  第三组: CN={s['CN']}, CD={s['CD']}, FN={s['FN']}, FD={s['FD']}")
    print()

    print("【FB 统计】")
    print(f"  Yes: {stats.fb_counts['Yes']}, No: {stats.fb_counts['No']}")
    print("=" * 60)


def filter_failed_records(records: list[LogRecord]) -> list[LogRecord]:
    """筛选失败记录"""
    return [r for r in records if r.status in FAIL_STATUSES]


def count_failed(stats: LogStats) -> int:
    """统计失败记录数"""
    return sum(stats.res_counts.get(t, 0) for t in FAIL_STATUSES)
