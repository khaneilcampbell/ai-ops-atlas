"""Builds the benjaire-flow-v1.0.1 folder from the v1.0 kit.

Moves files into numbered setup-order folders, updates path references in the
text files, and writes the new README header, CHANGELOG and LICENSE. Workflow
JSON files and worker.js are copied byte for byte.
Usage: python3 -I restructure.py <v1.0 dir> <out dir>
"""
import shutil
import sys
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
if out.exists():
    shutil.rmtree(out)

MOVES = {
    'tables/flow_settings.csv': '1-tables/flow_settings.csv',
    'tables/flow_inquiries.csv': '1-tables/flow_inquiries.csv',
    'tables/flow_events.csv': '1-tables/flow_events.csv',
    'presets/README.md': '2-presets/README.md',
    'presets/accounting-firm.csv': '2-presets/accounting-firm.csv',
    'presets/law-firm.csv': '2-presets/law-firm.csv',
    'presets/design-studio.csv': '2-presets/design-studio.csv',
    'presets/it-consultancy.csv': '2-presets/it-consultancy.csv',
    'workflows/0-error-alerts.json': '3-workflows/0-error-alerts.json',
    'workflows/1-intake.json': '3-workflows/1-intake.json',
    'workflows/2-status-updates.json': '3-workflows/2-status-updates.json',
    'workflows/3-reply-reminders.json': '3-workflows/3-reply-reminders.json',
    'workflows/4-monday-digest.json': '3-workflows/4-monday-digest.json',
    'workflows/5-data-retention.json': '3-workflows/5-data-retention.json',
    'website/worker.js': '4-website/worker.js',
    'examples/contact-form.html': '4-website/contact-form.html',
    'examples/server-forwarder.js': '4-website/server-forwarder.js',
    'examples/server-forwarder.php': '4-website/server-forwarder.php',
    'examples/curl-test.sh': '5-test/curl-test.sh',
    'guides/tests.md': '5-test/test-checklist.md',
    'guides/architecture.md': 'guides/architecture.md',
    'guides/cloudflare.md': 'guides/cloudflare.md',
    'guides/email.md': 'guides/email.md',
    'guides/forms.md': 'guides/forms.md',
    'guides/security.md': 'guides/security.md',
    'guides/troubleshooting.md': 'guides/troubleshooting.md',
}
# Text references to old paths, longest first so nothing is replaced twice.
PATHS = [
    ('examples/server-forwarder.js', '4-website/server-forwarder.js'),
    ('examples/server-forwarder.php', '4-website/server-forwarder.php'),
    ('examples/contact-form.html', '4-website/contact-form.html'),
    ('examples/curl-test.sh', '5-test/curl-test.sh'),
    ('website/worker.js', '4-website/worker.js'),
    ('guides/tests.md', '5-test/test-checklist.md'),
    ('tables/flow_settings.csv', '1-tables/flow_settings.csv'),
]
BYTE_FOR_BYTE = ('.json', '.js', '.php', '.sh', '.csv')

done = set()
for old, new in MOVES.items():
    s, d = src / old, out / new
    d.parent.mkdir(parents=True, exist_ok=True)
    if old.endswith(BYTE_FOR_BYTE):
        shutil.copy2(s, d)
    else:
        text = s.read_text()
        for a, b in PATHS:
            text = text.replace(a, b)
        d.write_text(text)
    done.add(old)

# The contact form's comment names the Worker's old path; update the comment only.
form = out / '4-website/contact-form.html'
form.write_text(form.read_text().replace('(website/worker.js)', '(4-website/worker.js)'))
tests = out / '5-test/test-checklist.md'
tests.write_text(tests.read_text().replace('or use 5-test/curl-test.sh', 'or use curl-test.sh in this folder'))

