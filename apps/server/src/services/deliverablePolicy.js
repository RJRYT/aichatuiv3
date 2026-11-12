import { inflateRawSync } from 'node:zlib';

function extractLatestUserText(messages = []) {
  const last = [...messages].reverse().find((item) => item?.role === 'user');
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  if (Array.isArray(last.content)) {
    return last.content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function detectDeliverableContract(messages = []) {
  const text = extractLatestUserText(messages);
  const action =
    /\b(build|create|make|develop|implement|generate|produce|prepare|download|fetch|export|convert|package)\b/i.test(
      text
    );
  const target =
    /\b(website|web\s?app|webpage|site|application|app|project|program|script|dashboard|game|tool|template)\b/i.test(
      text
    );
  const imageDownload =
    /\b(download|fetch)\b[\s\S]{0,100}\b(image|photo|picture|logo|asset)\b/i.test(text);
  const imageGeneration =
    /\b(create|generate|draw|design)\b[\s\S]{0,100}\b(image|illustration|artwork|concept art)\b/i.test(
      text
    );
  const fileIntent =
    /\b(file|files|document|spreadsheet|presentation|report|pdf|zip|archive|downloadable)\b/i.test(
      text
    ) || imageDownload;
  if (!(action && (target || fileIntent || imageGeneration))) return null;
  const archiveRequired =
    /\b(zip|zip\s+(?:it|all|the)|archive|package\s+(?:it|the\s+project))\b/i.test(text);
  const website = /\b(website|web\s?app|webpage|site|dashboard)\b/i.test(text);
  const requiresPlan = Boolean(
    archiveRequired ||
    website ||
    /\b(application|app|project|program|script|dashboard|game|tool|template)\b/i.test(text)
  );
  return {
    required: true,
    archiveRequired,
    website,
    requiresPlan,
    executionTool: imageGeneration && !imageDownload ? 'generate_image' : 'execute_python',
    userRequest: text.slice(0, 3000),
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function inspectZipBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    return { valid: false, reason: 'ZIP is too small to contain a valid end record.' };
  }
  const min = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { valid: false, reason: 'ZIP end-of-central-directory record is missing.' };
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (!entries || centralOffset + centralSize > eocd) {
    return { valid: false, reason: 'ZIP central directory is empty or out of bounds.' };
  }
  const files = [];
  let cursor = centralOffset;
  try {
    for (let index = 0; index < entries; index++) {
      if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
        return { valid: false, reason: 'ZIP central directory entry is malformed.' };
      }
      const expectedCrc = buffer.readUInt32LE(cursor + 16);
      const compressedSize = buffer.readUInt32LE(cursor + 20);
      const uncompressedSize = buffer.readUInt32LE(cursor + 24);
      const nameLength = buffer.readUInt16LE(cursor + 28);
      const extraLength = buffer.readUInt16LE(cursor + 30);
      const commentLength = buffer.readUInt16LE(cursor + 32);
      const localOffset = buffer.readUInt32LE(cursor + 42);
      const end = cursor + 46 + nameLength + extraLength + commentLength;
      if (end > buffer.length) return { valid: false, reason: 'ZIP entry metadata is truncated.' };
      const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
      cursor = end;
      if (!name || name.endsWith('/')) continue;
      if (name.startsWith('/') || name.split(/[\\/]/).includes('..')) {
        return { valid: false, reason: 'ZIP contains an unsafe file path.' };
      }
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
        return { valid: false, reason: `ZIP local file header is missing for ${name}.` };
      }
      const method = buffer.readUInt16LE(localOffset + 8);
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataOffset + compressedSize;
      if (dataEnd > buffer.length)
        return { valid: false, reason: `ZIP data is truncated for ${name}.` };
      const compressed = buffer.subarray(dataOffset, dataEnd);
      let content;
      if (method === 0) content = Buffer.from(compressed);
      else if (method === 8) content = inflateRawSync(compressed);
      else return { valid: false, reason: `ZIP uses unsupported compression method ${method}.` };
      if (content.length !== uncompressedSize || crc32(content) !== expectedCrc) {
        return { valid: false, reason: `ZIP content integrity check failed for ${name}.` };
      }
      files.push({ name, compressedSize, uncompressedSize, content });
    }
  } catch (error) {
    return { valid: false, reason: `ZIP decompression failed: ${error.message}` };
  }
  if (!files.length) return { valid: false, reason: 'ZIP contains no files.' };
  if (!files.some((entry) => entry.uncompressedSize > 0)) {
    return { valid: false, reason: 'ZIP contains no non-empty files.' };
  }
  return { valid: true, entries: files, fileCount: files.length };
}

export function assessWebsiteQuality(files = []) {
  const html = files.find((entry) => /\.html?$/i.test(entry.name));
  const css = files.find((entry) => /\.css$/i.test(entry.name));
  const js = files.find((entry) => /\.js$/i.test(entry.name));
  const readme = files.find((entry) => /(^|\/)readme\.md$/i.test(entry.name));
  const htmlText = html?.content?.toString('utf8').toLowerCase() || '';
  const cssText = css?.content?.toString('utf8').toLowerCase() || '';
  const jsText = js?.content?.toString('utf8').toLowerCase() || '';
  const checks = {
    htmlDocument: Boolean(
      html &&
      /<!doctype html/.test(htmlText) &&
      /<title\b/.test(htmlText) &&
      /name=["']viewport["']/.test(htmlText) &&
      /<main\b/.test(htmlText)
    ),
    responsiveCss: Boolean(css && /@media\b/.test(cssText)),
    keyboardFocusStyles: Boolean(css && /:focus(?:-visible)?\b/.test(cssText)),
    interactiveJavaScript: Boolean(js && /addeventlistener\s*\(/i.test(jsText)),
    errorHandling: Boolean(js && /\btry\b/.test(jsText) && /\bcatch\b/.test(jsText)),
    readme: Boolean(readme && readme.uncompressedSize > 100),
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}
