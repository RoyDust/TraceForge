import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

test("writing Agent does not retry an endSpan whose response was lost", async () => {
  const endings: string[] = [];
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body = text ? JSON.parse(text) : {};
    if (request.url?.endsWith("/end")) {
      endings.push(body.status);
      // The server has applied the write but the caller never receives a response.
      response.destroy();
      return;
    }
    response.setHeader("content-type", "application/json");
    if (request.method === "GET") response.end(JSON.stringify({ spans: [] }));
    else if (request.url === "/v1/chat/completions") response.end(JSON.stringify({ choices: [{ message: { content: "topic" } }] }));
    else response.end(JSON.stringify({ id: body.id }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const child = spawn(process.execPath, ["examples/writing-agent.mjs", "http://127.0.0.1:" + address.port + "/source"], {
    env: { ...process.env, TRACEFORGE_CHAT_GATEWAY_URL: "http://127.0.0.1:" + address.port, TRACEFORGE_CHAT_API_KEY: "isolated-example-test", TRACEFORGE_AGENT_API_KEY: "isolated-example-test", TRACEFORGE_CHAT_MODEL: "mock" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let error = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { error += chunk; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
  try {
    const [code, signal] = await once(child, "close");
    assert.equal(signal, null);
    assert.notEqual(code, 0);
    assert.match(output, /Agent Run: [a-f0-9-]+/);
    assert.match(error, /fetch failed/);
    assert.deepEqual(endings, ["success"]);
  } finally {
    clearTimeout(timeout);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
