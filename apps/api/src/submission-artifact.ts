import { isUtf8 } from 'node:buffer';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

import JSZip from 'jszip';

export interface SubmissionArtifactFile {
  readonly path: string;
  readonly size: number;
  readonly compressedSize: number;
  readonly language: string;
  readonly isText: boolean;
  readonly content: string | null;
}

export interface SubmissionArtifactSummary {
  readonly archiveName: string;
  readonly archiveSize: number;
  readonly fileCount: number;
  readonly totalUncompressedSize: number;
  readonly files: SubmissionArtifactFile[];
}

const MAX_INLINE_TEXT_BYTES = 200_000;
const MAX_TOTAL_INLINE_TEXT_BYTES = 1_000_000;

interface ZipObjectWithCompressedSize {
  readonly _data?: {
    readonly compressedSize?: number;
  };
}

function inferLanguage(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case '.py':
      return 'python';
    case '.json':
      return 'json';
    case '.md':
      return 'markdown';
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'typescript';
    case '.js':
      return 'javascript';
    case '.jsx':
      return 'javascript';
    case '.yml':
    case '.yaml':
      return 'yaml';
    case '.toml':
      return 'ini';
    case '.sh':
      return 'shell';
    case '.sql':
      return 'sql';
    case '.txt':
      return 'plaintext';
    default:
      return 'plaintext';
  }
}

export async function readSubmissionArtifactSummary(
  artifactPath: string
): Promise<SubmissionArtifactSummary> {
  const [artifactBuffer, artifactStat] = await Promise.all([readFile(artifactPath), stat(artifactPath)]);
  const zip = await JSZip.loadAsync(artifactBuffer);
  const files: SubmissionArtifactFile[] = [];
  let totalInlineTextBytes = 0;
  let totalUncompressedSize = 0;

  for (const [entryPath, file] of Object.entries(zip.files).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (file.dir) {
      continue;
    }

    const contentBuffer = await file.async('nodebuffer');
    const size = contentBuffer.byteLength;
    const compressedSize = (file as ZipObjectWithCompressedSize)._data?.compressedSize ?? size;
    const text = isUtf8(contentBuffer);
    const inlineAllowed =
      text &&
      size <= MAX_INLINE_TEXT_BYTES &&
      totalInlineTextBytes + size <= MAX_TOTAL_INLINE_TEXT_BYTES;

    if (inlineAllowed) {
      totalInlineTextBytes += size;
    }

    totalUncompressedSize += size;
    files.push({
      path: entryPath,
      size,
      compressedSize,
      language: inferLanguage(entryPath),
      isText: text,
      content: inlineAllowed ? contentBuffer.toString('utf8') : null
    });
  }

  return {
    archiveName: path.basename(artifactPath),
    archiveSize: artifactStat.size,
    fileCount: files.length,
    totalUncompressedSize,
    files
  };
}
