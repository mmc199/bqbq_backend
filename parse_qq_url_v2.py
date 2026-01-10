# -*- coding: utf-8 -*-
"""
QQ 图片 URL fileid/rkey 解析器 v2
根据逆向分析结果，解读各字段含义
"""

import base64
import sys
import io
from urllib.parse import urlparse, parse_qs

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


def decode_url_safe_base64(data: str) -> bytes:
    """解码 URL-safe base64"""
    padding = 4 - len(data) % 4
    if padding != 4:
        data += '=' * padding
    return base64.urlsafe_b64decode(data)


def read_varint(data: bytes, pos: int) -> tuple:
    """读取 varint"""
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


def parse_protobuf(data: bytes, depth: int = 0) -> list:
    """解析 protobuf 为 (field, type, value) 列表"""
    if depth > 10:
        return []

    results = []
    pos = 0

    while pos < len(data):
        try:
            tag, new_pos = read_varint(data, pos)
            if tag == 0:
                break
            field_number = tag >> 3
            wire_type = tag & 0x07

            if field_number == 0 or field_number > 536870911:
                break

            pos = new_pos

            if wire_type == 0:  # Varint
                value, pos = read_varint(data, pos)
                results.append((field_number, 'varint', value))
            elif wire_type == 1:  # 64-bit
                if pos + 8 > len(data):
                    break
                value = data[pos:pos+8]
                pos += 8
                results.append((field_number, 'fixed64', value))
            elif wire_type == 2:  # Length-delimited
                length, pos = read_varint(data, pos)
                if length > len(data) - pos or length < 0:
                    break
                value = data[pos:pos+length]
                pos += length
                results.append((field_number, 'bytes', value))
            elif wire_type == 5:  # 32-bit
                if pos + 4 > len(data):
                    break
                value = data[pos:pos+4]
                pos += 4
                results.append((field_number, 'fixed32', value))
            else:
                break
        except:
            break

    return results


def analyze_fileid(fileid_b64: str):
    """分析 fileid 结构"""
    print("=" * 60)
    print("fileid 解析结果")
    print("=" * 60)

    data = decode_url_safe_base64(fileid_b64)
    print(f"原始 Base64: {fileid_b64}")
    print(f"解码后长度: {len(data)} bytes")
    print(f"十六进制: {data.hex()}")
    print()

    fields = parse_protobuf(data)

    print("字段解析:")
    print("-" * 60)

    for field_num, wire_type, value in fields:
        if wire_type == 'varint':
            # 根据字段号推测含义
            if field_num == 3:
                print(f"  Field {field_num}: {value}")
                print(f"           -> 可能是: 未知标识")
            elif field_num == 4:
                print(f"  Field {field_num}: {value}")
                print(f"           -> appid (应用ID)")
            elif field_num == 5:
                print(f"  Field {field_num}: {value}")
                print(f"           -> 可能是: 发送者ID 或 消息序列号")
            elif field_num == 10:
                print(f"  Field {field_num}: {value}")
                print(f"           -> 可能是: 文件大小 ({value} bytes = {value/1024:.1f} KB)")
            else:
                print(f"  Field {field_num}: {value}")

        elif wire_type == 'bytes':
            hex_val = value.hex()
            # 尝试解析嵌套
            nested = parse_protobuf(value, 1)
            if nested and len(nested) >= 1:
                print(f"  Field {field_num}: [嵌套消息]")
                for nf, nt, nv in nested:
                    if nt == 'fixed64':
                        int_val = int.from_bytes(nv, 'little')
                        print(f"           -> 子字段 {nf}: {nv.hex()} (int: {int_val})")
                    elif nt == 'fixed32':
                        int_val = int.from_bytes(nv, 'little')
                        print(f"           -> 子字段 {nf}: {nv.hex()} (int: {int_val})")
                    elif nt == 'varint':
                        print(f"           -> 子字段 {nf}: {nv}")
                    elif nt == 'bytes':
                        if len(nv) == 20:
                            print(f"           -> 子字段 {nf}: SHA1 = {nv.hex()}")
                        elif len(nv) == 16:
                            print(f"           -> 子字段 {nf}: MD5/GUID = {nv.hex()}")
                        else:
                            print(f"           -> 子字段 {nf}: {nv.hex()}")
            else:
                # 检查是否是 SHA1 (20 bytes) 或 MD5 (16 bytes)
                if len(value) == 20:
                    print(f"  Field {field_num}: SHA1 = {hex_val}")
                elif len(value) == 16:
                    print(f"  Field {field_num}: MD5/GUID = {hex_val}")
                else:
                    # 尝试解码为字符串
                    try:
                        str_val = value.decode('utf-8')
                        if str_val.isprintable():
                            print(f"  Field {field_num}: \"{str_val}\"")
                            if field_num == 6:
                                print(f"           -> 可能是: 环境标识 (prod=生产环境)")
                            elif field_num == 16:
                                print(f"           -> 可能是: 服务器节点标识")
                        else:
                            print(f"  Field {field_num}: {hex_val}")
                    except:
                        print(f"  Field {field_num}: {hex_val}")

        elif wire_type == 'fixed64':
            int_val = int.from_bytes(value, 'little')
            print(f"  Field {field_num}: {value.hex()} (int: {int_val})")

        elif wire_type == 'fixed32':
            int_val = int.from_bytes(value, 'little')
            print(f"  Field {field_num}: {value.hex()} (int: {int_val})")


