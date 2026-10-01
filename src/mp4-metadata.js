// 在 MP4 的 moov/udta/meta/ilst 寫入 iTunes 風格的中繼資料。
// 會寫入：
//   ©cmt（comment）                    → 一般播放器 / ffprobe 的「註解」
//   ----:com.apple.iTunes:source       → ffprobe 顯示為 `source`
// moov 大小改變後，會修正 stco / co64 / tfhd 中指向 moov 之後的絕對位移。

const textEncoder = new TextEncoder();

// box type 以 Latin-1 編碼，'©' 必須是單一位元組 0xA9
function typeBytes(type) {
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i) & 0xff;
  return out;
}

function typeAt(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function u32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function concat(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function box(type, ...payload) {
  const body = concat(payload);
  return concat([u32(body.length + 8), typeBytes(type), body]);
}

// 解析 [start, end) 範圍內的 box 清單
function readBoxes(bytes, start, end) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = typeAt(bytes, offset + 4);
    let headerSize = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) {
      throw new Error(`無效的 MP4 box：${type} @ ${offset}`);
    }
    boxes.push({ type, start: offset, headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

function slice(bytes, b) {
  return bytes.subarray(b.start, b.end);
}

function dataBox(value) {
  // version/flags：flags = 1 代表 UTF-8 文字；接著 4 bytes locale
  return box('data', u32(1), u32(0), textEncoder.encode(value));
}

function textItem(type, value) {
  return box(type, dataBox(value));
}

function freeformItem(name, value) {
  return box(
    '----',
    box('mean', u32(0), textEncoder.encode('com.apple.iTunes')),
    box('name', u32(0), textEncoder.encode(name)),
    dataBox(value),
  );
}

function freeformName(bytes, item) {
  for (const child of readBoxes(bytes, item.start + item.headerSize, item.end)) {
    if (child.type === 'name') {
      return new TextDecoder().decode(bytes.subarray(child.start + 12, child.end));
    }
  }
  return null;
}

function buildIlst(bytes, oldIlst, metadata) {
  const freeformKeys = new Set(Object.keys(metadata.freeform ?? {}));
  const kept = [];
  if (oldIlst) {
    for (const item of readBoxes(bytes, oldIlst.start + oldIlst.headerSize, oldIlst.end)) {
      if (item.type === '©cmt' && metadata.comment != null) continue;
      if (item.type === '----' && freeformKeys.has(freeformName(bytes, item))) continue;
      kept.push(slice(bytes, item));
    }
  }
  if (metadata.comment != null) kept.push(textItem('©cmt', metadata.comment));
  for (const [name, value] of Object.entries(metadata.freeform ?? {})) {
    kept.push(freeformItem(name, value));
  }
  return box('ilst', ...kept);
}

function buildHdlr() {
  // version/flags, pre_defined, handler_type 'mdir', reserved 'appl' + 0 + 0, 空字串名稱
  return box('hdlr', u32(0), u32(0), typeBytes('mdir'), typeBytes('appl'), u32(0), u32(0), new Uint8Array(1));
}

function buildMeta(bytes, oldMeta, metadata) {
  if (!oldMeta) {
    return box('meta', u32(0), buildHdlr(), buildIlst(bytes, null, metadata));
  }
  // ISO 規範的 meta 是 full box（多 4 bytes version/flags），舊版 QuickTime 則否
  const payloadStart = oldMeta.start + oldMeta.headerSize;
  const isFullBox = typeAt(bytes, payloadStart + 4) !== 'hdlr';
  const childStart = isFullBox ? payloadStart + 4 : payloadStart;
  const children = readBoxes(bytes, childStart, oldMeta.end);
  const oldIlst = children.find((c) => c.type === 'ilst');
  const parts = children.map((c) => (c === oldIlst ? buildIlst(bytes, c, metadata) : slice(bytes, c)));
  if (!children.some((c) => c.type === 'hdlr')) parts.unshift(buildHdlr());
  if (!oldIlst) parts.push(buildIlst(bytes, null, metadata));
  return box('meta', ...(isFullBox ? [bytes.subarray(payloadStart, payloadStart + 4)] : []), ...parts);
}

function buildUdta(bytes, oldUdta, metadata) {
  if (!oldUdta) return box('udta', buildMeta(bytes, null, metadata));
  const children = readBoxes(bytes, oldUdta.start + oldUdta.headerSize, oldUdta.end);
  const oldMeta = children.find((c) => c.type === 'meta');
  const parts = children.map((c) => (c === oldMeta ? buildMeta(bytes, c, metadata) : slice(bytes, c)));
  if (!oldMeta) parts.push(buildMeta(bytes, null, metadata));
  return box('udta', ...parts);
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'moof', 'traf', 'edts', 'dinf']);

// 遞迴走訪 box，將 >= threshold 的絕對位移加上 delta
function shiftOffsets(bytes, start, end, threshold, delta) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const b of readBoxes(bytes, start, end)) {
    const payload = b.start + b.headerSize;
    if (CONTAINERS.has(b.type)) {
      shiftOffsets(bytes, payload, b.end, threshold, delta);
    } else if (b.type === 'stco') {
      const count = view.getUint32(payload + 4);
      for (let i = 0; i < count; i++) {
        const pos = payload + 8 + i * 4;
        const value = view.getUint32(pos);
        if (value < threshold) continue;
        const shifted = value + delta;
        if (shifted > 0xffffffff || shifted < 0) throw new Error('stco 位移溢位');
        view.setUint32(pos, shifted);
      }
    } else if (b.type === 'co64') {
      const count = view.getUint32(payload + 4);
      for (let i = 0; i < count; i++) {
        const pos = payload + 8 + i * 8;
        const value = view.getBigUint64(pos);
        if (value >= BigInt(threshold)) view.setBigUint64(pos, value + BigInt(delta));
      }
    } else if (b.type === 'tfhd') {
      const flags = view.getUint32(payload) & 0xffffff;
      if (flags & 0x1) {
        // base-data-offset 是絕對位移（default-base-is-moof 則是相對位移，不需處理）
        const pos = payload + 8;
        const value = view.getBigUint64(pos);
        if (value >= BigInt(threshold)) view.setBigUint64(pos, value + BigInt(delta));
      }
    }
  }
}

