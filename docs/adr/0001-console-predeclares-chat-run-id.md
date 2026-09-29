# Console Predeclares Chat Playground TraceRun IDs

The Chat Playground is a Console tool that must navigate to the exact TraceRun produced by its test request. Console will generate a UUID before calling Gateway, pass it as `X-TraceForge-Run-Id`, and Gateway will use that value as the TraceRun ID when it is a valid, unused UUID.

`X-TraceForge-Run-Id` is a formal Gateway data-plane capability, not a Console-private escape hatch: any caller with a valid project API key may use it for external trace correlation. Reusing an existing TraceRun ID is a conflict and must not overwrite or append to the old run. This rejects polling for the most recent TraceRun because concurrent test requests can make "latest run" ambiguous. The server-side Console proxy remains responsible for protecting the project API key; the browser only observes the predeclared run ID.

The Chat Playground navigates to the predeclared TraceRun immediately after sending. The TraceRun detail view is responsible for showing a loading state while the run is not yet available, then showing either the successful response content or the error details.

After Gateway authenticates and accepts a request, it creates the TraceRun immediately with `status=running`. When the upstream call completes, Gateway updates the same TraceRun to `success` or `failed` and fills in Span, preview, token, cost, latency, and error details. This makes `/traces/{id}` a live landing page for in-flight calls instead of a post-hoc report that only exists after completion.

Streaming requests use the same TraceRun lifecycle in the first version. Gateway does not write token deltas to the database; the TraceRun stays `running` while the stream is active, and Gateway fills the complete output once the stream ends.

The Chat Playground starts Gateway calls through a Console-side background dispatch. The browser submits the model, messages, and stream flag to Console; Console validates the request and environment, predeclares the run ID, launches the Gateway call server-side, and immediately sends the browser to `/traces/{run_id}?pending=1`. The trace detail page polls until the accepted Run appears, then continues polling while it is `running`.

The first Chat Playground version uses raw OpenAI-compatible JSON messages, active ModelConfig options, and a server-side `TRACEFORGE_CHAT_API_KEY`. It does not select PromptVersion, persist chat sessions, expose project API keys to the browser, write streaming token deltas, or store full raw JSON responses.
