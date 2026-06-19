import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultRuleDocument,
  createRuleBlock,
  exportRuleMarkdown,
  getCollapsedRuleBlockIds,
  getRuleAnnotationSegments,
  normalizeRuleDocument,
  normalizeRuleDocuments,
  parseMessageRuleContent,
  parseRuleDocumentJson,
  reanchorRuleAnnotations,
  searchRuleDocument,
  serializeMessageRuleContent,
  serializeRuleDocument,
  type RuleAnnotation,
} from "./rule-document.ts";

test("Rule JSON round-trip preserves the normalized document", () => {
  const document = createDefaultRuleDocument("Prepositions");
  const parsed = parseRuleDocumentJson(serializeRuleDocument(document));
  assert.deepEqual(parsed.document, document);
  assert.deepEqual(parsed.warnings, []);
});

test("message wrapper round-trip is recognized", () => {
  const document = createDefaultRuleDocument("Wrapped");
  assert.deepEqual(parseMessageRuleContent(serializeMessageRuleContent(document)), document);
  assert.equal(parseMessageRuleContent("plain text"), null);
});

test("continuous containers remain compatible when rules are absent or partial", () => {
  const document = createDefaultRuleDocument("Continuous");
  assert.deepEqual(normalizeRuleDocuments(undefined), []);
  assert.deepEqual(normalizeRuleDocuments([document, { format: "other" }]), [document]);
});

test("unsupported versions fail with a useful error", () => {
  assert.throws(
    () => parseRuleDocumentJson('{"format":"rule","version":"2.0"}'),
    /не поддерживается/
  );
});

test("damaged collection members are skipped with warnings", () => {
  const source = {
    ...createDefaultRuleDocument("Partial"),
    blocks: [{ kind: "unknown" }, createRuleBlock("text")],
    glossary: [{ term: "" }, { term: "surface", translation: "поверхность" }],
  };
  const parsed = normalizeRuleDocument(source);
  assert.equal(parsed.document.blocks.length, 1);
  assert.equal(parsed.document.glossary.length, 1);
  assert.equal(parsed.warnings.length, 2);
});

test("search includes hidden content, exercises, annotations, and glossary", () => {
  const document = createDefaultRuleDocument("Search");
  document.blocks = [
    { ...createRuleBlock("text"), text: "secret surface", hidden: true },
    { ...createRuleBlock("exercise", "gap"), prompt: "The book is ___ the surface." },
  ];
  document.annotations = [{
    id: "a1", blockId: document.blocks[0].id, start: 7, end: 14,
    targetText: "surface", translation: "поверхность", explanation: "top layer",
    example: "on the surface", resolved: true,
  }];
  document.glossary = [{
    id: "g1", term: "surface", translation: "поверхность", explanation: "",
    examples: [], tags: [], annotationIds: ["a1"],
  }];
  assert.equal(searchRuleDocument(document, "surface").length, 4);
});

test("annotations re-anchor to the nearest matching phrase", () => {
  const annotation: RuleAnnotation = {
    id: "a1", blockId: "b1", start: 6, end: 13, targetText: "surface",
    translation: "", explanation: "", example: "", resolved: true,
  };
  const [moved] = reanchorRuleAnnotations([annotation], "b1", "new text surface");
  assert.equal(moved.start, 9);
  assert.equal(moved.resolved, true);
  const [missing] = reanchorRuleAnnotations([annotation], "b1", "new text");
  assert.equal(missing.resolved, false);
});

test("annotation segments retain marked and plain text", () => {
  const annotation: RuleAnnotation = {
    id: "a1", blockId: "b1", start: 2, end: 5, targetText: "abc",
    translation: "", explanation: "", example: "", resolved: true,
  };
  assert.deepEqual(getRuleAnnotationSegments("--abc--", [annotation]), [
    { text: "--", annotationId: null },
    { text: "abc", annotationId: "a1" },
    { text: "--", annotationId: null },
  ]);
});

test("collapsed chapters hide descendants until an equal heading", () => {
  const first = { ...createRuleBlock("heading"), id: "h1", level: 1 as const };
  const text = { ...createRuleBlock("text"), id: "t1" };
  const subsection = { ...createRuleBlock("heading"), id: "h2", level: 2 as const };
  const second = { ...createRuleBlock("heading"), id: "h3", level: 1 as const };
  const hidden = getCollapsedRuleBlockIds([first, text, subsection, second], ["h1"]);
  assert.deepEqual([...hidden], ["t1", "h2"]);
});

test("Markdown includes exercises, glossary, and annotations", () => {
  const document = createDefaultRuleDocument("Markdown");
  document.blocks.push({
    ...createRuleBlock("exercise", "translation"), prompt: "Translate", answer: "Переведи",
  });
  document.glossary.push({
    id: "g1", term: "book", translation: "книга", explanation: "",
    examples: [], tags: [], annotationIds: [],
  });
  const markdown = exportRuleMarkdown(document);
  assert.match(markdown, /Rule Document: Markdown/);
  assert.match(markdown, /Упражнение: Перевод/);
  assert.match(markdown, /Glossary/);
});