# README: new header and folder map; steps keep their wording with new paths.
readme = (src / 'README.md').read_text()
start = readme.index('## What is in this download')
end = readme.index('## What you need first')
folders = """## What is in this download

New here? Open **00-START-HERE.pdf** first. It is this guide as a three page checklist. The folders are numbered in the order you set Flow up.

    00-START-HERE.pdf                 the guide and checklist (start here)
    README.md                         this setup guide in plain text
    CHANGELOG.md                      what changed in each version
    LICENSE.txt
    1-tables/                         step 2: the three data table schemas
    2-presets/                        step 3: 4 ready settings rows for common businesses
    3-workflows/0-error-alerts.json   step 4: emails you if any Flow workflow fails
    3-workflows/1-intake.json         receives, checks, sorts, saves and answers inquiries
    3-workflows/2-status-updates.json the status buttons in your alert emails
    3-workflows/3-reply-reminders.json weekday reminders for unanswered inquiries
    3-workflows/4-monday-digest.json  weekly summary every Monday morning
    3-workflows/5-data-retention.json optional daily cleanup of old records
    4-website/worker.js               step 5: Cloudflare Worker form endpoint (bot protection, offline fallback)
    4-website/contact-form.html       a minimal contact form
    4-website/server-forwarder.js     forward from your own Node server instead of Cloudflare
    4-website/server-forwarder.php    the same for PHP sites
    5-test/curl-test.sh               step 6: send a test inquiry from a terminal
    5-test/test-checklist.md          the 17 checks before you go live
    guides/                           Cloudflare, email, forms, architecture, troubleshooting, security

"""
readme = readme[:start] + folders + readme[end:]
for a, b in [
    ('# Benjaire Flow v1.0: setup guide', '# Benjaire Flow v1.0.1: setup guide'),
    ('create each one from the matching CSV in the tables folder', 'create each one from the matching CSV in the 1-tables folder'),
    ('Start from the preset closest to your business in the presets folder', 'Start from the preset closest to your business in the 2-presets folder'),
    ('Import the six files in order, 0 to 5', 'Import the six files in 3-workflows in order, 0 to 5'),
    ('then work through the 17 scenarios in guides/tests.md', 'then work through the 17 scenarios in 5-test/test-checklist.md'),
]:
    assert a in readme, a
    readme = readme.replace(a, b)
for a, b in PATHS:
    readme = readme.replace(a, b)
old_help = readme[readme.index('## Help'):]
readme = readme.replace(old_help, """## Help

Problems are covered in guides/troubleshooting.md. For setup help, reply to your download email with the step number and what you see. Starter includes setup help by email for 14 days after purchase; Professional includes email support for 60 days and a 45 minute setup call. Bug fix updates to v1.x are included for 12 months; CHANGELOG.md lists what each update changed.
""")
(out / 'README.md').write_text(readme)

(out / 'CHANGELOG.md').write_text("""# Changelog

## 1.0.1 · packaging
- Added 00-START-HERE.pdf, a three page guide with a setup checklist.
- Folders renamed 1 to 5 in setup order. Workflows and the Worker are unchanged.
- guides/tests.md moved to 5-test/test-checklist.md; examples moved into 4-website and 5-test.
- LICENSE.txt: clarified that installing Flow for another business needs its own license.

## 1.0.0 · first release
- Six workflows: intake, status updates, reply reminders, Monday digest, data retention and error alerts.
- Cloudflare Worker form endpoint, server forwarders, four business presets and seven guides.
""")

(out / 'LICENSE.txt').write_text("""Benjaire Flow v1.0 license

You may install and use these workflows and files for one business, and you may modify them freely for that use.

Installing Flow for another business, for example as an agency, consultant or freelancer working for a client, needs a separate license for that business or an agency license. Contact contact@benjaire.com for agency terms.

You may not resell, redistribute, sublicense or publish the kit or substantial parts of it, alone or as part of another template, course or product.

The kit is provided as is, without warranty of any kind. You are responsible for your own accounts, API usage costs, data and compliance with the laws that apply to your business.
""")

missing = sorted(p.relative_to(src).as_posix() for p in src.rglob('*') if p.is_file() and p.relative_to(src).as_posix() not in done | {'README.md', 'LICENSE.txt'})
print('unmapped source files:', missing)
print('files written:', sum(1 for p in out.rglob('*') if p.is_file()))
