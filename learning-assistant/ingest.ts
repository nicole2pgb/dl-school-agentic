#!/usr/bin/env node
/**
 * Liest die zwei Bootcamp-PDFs, teilt sie in Chunks und schreibt Embeddings
 * ausschließlich in den Pinecone-Namespace "learning-assistant".
 *
 * Usage:
 *   npm run la:ingest              # bricht ab, wenn der Namespace nicht leer ist
 *   npm run la:ingest -- --update  # Upsert über vorhandene IDs im eigenen Namespace
 *   npm run la:ingest -- --dry-run # nur lesen + chunken, kein API-Zugriff
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFParse } from "pdf-parse";
import { ROOT } from "../example/shared/load-env.js";
import {
  INDEX_NAME,
  NAMESPACE,
  checkIndex,
  embed,
  getClients,
  requireKeys,
  type LearningChunk,
} from "./common.js";

const PDFS = [
  { file: "AI_Software_Engineering_Fundamentals.pdf", doc: "AI Software Engineering Fundamentals", prefix: "fundamentals" },
  { file: "Advanced_AI_Engineering.pdf", doc: "Advanced AI Engineering", prefix: "advanced" },
];
const CHUNK_SIZE = 800;
const OVERLAP = 100;

function normalize(text: string): string {
  return text
    .replace(/-\n(?=\p{Ll})/gu, "") // Silbentrennung am Zeilenende
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Teilt an Absatzgrenzen in ~CHUNK_SIZE-Stücke, mit Überlappung bei zu langen Absätzen. */
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const para of text.split(/\n\s*\n/)) {
    if (para.length > CHUNK_SIZE) {
      flush();
      for (let start = 0; start < para.length; start += CHUNK_SIZE - OVERLAP) {
        chunks.push(para.slice(start, start + CHUNK_SIZE).trim());
      }
    } else if (current.length + para.length + 2 > CHUNK_SIZE) {
      flush();
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  flush();
  return chunks;
}

export async function loadChunks(): Promise<LearningChunk[]> {
  const all: LearningChunk[] = [];
  for (const { file, doc, prefix } of PDFS) {
    const parser = new PDFParse({ data: readFileSync(join(ROOT, "data/learning", file)) });
    const result = await parser.getText();
    await parser.destroy();
    for (const page of result.pages) {
      chunkText(normalize(page.text)).forEach((text, i) => {
        all.push({
          id: `${prefix}-p${page.num}-c${i}`,
          doc,
          source_file: file,
          page: page.num,
          chunk_index: i,
          chunk_text: text,
        });
      });
    }
  }
  return all;
}

async function main(): Promise<void> {
  const chunks = await loadChunks();
  console.log(`${chunks.length} Chunks aus ${PDFS.length} PDFs`);
  for (const c of chunks) console.log(`  · ${c.id} (${c.chunk_text.length} Zeichen)`);
  if (chunks.length === 0) throw new Error("Keine Chunks erzeugt — PDF-Text leer?");
  if (process.argv.includes("--dry-run")) return;

  requireKeys();
  const { pc, openai } = getClients();

  // Prüfung VOR jedem Schreibzugriff
  const { host } = await checkIndex(pc, { allowExisting: process.argv.includes("--update") });

  const embeddings = await embed(openai, chunks.map((c) => c.chunk_text));
  const ns = pc.index(INDEX_NAME, host).namespace(NAMESPACE);
  const vectors = chunks.map((c, i) => ({
    id: c.id,
    values: embeddings[i],
    metadata: { ...c },
  }));

  console.log(`Upsert ${vectors.length} Vektoren → ${INDEX_NAME}/${NAMESPACE}`);
  await ns.upsert({ records: vectors });

  const fetched = await ns.fetch({ ids: chunks.map((c) => c.id) });
  const missing = chunks.filter((c) => !fetched.records?.[c.id]);
  if (missing.length) throw new Error(`Verifikation fehlgeschlagen: ${missing.map((c) => c.id).join(", ")}`);
  console.log(`✓ ${vectors.length} Vektoren im Namespace "${NAMESPACE}" verifiziert`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
