#!/usr/bin/env node
/**
 * 5 answerable + 1 unanswerable question.
 * NOTE: Topics: Git/GitHub, prompt engineering, architecture, agents, MCP, LangChain, RAG/vector DBs.
 */
import { NOT_FOUND, answerQuestion } from "./ask.js";

interface Case {
  question: string;
  doc?: string; // expected source document; undefined = unanswerable
  keyword?: string; // must appear in the answer (case-insensitive)
}

const FUND = "AI Software Engineering Fundamentals";
const ADV = "Advanced AI Engineering";
const CASES: Case[] = [
  { question: "What is the difference between Git and GitHub, and what is a pull request?", doc: FUND, keyword: "pull request" },
  { question: "What is prompt injection and how should retrieved documents be treated?", doc: FUND, keyword: "injection" },
  { question: "What layers does a layered software architecture have, and what do TaskService and TaskRepository do?", doc: FUND, keyword: "repository" },
  { question: "How do AI agents use tools, and what is MCP (Model Context Protocol)?", doc: ADV, keyword: "mcp" },
  { question: "How does LangChain support a RAG pipeline with a vector database like Pinecone?", doc: ADV, keyword: "vector" },
  { question: "Who won the 2018 FIFA World Cup?" }, // unanswerable
];

let failed = 0;
for (const c of CASES) {
  const { answer, sources } = await answerQuestion(c.question);
  let ok: boolean;
  if (c.doc) {
    ok =
      sources.some((s) => s.doc === c.doc) &&
      answer.toLowerCase().includes(c.keyword!.toLowerCase()) &&
      !answer.includes(NOT_FOUND);
  } else {
    ok = answer.includes(NOT_FOUND);
  }
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${c.question}`);
  console.log(`   Sources: ${sources.map((s) => `${s.doc} S.${s.page}`).join(", ") || "-"}`);
  console.log(`   Answer: ${answer.replace(/\s+/g, " ").slice(0, 200)}\n`);
}
console.log(failed ? `${failed} of ${CASES.length} tests failed` : "All tests passed");
process.exit(failed ? 1 : 0);
