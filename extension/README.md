# Chronicle Capture

## Install locally

1. Run Chronicle at `http://127.0.0.1:4400`.
2. In Chrome, open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**. Select this `extension` directory.
3. In Chronicle, expand **Chrome extension & agent digests**. Click **Show pairing token**, then copy the selected token into the extension popup.
4. Check **Record new visits** and click **Save connection & recording**. Recording is off until enabled.

The extension requests history, storage, alarms, activeTab, scripting, and localhost access. It never deletes browser history. Incognito use is disabled. URLs, titles, and visit times are recorded; a visit is not proof of a video watch. Existing history is still imported by the CLI; this extension records new visits after activation.

## Capture and digest

On a web page, open the popup and click **Preview page capture**. Select a passage first to capture only that selection. Otherwise it extracts the loaded article/main text, falling back to body text. Scripts, forms, input fields, editable areas, and common navigation are excluded. Review and edit the text before saving; extraction is imperfect, limited to 40,000 characters, and may include page boilerplate. It does not fetch full articles, bypass access controls, transcribe audio, or watch videos.

- **Save capture locally** stores the text as a manual event and saved note.
- **Save + request agent digest** additionally sends the reviewed text through the local Codex CLI to its model provider. This uses your Codex login and account usage. No model API key is embedded in the extension.
- In Chronicle, use **Refresh captures** to view pending/running/completed digests or retry failures. Digests are separate from your editable notes and do not overwrite them.

Digests use an ephemeral Codex invocation with shell execution, plugins, apps, browser tools, and web search disabled, from an empty temporary directory. Output is shown as text, never executed. Page content is treated as untrusted. Generated summaries still need review.

## Offline and limits

The service worker stores a persistent queue and retries each minute or when you click Sync. Up to 3,000 messages are queued, with a visible error when full. A batch sends at most 100; failed delivery remains queued. Capture IDs and event hashes make retries idempotent. The app must run on port 4400 for this version. Install and pair separately for each Chrome profile. Events participate in Chronicle sync; capture text and digest records stay on the capturing device.

If pairing fails, check that Chronicle is running and recopy the token. A digest requires a current Codex CLI supporting the flags in `src/extension.ts`, authenticated with `codex login`. Requests time out after two minutes and show a retryable error. For token rotation, stop Chronicle, remove `~/.chronicle/extension-token`, restart, and pair again.
