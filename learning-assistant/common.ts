import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { loadEnv } from "../example/shared/load-env.js";

/** Der einzige Namespace, in den dieses Projekt schreibt/liest. */
export const NAMESPACE = "learning-assistant";
export const INDEX_NAME = process.env.WORKSHOP_PINECONE_INDEX ?? "handbook";
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIM = 1536;

export interface LearningChunk {
  id: string;
  doc: string;
  source_file: string;
  page: number;
  chunk_index: number;
  chunk_text: string;
}

export function requireKeys(): void {
  loadEnv();
  for (const key of ["PINECONE_API_KEY", "OPENAI_API_KEY"]) {
    if (!process.env[key]) {
      throw new Error(`Missing ${key} — bitte in .env eintragen (cp env.example .env)`);
    }
  }
}

export function getClients() {
  return {
    pc: new Pinecone({ apiKey: process.env.PINECONE_API_KEY! }),
    openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }),
  };
}

export async function embed(openai: OpenAI, input: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input });
  return res.data.sort((a, b) => a.index - b.index).map((r) => r.embedding);
}

/**
 * Read-only Prüfung des Index (kein Schreibzugriff).
 * Wirft, wenn der Index fehlt, die Dimension nicht passt oder der Namespace
 * schon Daten enthält und `allowExisting` nicht gesetzt ist.
 */
export async function checkIndex(
  pc: Pinecone,
  { allowExisting }: { allowExisting: boolean },
): Promise<{ host: string; existingCount: number }> {
  const names = (await pc.listIndexes()).indexes?.map((i) => i.name) ?? [];
  if (!names.includes(INDEX_NAME)) {
    throw new Error(`Index "${INDEX_NAME}" existiert nicht (vorhanden: ${names.join(", ") || "keine"}). Es wird nichts angelegt.`);
  }
  const desc = await pc.describeIndex(INDEX_NAME);
  if (desc.dimension !== EMBEDDING_DIM || desc.metric !== "cosine") {
    throw new Error(`Index "${INDEX_NAME}" hat ${desc.dimension}d/${desc.metric}, erwartet ${EMBEDDING_DIM}d/cosine.`);
  }
  const stats = await pc.index(INDEX_NAME, desc.host).describeIndexStats();
  const namespaces = stats.namespaces ?? {};
  const existingCount = namespaces[NAMESPACE]?.recordCount ?? 0;

  console.log(`Index "${INDEX_NAME}": ${desc.dimension}d, ${desc.metric}`);
  console.log(
    "Namespaces (nur Anzeige):",
    Object.entries(namespaces).map(([n, v]) => `${n || "(default)"}=${v.recordCount}`).join(", ") || "keine",
  );
  console.log(`Namespace "${NAMESPACE}": ${existingCount} Vektoren`);

  if (existingCount > 0 && !allowExisting) {
    throw new Error(`Namespace "${NAMESPACE}" ist nicht leer. Abbruch; mit --update bewusst per Upsert überschreiben.`);
  }
  return { host: desc.host, existingCount };
}
