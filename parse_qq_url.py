# -*- coding: utf-8 -*-
"""
解析 QQ 图片 URL 中的 fileid 和 rkey 参数
它们都是 URL-safe base64 编码的 protobuf 数据
"""

import base64
import sys
import io
from urllib.parse import urlparse, parse_qs

# 设置 stdout 编码
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


def decode_url_safe_base64(data: str) -> bytes:
    """解码 URL-safe base64（用 - 和 _ 替代 + 和 /）"""
    # 补齐 padding
    padding = 4 - len(data) % 4
    if padding != 4:
        data += '=' * padding
    return base64.urlsafe_b64decode(data)


def read_varint(data: bytes, pos: int) -> tuple:
    """读取 varint 编码的整数"""
    result = 0
    shift = 0
    while pos < len(data):
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if (byte & 0x80) == 0:
            break
        shift += 7
    return result, pos


def parse_protobuf_raw(data: bytes, depth: int = 0) -> list:
    """
    手动解析 protobuf 数据（无需 .proto 文件）
    返回 [(field_number, wire_type, value), ...]
    """
    if depth > 5:  # 防止无限递归
        return []

    results = []
    pos = 0

    while pos < len(data):
        start_pos = pos
        try:
            # 读取 varint (field_number << 3 | wire_type)
            tag, pos = read_varint(data, pos)
            if tag == 0:
                break
            field_number = tag >> 3
            wire_type = tag & 0x07

            if field_number == 0 or field_number > 536870911:  # 无效字段号
                break

            if wire_type == 0:  # Varint
                value, pos = read_varint(data, pos)
                results.append((field_number, 'varint', value))
            elif wire_type == 1:  # 64-bit (fixed64, sfixed64, double)
                if pos + 8 > len(data):
                    break
                value = data[pos:pos+8]
                pos += 8
                results.append((field_number, 'fixed64', value))
            elif wire_type == 2:  # Length-delimited (string, bytes, embedded message)
                length, pos = read_varint(data, pos)
                if length > len(data) - pos or length < 0:
                    break
                value = data[pos:pos+length]
                pos += length

                # 尝试解析为嵌套 protobuf
                nested = None
                if len(value) > 2:
                    try:
                        nested = parse_protobuf_raw(value, depth + 1)
                        # 验证嵌套解析是否合理
                        if not nested or len(nested) == 0:
                            nested = None
                    except:
                        nested = None

                if nested:
                    results.append((field_number, 'message', nested))
                else:
                    # 尝试解析为字符串
                    try:
                        str_value = value.decode('utf-8')
                        if str_value.isprintable() or str_value.isalnum():
                            results.append((field_number, 'string', str_value))
                        else:
                            results.append((field_number, 'bytes', value))
                    except:
                        results.append((field_number, 'bytes', value))
            elif wire_type == 5:  # 32-bit (fixed32, sfixed32, float)
                if pos + 4 > len(data):
                    break
                value = data[pos:pos+4]
                pos += 4
                results.append((field_number, 'fixed32', value))
            else:
                # 未知类型，停止解析
                break
        except:
            break

    return results


def format_bytes_smart(data: bytes) -> str:
    """智能格式化字节数据"""
    hex_str = data.hex()
    if len(data) == 20:
        return f"SHA1: {hex_str}"
    elif len(data) == 16:
        return f"MD5/UUID: {hex_str}"
    elif len(data) <= 8:
        # 可能是整数
        int_val = int.from_bytes(data, 'little')
        return f"hex={hex_str}, int(LE)={int_val}"
    else:
        return hex_str


def format_parsed(parsed: list, indent: int = 0) -> str:
    """格式化输出解析结果"""
    lines = []
    prefix = "  " * indent

    for field_num, wire_type, value in parsed:
        if wire_type == 'message':
            lines.append(f"{prefix}Field {field_num} [embedded message]:")
            lines.append(format_parsed(value, indent + 1))
        elif wire_type == 'bytes':
            formatted = format_bytes_smart(value)
            lines.append(f"{prefix}Field {field_num} [bytes]: {formatted}")
        elif wire_type == 'string':
            lines.append(f"{prefix}Field {field_num} [string]: \"{value}\"")
        elif wire_type == 'varint':
            extra = ""
            # 尝试解释为时间戳
            if 1600000000 < value < 2000000000:
                from datetime import datetime
                try:
                    dt = datetime.fromtimestamp(value)
                    extra = f" (timestamp: {dt})"
                except:
                    pass
            lines.append(f"{prefix}Field {field_num} [varint]: {value}{extra}")
        elif wire_type in ('fixed64', 'fixed32'):
            hex_str = value.hex()
            int_val = int.from_bytes(value, 'little')
            lines.append(f"{prefix}Field {field_num} [{wire_type}]: hex={hex_str}, int={int_val}")
        else:
            lines.append(f"{prefix}Field {field_num} [{wire_type}]: {value}")

    return "\n".join(lines)


def main():
    url = "https://gchat.qpic.cn/download?appid=1407&fileid=EhQ5BLRT4bxJ_-4xGJw0CPyUSdNP-hjxoQMg_woo97TXi4H5kQMyBHByb2RQgL2jAVoQkb0x_JXLKvxDpXsdrqdBoHoCz7SCAQJuag&rkey=&rkey=CAESMIuKzOqW5Fxa-fJorEbU5BS5SdbeWIWkxO8HSQRpVEP30LYIyb6kOct8Bqz2fcH20g&spec=0"

    parsed_url = urlparse(url)
    params = parse_qs(parsed_url.query)

    print("=" * 60)
    print("QQ Image URL Parser")
    print("=" * 60)
    print(f"Host: {parsed_url.netloc}")
    print(f"Path: {parsed_url.path}")
    print(f"appid: {params.get('appid', [''])[0]}")
    print(f"spec: {params.get('spec', [''])[0]}")
    print()

    # 解析 fileid
    fileid = params.get('fileid', [''])[0]
    if fileid:
        print("=" * 60)
        print("Parsing fileid (File Identifier)")
        print("=" * 60)
        print(f"Raw: {fileid}")
        print()

        try:
            fileid_bytes = decode_url_safe_base64(fileid)
            print(f"Decoded bytes: {len(fileid_bytes)}")
            print(f"Hex: {fileid_bytes.hex()}")
            print()

            parsed = parse_protobuf_raw(fileid_bytes)
            print("Protobuf structure:")
            print("-" * 40)
            print(format_parsed(parsed))
        except Exception as e:
            print(f"Parse error: {e}")
            import traceback
            traceback.print_exc()

    print()

    # 解析 rkey
    rkey_list = params.get('rkey', [])
    rkey_list = [r for r in rkey_list if r]

    if rkey_list:
        rkey = rkey_list[0]
        print("=" * 60)
        print("Parsing rkey (Resource Key)")
        print("=" * 60)
        print(f"Raw: {rkey}")
        print()

        try:
            rkey_bytes = decode_url_safe_base64(rkey)
            print(f"Decoded bytes: {len(rkey_bytes)}")
            print(f"Hex: {rkey_bytes.hex()}")
            print()

            parsed = parse_protobuf_raw(rkey_bytes)
            print("Protobuf structure:")
            print("-" * 40)
            print(format_parsed(parsed))
        except Exception as e:
            print(f"Parse error: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    main()
