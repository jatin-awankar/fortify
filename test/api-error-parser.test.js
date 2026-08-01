import assert from "node:assert/strict";
import test from "node:test";
import { parseApiErrorResponse } from "../src/utils/api-error-parser.js";

test("parseApiErrorResponse formats HTTP 429 rate limit errors cleanly", () => {
  const geminiErrorJson = JSON.stringify({
    error: {
      code: 429,
      message: "You exceeded your current quota, please check your plan and billing details.\nQuota exceeded for metric..."
    }
  });

  const formatted = parseApiErrorResponse(429, geminiErrorJson, "Google Gemini");
  assert.ok(formatted.includes("Google Gemini API quota/rate limit exceeded (429)"));
  assert.ok(formatted.includes("You exceeded your current quota"));
  assert.equal(formatted.includes("Quota exceeded for metric"), false);
});

test("parseApiErrorResponse formats HTTP 401 auth errors cleanly", () => {
  const formatted = parseApiErrorResponse(401, '{"error": "invalid_api_key"}', "Anthropic Claude");
  assert.ok(formatted.includes("Anthropic Claude API authentication failed (401)"));
});
