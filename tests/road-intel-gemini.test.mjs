import assert from "node:assert/strict";
import test from "node:test";
import { geminiCaller } from "../src/lib/delivery/road-intel/gemini.ts";

test("geminiCaller maps request and response", async () => {
  let seen;
  const caller = geminiCaller({
    apiKey: "k",
    model: "gemini-2.5-flash",
    fetch: async (url, init) => {
      seen = { url, init, body: JSON.parse(init.body) };
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                { text: "hm", thought: true },
                {
                  functionCall: { name: "observed_speed", args: { radius_meters: 200 } },
                  thoughtSignature: "sig",
                },
              ],
            },
          },
        ],
      });
    },
  });
  const res = await caller({
    system: "sys",
    messages: [
      { role: "user", content: "note" },
      { role: "assistant", content: [{ type: "tool_use", id: "a", name: "nearby_notes", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "[1]" }] },
    ],
    tools: [{ name: "observed_speed", description: "d", input_schema: { type: "object" } }],
    forceTool: "observed_speed",
  });
  assert.match(seen.url, /models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(seen.init.headers["x-goog-api-key"], "k");
  assert.equal(seen.body.toolConfig.functionCallingConfig.mode, "ANY");
  assert.equal(seen.body.contents[1].role, "model");
  assert.equal(seen.body.contents[2].parts[0].functionResponse.name, "nearby_notes");
  assert.deepEqual(seen.body.contents[2].parts[0].functionResponse.response, { output: [1] });
  assert.equal(res.blocks.length, 1);
  assert.equal(res.blocks[0].name, "observed_speed");
  assert.equal(res.blocks[0].thoughtSignature, "sig");
});
