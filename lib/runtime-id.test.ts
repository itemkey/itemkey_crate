import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeId } from "./runtime-id.ts";

test("createRuntimeId returns unique UUIDs when randomUUID is available", () => {
  const ids = Array.from({ length: 1_000 }, createRuntimeId);

  assert.equal(new Set(ids).size, ids.length);
  assert.match(ids[0] ?? "", /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
});

test("createRuntimeId works on insecure HTTP without crypto.randomUUID", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");

  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues(array: Uint8Array) {
          for (let index = 0; index < array.length; index += 1) {
            array[index] = index + 1;
          }
          return array;
        },
      },
    });

    assert.equal(createRuntimeId(), "01020304-0506-4708-890a-0b0c0d0e0f10");

    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: undefined,
    });

    assert.match(createRuntimeId(), /^[a-z0-9]+-[a-z0-9]+$/i);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "crypto", originalDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "crypto");
    }
  }
});
