# Changelog

## 1.0.2 · sorting
- Intake prompt now says when an inquiry is low urgency (no timeline, or planning months ahead) instead of leaving Claude to guess between low and normal. Measured with the new eval suite.

## 1.0.1 · packaging
- Added 00-START-HERE.pdf, a three page guide with a setup checklist.
- Folders renamed 1 to 5 in setup order. Workflows and the Worker are unchanged.
- guides/tests.md moved to 5-test/test-checklist.md; examples moved into 4-website and 5-test.
- LICENSE.txt: clarified that installing Flow for another business needs its own license.

## 1.0.0 · first release
- Six workflows: intake, status updates, reply reminders, Monday digest, data retention and error alerts.
- Cloudflare Worker form endpoint, server forwarders, four business presets and seven guides.