/**
 * 回傳寫入中繼資料後的新 MP4。
 * @param {Uint8Array} bytes 原始 MP4
 * @param {{ comment?: string, freeform?: Record<string, string> }} metadata
 * @returns {Uint8Array}
 */
export function injectMetadata(bytes, metadata) {
  const top = readBoxes(bytes, 0, bytes.length);
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) throw new Error('找不到 moov box，可能不是 MP4 檔');

  const moovChildren = readBoxes(bytes, moov.start + moov.headerSize, moov.end);
  const oldUdta = moovChildren.find((c) => c.type === 'udta');
  const moovParts = moovChildren.map((c) => (c === oldUdta ? buildUdta(bytes, c, metadata) : slice(bytes, c)));
  if (!oldUdta) moovParts.push(buildUdta(bytes, null, metadata));
  const newMoov = box('moov', ...moovParts);

  const delta = newMoov.length - (moov.end - moov.start);
  const output = concat(top.map((b) => (b === moov ? newMoov : slice(bytes, b))));

  if (delta !== 0) {
    // 原檔中位於舊 moov 結尾之後的資料都會往後挪 delta
    const threshold = moov.end;
    shiftOffsets(output, moov.start + 8, moov.start + newMoov.length, threshold, delta);
    for (const b of readBoxes(output, 0, output.length)) {
      if (b.type === 'moof') shiftOffsets(output, b.start + b.headerSize, b.end, threshold, delta);
    }
  }
  return output;
}
