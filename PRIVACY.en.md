# ReadArc Privacy Policy

Updated: 2026-09-17

This policy covers source builds and the Mac App Store edition of ReadArc. ReadArc is a local-first paper reader with no ReadArc-operated accounts, cloud sync, advertising, telemetry or model-request relay. You choose the model provider. When you use cloud AI, the content needed for the task is sent to the endpoint you configure.

## Data stored on your device

Imported PDF copies, extracted text, images and thumbnails, reading progress, highlights, translations, summaries, conversations, model usage and settings are stored locally. Reading notes are Markdown files. API keys are stored in a local configuration directory's `.env` file with restricted file permissions; this is not an encrypted vault. The main configuration stores the keys' environment-variable names.

“Settings → Data” shows the actual storage locations. Source builds default to `~/Documents/ReadArc/Notes` for notes and `~/.readarc` for configuration. The Mac App Store edition uses its app sandbox container. Backup software, sync services or custom folders you configure may copy these files separately.

## Network requests and recipients

| Feature | Recipient | Data sent |
| --- | --- | --- |
| AI translation, outline translation, questions, summaries, generated notes and cross-paper analysis | The model provider or custom endpoint selected for that task | Required paper text, titles, context, questions, conversation history and explanation-style settings; image questions also include the selected screenshot |
| Double-click word lookup | The bundled offline dictionary | No network request |
| Translating selected text | The bundled dictionary for matching words; otherwise the selected model | The selected text when a model is called |
| Paper search | arXiv and Semantic Scholar; the selected model is also used when rewriting a Chinese query into English | Search terms or rewritten keywords |
| Importing search results | The paper's source website | A PDF download request |
| Listing models and detecting local models | Configured provider endpoints, or local Ollama / LM Studio addresses | Model-list requests, with an API key when the provider requires authentication |
| Testing a proxy | The configured proxy and Google's `www.gstatic.com/generate_204` | A connectivity request without paper content or a model API key |
| Opening project, support or provider links | Websites opened in your system browser | Normal browser requests |

Cloud model requests authenticate with your configured API key. Network recipients can generally also see the connection's source IP address and request time. Requests use a proxy if you configure one. You can inspect and change endpoints in “Settings → Connect”. A `localhost` address alone does not guarantee local processing: a local gateway may forward requests to cloud services.

PDF parsing and the bundled layout model run locally and do not require uploading an entire PDF to a ReadArc server. Source builds download the layout model from ModelScope as a build step; this does not upload your papers.

## Third parties and your choices

ReadArc does not sell user data or use advertising identifiers for tracking. We do not operate your selected model provider, paper websites or proxies, and cannot determine their retention periods, training use or processing locations. Review their privacy policies and account settings before use. Do not send personal, confidential or restricted material to services that are not authorized to receive it.

You can use offline reading, the bundled dictionary, highlights and notes, or connect a model that actually runs locally. Stop using cloud AI, change the endpoint or remove its configuration to prevent subsequent tasks being sent to that service. These actions cannot recall requests already sent.

## Retention and deletion

Local data generally remains until you clear it. “Settings → Data” lets you clear search caches, translations, summaries, conversations, images and usage records separately. Deleting a paper does not delete its Markdown notes.

“Reset all” removes the app database, imported PDF copies, image caches and interface settings, but **preserves model configuration, API keys and notes**. To remove everything, note these folders in Settings, quit the app and manually delete the retained files. Revoke keys with the provider when necessary. Uninstalling the app or clearing local data does not delete content received by providers or backups you created. Contact the relevant service for remote deletion requests.

## Contact and changes

Contact the maintainers through [ReadArc project support](https://github.com/ReadArc-ai/ReadArc/issues) for general privacy questions. Do not post personal material, API keys or databases in public issues. Report security vulnerabilities through [private security reporting](https://github.com/ReadArc-ai/ReadArc/security/advisories/new).

We update this policy and its date when data handling changes. The app includes an offline copy for its version; the public repository policy may be updated with newer releases.
