# Security policy

## Supported versions

Security fixes are made on the latest release and the `main` branch. Please reproduce an issue on the newest version before reporting it when possible.

## Report a vulnerability privately

Please use [GitHub Private Vulnerability Reporting](https://github.com/ReadArc-ai/ReadArc/security/advisories/new). Do not open a public issue for a vulnerability until a fix is available.

Include the affected version, operating system, impact, reproduction steps, and a minimal proof of concept. Never attach real API keys, private papers, `~/.readarc/.env`, or a database containing personal reading data; replace them with synthetic samples.

We will acknowledge a valid report, investigate it, and coordinate disclosure with the reporter. Please allow a reasonable remediation window before publishing details.

## Security boundaries

ReadArc treats PDFs, search-result URLs, model responses, and remote API responses as untrusted input. Reports involving sandbox escape, unsafe external protocol handling, local-file disclosure, SSRF, secret leakage, or malicious document parsing are especially valuable.
