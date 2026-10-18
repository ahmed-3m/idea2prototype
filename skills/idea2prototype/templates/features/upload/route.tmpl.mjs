// Idea2Prototype feature: upload — multipart/form-data file uploads with a
// zero-dependency parser. Files land in uploads/, served back by id.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const UPLOAD_DIR = join(process.cwd(), 'uploads');
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const MIME = {
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

// Parse a multipart/form-data buffer into parts. Minimal per RFC 7578: each
// part is headers + blank line + body, delimited by --boundary lines.
function parseMultipart(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(delimiter);
  while (start !== -1) {
    const next = buffer.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    let part = buffer.subarray(start + delimiter.length, next);
    if (part.slice(0, 2).toString('utf8') === '\r\n') part = part.subarray(2);
    if (part.slice(-2).toString('utf8') === '\r\n') part = part.subarray(0, -2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = part.subarray(0, headerEnd).toString('utf8');
      const data = part.subarray(headerEnd + 4);
      const name = /name="([^"]*)"/.exec(headerText)?.[1] ?? '';
      const filename = /filename="([^"]*)"/.exec(headerText)?.[1] ?? '';
      const contentType = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() ?? '';
      parts.push({ name, filename, contentType, data });
    }
    start = next;
  }
  return parts;
}

function safeName(filename) {
  const base = filename.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-64);
  return `${randomUUID().slice(0, 8)}-${cleaned || 'file'}`;
}

export default [
  {
    path: '/api/uploads',
    methods: {
      POST: async ({ req, rawBody }) => {
        const contentType = req.headers['content-type'] ?? '';
        const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
        const boundary = (match?.[1] ?? match?.[2] ?? '').trim();
        if (!boundary) return [400, { error: 'multipart/form-data with boundary required' }];
        const parts = parseMultipart(rawBody ?? Buffer.alloc(0), boundary.trim());
        const file = parts.find((p) => p.filename);
        if (!file) return [400, { error: 'no file part in form data' }];
        if (file.data.length > MAX_FILE_BYTES) return [413, { error: 'file exceeds 5MB limit' }];
        const stored = safeName(file.filename);
        await mkdir(UPLOAD_DIR, { recursive: true });
        await writeFile(join(UPLOAD_DIR, stored), file.data);
        return [201, { url: `/api/uploads/${stored}`, filename: file.filename, size: file.data.length }];
      },
    },
  },
  {
    path: '/api/uploads/:name',
    methods: {
      GET: async ({ params }) => {
        const full = join(UPLOAD_DIR, params.name);
        if (!full.startsWith(UPLOAD_DIR)) return [400, { error: 'bad path' }];
        try {
          const fileStat = await stat(full);
          if (!fileStat.isFile()) return [404, { error: 'not found' }];
        } catch {
          return [404, { error: 'not found' }];
        }
        const data = await readFile(full);
        return [200, data, { 'content-type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream' }];
      },
    },
  },
];