def analyze_rkey(rkey_b64: str):
    """分析 rkey 结构"""
    print()
    print("=" * 60)
    print("rkey 解析结果")
    print("=" * 60)

    data = decode_url_safe_base64(rkey_b64)
    print(f"原始 Base64: {rkey_b64}")
    print(f"解码后长度: {len(data)} bytes")
    print(f"十六进制: {data.hex()}")
    print()

    fields = parse_protobuf(data)

    print("字段解析:")
    print("-" * 60)

    for field_num, wire_type, value in fields:
        if wire_type == 'varint':
            print(f"  Field {field_num}: {value}")
            if field_num == 1:
                print(f"           -> 可能是: 版本号 或 类型标识")
        elif wire_type == 'bytes':
            hex_val = value.hex()
            print(f"  Field {field_num}: {hex_val}")
            print(f"           -> 长度: {len(value)} bytes")
            if len(value) == 48:
                print(f"           -> 可能是: 签名/密钥数据 (包含时间戳等)")
                # 尝试进一步解析
                # 前 8 字节可能是时间戳
                ts_bytes = value[:8]
                ts_int = int.from_bytes(ts_bytes, 'big')
                print(f"           -> 前8字节(BE): {ts_int}")
                ts_int_le = int.from_bytes(ts_bytes, 'little')
                print(f"           -> 前8字节(LE): {ts_int_le}")


def main():
    url = "https://gchat.qpic.cn/download?appid=1407&fileid=EhQ5BLRT4bxJ_-4xGJw0CPyUSdNP-hjxoQMg_woo97TXi4H5kQMyBHByb2RQgL2jAVoQkb0x_JXLKvxDpXsdrqdBoHoCz7SCAQJuag&rkey=&rkey=CAESMIuKzOqW5Fxa-fJorEbU5BS5SdbeWIWkxO8HSQRpVEP30LYIyb6kOct8Bqz2fcH20g&spec=0"

    parsed_url = urlparse(url)
    params = parse_qs(parsed_url.query)

    print("=" * 60)
    print("QQ 图片 URL 完整解析")
    print("=" * 60)
    print(f"URL: {url[:80]}...")
    print()
    print("URL 参数:")
    print(f"  - host: {parsed_url.netloc}")
    print(f"  - path: {parsed_url.path}")
    print(f"  - appid: {params.get('appid', [''])[0]} (1407 = 群聊图片)")
    print(f"  - spec: {params.get('spec', [''])[0]} (图片规格, 0=原图)")
    print()

    fileid = params.get('fileid', [''])[0]
    if fileid:
        analyze_fileid(fileid)

    rkey_list = [r for r in params.get('rkey', []) if r]
    if rkey_list:
        analyze_rkey(rkey_list[0])

    print()
    print("=" * 60)
    print("总结")
    print("=" * 60)
    print("""
根据逆向分析，fileid 是一个 protobuf 结构，包含:
  - Field 2: 文件唯一标识 (两个 fixed64 组成)
  - Field 4: appid (应用类型, 1407=群聊图片)
  - Field 5: 发送者相关ID 或 消息序列号
  - Field 6: 环境标识 (prod=生产环境)
  - Field 10: 文件大小
  - Field 11: 包含 SHA1 等校验信息
  - Field 16: 服务器节点标识

rkey 是资源访问密钥，包含:
  - Field 1: 版本/类型
  - Field 2: 签名数据 (可能包含时间戳、appid 等)

重要发现:
  - fileid 中除了 SHA1 以外的字段可以乱写，不影响资源获取
  - 腾讯已废弃 MD5，改用 SHA1 进行文件校验
  - rkey 是访问凭证，有时效性
""")


if __name__ == "__main__":
    main()
