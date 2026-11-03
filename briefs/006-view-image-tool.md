# Task 006: let the worker look at images (screenshots)

Goal: ultragent should be able to run GUI tests, for example on an Android emulator through `adb`, where the model must
see screenshots. Add a client-side custom tool that returns an image to the model.

## Requirements
1. In `src/worker.mjs`, add a custom tool `view_image` with input `{ "path": string, "note"?: string }`.
   - The guard applies as a `Read`: same `.env` rules, and the path is resolved relative to the repository like the editor tool.
   - Accept `.png`, `.jpg`/`.jpeg` and `.webp`. The file must be at most 5 MB; otherwise return an error result telling the
     model to downscale first, e.g. with `adb exec-out screencap -p` plus resizing on the device side, or by viewing a
     cropped copy.
   - Return a `tool_result` whose `content` is an array:
     `[{ type: "image", source: { type: "base64", media_type, data } }, { type: "text", text: "<path> (<width>x<height> if cheaply known, <size> KB)" }]`.
     This is the documented Messages API shape for images in tool results. Do not add dependencies.
   - Log it as `editor.view_image` / `view_image` in events.jsonl (path only, never the data).
2. Context safety: track the input tokens reported by usage. If a single request's `input_tokens + cache_read_input_tokens +
   cache_creation_input_tokens` goes over 700,000, stop with outcome `error_context_limit` and say so in the summary, so a
   long screenshot session cannot run away.
3. Add a short note to the system prompt: "Use view_image to look at screenshots or other images when you need to check
   layout or text visually. Prefer text (uiautomator dumps, logs) when it answers the question; images cost more."
4. README.md and README.zh-CN.md: document the `view_image` tool, the 5 MB limit, the cost note, and the context stop.
5. Tests (no network), in `test/`:
   - `view_image` returns the right content array for a tiny PNG fixture created in the test (write the bytes in the test);
   - an oversize file is rejected;
   - a `.env` path is blocked;
   - an unsupported extension is rejected.
   Also unit-test the context-limit check as a pure function.

Do not touch `.env`, `runs/` or `direct-test.mjs`. Finish with `npm test` and put the results in the report.
