import { PLANETARY_SOURCE_DEFINITIONS } from "./planetaryCatalog";
import type { ArchiveAssetRecord, ArchiveRetention, ArchiveSummary } from "../types/planetary";

const DB_NAME = "canwxlab-archive-index";
const DB_VERSION = 1;
const STORE_NAME = "assets";
const FALLBACK_KEY = "canwxlab.archive.records.v1";

function hasIndexedDb(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function archiveKeyForUrl(url: string): string {
  let hash = 2166136261;
  for (let i = 0; i < url.length; i += 1) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `asset-${(hash >>> 0).toString(36)}`;
}

export function retentionForUrl(url: string): ArchiveRetention {
  const normalizedUrl = normalize(url);
  const source = PLANETARY_SOURCE_DEFINITIONS.find((candidate) => {
    const endpoint = candidate.access.endpoint;
    if (endpoint && url.startsWith(endpoint)) return true;
    return normalizedUrl.includes(normalize(candidate.id));
  });
  if (!source || source.legal.retentionAllowed === undefined) return "unknown";
  return source.legal.retentionAllowed ? "allowed" : "restricted";
}

export function shouldCacheUrl(url: string): boolean {
  return retentionForUrl(url) !== "restricted";
}

export function buildArchiveAssetRecord(input: {
  cacheName: string;
  url: string;
  response: Response;
  expiresAt: number;
}): ArchiveAssetRecord {
  const contentLength = input.response.headers.get("content-length");
  const parsedLength = contentLength === null ? null : Number(contentLength);
  return {
    assetKey: archiveKeyForUrl(input.url),
    url: input.url,
    cacheName: input.cacheName,
    contentType: input.response.headers.get("content-type"),
    byteLength: Number.isFinite(parsedLength) ? parsedLength : null,
    fetchedAt: new Date().toISOString(),
    expiresAt: input.expiresAt,
    retention: retentionForUrl(input.url),
  };
}

function summarize(records: ArchiveAssetRecord[]): ArchiveSummary {
  let approximateBytes = 0;
  let hasUnknownBytes = false;
  let allowedCount = 0;
  let restrictedCount = 0;
  let unknownCount = 0;
  let lastArchivedAt: string | null = null;

  for (const record of records) {
    if (record.byteLength === null) hasUnknownBytes = true;
    else approximateBytes += record.byteLength;
    if (record.retention === "allowed") allowedCount += 1;
    else if (record.retention === "restricted") restrictedCount += 1;
    else unknownCount += 1;
    if (!lastArchivedAt || record.fetchedAt > lastArchivedAt) {
      lastArchivedAt = record.fetchedAt;
    }
  }

  return {
    assetCount: records.length,
    approximateBytes: hasUnknownBytes && approximateBytes === 0 ? null : approximateBytes,
    allowedCount,
    restrictedCount,
    unknownCount,
    lastArchivedAt,
  };
}

export function summarizeArchiveRecords(records: ArchiveAssetRecord[]): ArchiveSummary {
  return summarize(records);
}

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "assetKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readFallbackRecords(): Promise<ArchiveAssetRecord[]> {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FALLBACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as ArchiveAssetRecord[] : [];
  } catch {
    return [];
  }
}

async function writeFallbackRecord(record: ArchiveAssetRecord): Promise<void> {
  if (typeof window === "undefined") return;
  const records = await readFallbackRecords();
  const next = [record, ...records.filter((item) => item.assetKey !== record.assetKey)].slice(0, 2000);
  try {
    window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota errors */
  }
}

export async function recordArchiveAsset(record: ArchiveAssetRecord): Promise<void> {
  if (!hasIndexedDb()) {
    await writeFallbackRecord(record);
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    await writeFallbackRecord(record);
  }
}

export async function getArchiveRecords(): Promise<ArchiveAssetRecord[]> {
  if (!hasIndexedDb()) return readFallbackRecords();
  try {
    const db = await openDb();
    const records = await new Promise<ArchiveAssetRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as ArchiveAssetRecord[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return records;
  } catch {
    return readFallbackRecords();
  }
}

export async function getArchiveSummary(): Promise<ArchiveSummary> {
  return summarize(await getArchiveRecords());
}

export const EMPTY_ARCHIVE_SUMMARY: ArchiveSummary = {
  assetCount: 0,
  approximateBytes: 0,
  allowedCount: 0,
  restrictedCount: 0,
  unknownCount: 0,
  lastArchivedAt: null,
};
