"""Manual Claude Code report handoff. Dry-run by default; automatic reporting never imports this."""
import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path

from report import collect

ROOT = Path(__file__).resolve().parents[2]
MAX_PROMPT_BYTES = 16 * 1024
TIMEOUT_SECONDS = 120


def command(root, model, output, schema='{}'):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}', model):
        raise ValueError('Choose a valid Claude model explicitly')
    if output.resolve().is_relative_to(root.resolve()):
        raise ValueError('Write the report outside the repository')
    # Claude Code in print mode with no tools and no MCP servers: it can only read the prompt on stdin.
    return ['claude', '-p', '--model', model, '--effort', 'low', '--tools', '',
            '--strict-mcp-config', '--no-session-persistence',
            '--output-format', 'json', '--json-schema', schema]


def prompt(root, sha):
    evidence = collect(root, sha, offline=True)
    parts = [(root / 'ops/system-improvements/claude-prompt.md').read_text(encoding='utf-8'),
             '\nBounded local evidence (GitHub status is not assessed here):\n' + json.dumps(evidence)]
    # Only three fixed Atlas UI modules, 60 lines each, within the total prompt limit.
    for name in ['src/views/office/OfficeScene.tsx', 'src/views/office/SkylineInterior.tsx', 'src/views/map3d/Map3D.tsx']:
        path = root / name
        if not path.is_file() or path.is_symlink():
            continue
        with path.open(encoding='utf-8', errors='replace') as source:
            lines = []
            for number, line in enumerate(source, 1):
                if number > 60:
                    break
                lines.append(f'{number}: {line[:240]}')
        excerpt = '\nExcerpt: ' + name + '\n' + ''.join(lines)
        if len(('\n'.join(parts) + excerpt).encode('utf-8')) <= MAX_PROMPT_BYTES:
            parts.append(excerpt)
    text = '\n'.join(parts)
    if len(text.encode('utf-8')) > MAX_PROMPT_BYTES:
        raise ValueError('Prompt exceeds the bounded context limit')
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true', help='Explicitly consume Claude Code allowance for this one review')
    parser.add_argument('--model', help='Choose a compatible model for the manual run; no paid model is selected silently')
    parser.add_argument('--output', default='/tmp/atlas-claude-review')
    args = parser.parse_args()
    if args.run and not args.model:
        parser.error('--run requires an explicit --model')
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    text = prompt(ROOT, sha)
    if not args.run:
        print(text)
        print('\nDRY RUN ONLY: no Claude Code process or model call was started. Use --run --model <chosen-model> to request a review.')
        return
    output = Path(args.output)
    schema = (ROOT / 'ops/system-improvements/claude-output.schema.json').read_text(encoding='utf-8')
    cmd = command(ROOT, args.model, output, schema)
    if not shutil.which('claude'):
        parser.error('Claude Code CLI must be installed and signed in first')
    output.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run(cmd, cwd=ROOT, input=text, text=True, capture_output=True,
                                timeout=TIMEOUT_SECONDS, check=False)
    except subprocess.TimeoutExpired:
        parser.exit(1, 'Claude Code review timed out; no retry was made. Model usage may already have occurred.\n')
    if result.returncode:
        parser.exit(1, 'Claude Code review failed; no retry was made. Check your local Claude Code sign-in/model configuration.\n')
    (output / 'claude-review.json').write_text(result.stdout, encoding='utf-8')
    print('Manual Claude Code review saved to ' + str(output / 'claude-review.json'))


if __name__ == '__main__':
    main()
