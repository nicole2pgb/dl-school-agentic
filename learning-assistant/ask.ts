#!/usr/bin/env node
/**
 * AI Bootcamp Learning Assistant: deterministic RAG (retrieve → prompt → LLM)
 * over the namespace "learning-assistant". Cites sources (document + page).
 *
 * Usage: npm run la:ask -- "What is Git?"
 */
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { pathToFileURL } from "node:url";
import {
  INDEX_NAME,
  NAMESPACE,
  embed,
  getClients,
  requireKeys,
} from "./common.js";

const TOP_K = 4;
const MIN_SCORE = 0.3; // below this a match counts as irrelevant
export const NOT_FOUND = "I couldn't find this information in the documents.";

export interface Source {
  id: string;
  doc: string;
  page: number;
  score: number;
  text: string;
}

export async function answerQuestion(
  question: string,
): Promise<{ answer: string; sources: Source[] }> {
  requireKeys();
  const { pc, openai } = getClients();
  const host = (await pc.describeIndex(INDEX_NAME)).host;
  const ns = pc.index(INDEX_NAME, host).namespace(NAMESPACE);

  const [vector] = await embed(openai, [question]);
  const res = await ns.query({ vector, topK: TOP_K, includeMetadata: true });

  const sources: Source[] = (res.matches ?? [])
    .filter((m) => (m.score ?? 0) >= MIN_SCORE && typeof m.metadata?.chunk_text === "string")
    .map((m) => ({
      id: m.id,
      doc: String(m.metadata?.doc),
      page: Number(m.metadata?.page),
      score: m.score ?? 0,
      text: String(m.metadata?.chunk_text),
    }));

  if (!sources.length) return { answer: NOT_FOUND, sources };

  const context = sources
    .map((s, i) => `[${i + 1}] ${s.doc} · Page ${s.page}\n${s.text}`)
    .join("\n\n");

  const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
  const response = await llm.invoke([
    new SystemMessage(
      "You are the AI Bootcamp Learning Assistant. Answer ONLY from the context below, in English, concisely. " +
        "Do not use outside knowledge. End with the sources as (Document, page X). " +
        `If the context does not contain the answer, reply exactly: "${NOT_FOUND}"`,
    ),
    new HumanMessage(`Context:\n${context}\n\nQuestion: ${question}`),
  ]);
  const answer =
    typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  return { answer, sources };
}

async function main(): Promise<void> {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) throw new Error('Please provide a question: npm run la:ask -- "question"');
  const { answer, sources } = await answerQuestion(question);
  console.log(`Question: ${question}\n\n${answer}\n\nSources:`);
  for (const s of sources) console.log(`  [${s.score.toFixed(3)}] ${s.doc} · Page ${s.page} (${s.id})`);
  if (!sources.length) console.log("  (no relevant matches)");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
