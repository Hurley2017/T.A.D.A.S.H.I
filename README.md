# T.A.D.A.S.H.I

T.A.D.A.S.H.I is a local-first desktop orchestrator for developers working with multiple AI agents. It gives a developer one calm control surface for describing work, approving risky actions, watching agent activity, and receiving project progress.

## Current slice

The first slice is text-first and runs locally:

- Select a project folder and keep it as the active workspace.
- Describe work in the conversation panel.
- Turn the request into a structured intent and task.
- Review the proposed task before execution.
- Run an approved task through a configured CLI agent.
- Stream agent output and monitor project file changes.
- Persist tasks, messages, approvals, and events in a local atomic state file.

Push-to-talk recording is wired in the desktop surface. To enable local transcription, install a compatible `whisper.cpp` executable and set `TADASHI_WHISPER_EXECUTABLE`; spoken status reports use the same event contracts and are the next integration layer.

## Development

Install Node.js 20 or newer, then run:

```bash
npm install
npm run dev
```

Checks:

```bash
npm run typecheck
npm test
npm run build
```

## Agent configuration

The default development agent is intentionally generic. Configure an executable through the app settings or environment-backed configuration. CLI commands are launched with an executable and argument array, never an unrestricted shell string.

The project brain is configured independently from worker agents. T.A.D.A.S.H.I. uses `llama.cpp` directly, not Ollama or LM Studio. For an RTX 5060, start with a Qwen3 8B Instruct GGUF in Q4_K_M quantization, an 8K context, and CUDA GPU layers. Set `TADASHI_BRAIN_BASE_URL`, `TADASHI_BRAIN_MODEL`, and `TADASHI_LLAMA_MODEL_PATH`. Run `npm run verify:llama` to check the local server. The brain returns a structured assessment, plan, clarification, or status response before any worker runs. Set `TADASHI_BRAIN_PROTOCOL=anthropic` for an Anthropic Messages endpoint. Without brain configuration, the app explicitly uses its safe fallback planner.

API credentials are read from `TADASHI_API_KEY` for this first local slice. Keep it outside source control and replace this provider with an OS credential store before distributing the packaged app.

## Approval model

T.A.D.A.S.H.I. defaults to human approval for writes, deletes, dependency installation, arbitrary commands, network access, mutating Git operations, cost-incurring API requests, and paths outside the selected project. Every approval should show the command, working directory, paths, and network or cost impact.

## Privacy

Project state and event history are local by default. Microphone audio is intended to be transcribed locally through a managed Whisper sidecar. Voice activation is push-to-talk in the initial release; always-on listening is not enabled.
