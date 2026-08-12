import assert from "node:assert/strict";
import test from "node:test";

import { API_ERROR_CODES, localizeApiError } from "./api-errors.ts";
import {
  enMessages,
  formatCount,
  resolveLocalePreference,
  ruMessages,
  translate,
} from "./i18n.ts";

test("Russian and English dictionaries contain identical keys", () => {
  assert.deepEqual(Object.keys(enMessages).sort(), Object.keys(ruMessages).sort());
});

test("translation interpolates named values", () => {
  assert.equal(
    translate("en", "workspace.openCategory", { title: "Long project name" }),
    "Open category Long project name"
  );
  assert.equal(
    translate("ru", "pdf.pageNumber", { number: 12 }),
    "Страница 12"
  );
});

test("plural formatting follows the active locale", () => {
  const forms = {
    one: "элемент",
    few: "элемента",
    many: "элементов",
    other: "элемента",
  };

  assert.equal(formatCount("ru", 1, forms), "1 элемент");
  assert.equal(formatCount("ru", 2, forms), "2 элемента");
  assert.equal(formatCount("ru", 5, forms), "5 элементов");
  assert.equal(
    formatCount("en", 2, { one: "item", other: "items" }),
    "2 items"
  );
});

test("account locale wins over cookie and Russian remains the safe default", () => {
  assert.equal(
    resolveLocalePreference({ accountLocale: "en", cookieLocale: "ru" }),
    "en"
  );
  assert.equal(resolveLocalePreference({ cookieLocale: "en" }), "en");
  assert.equal(resolveLocalePreference({ cookieLocale: "unknown" }), "ru");
});

test("API error codes localize without exposing unknown server errors", () => {
  assert.equal(
    localizeApiError("en", { code: API_ERROR_CODES.INVALID_CREDENTIALS }),
    "The user-id or password is incorrect."
  );
  assert.equal(
    localizeApiError("ru", { code: "database_stack_trace", error: "secret" }),
    "Произошла непредвиденная ошибка. Попробуй ещё раз."
  );
});
