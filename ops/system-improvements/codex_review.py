"""Manual Codex report handoff. Dry-run by default; automatic reporting never imports this."""
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


def command(root, model, output):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}', model):
        raise ValueError('Choose a valid Codex model explicitly')
    if output.resolve().is_relative_to(root.resolve()):
        raise ValueError('Write the report outside the repository')
    return ['codex', 'exec', '--ignore-user-config', '--ephemeral', '--sandbox', 'read-only',
            '--model', model, '-c', 'model_reasoning_effort="low"',
            '--output-schema', str(root / 'ops/system-improvements/codex-output.schema.json'),
            '--output-last-message', str(output / 'codex-review.json'), '-']


def prompt(root, sha):
    evidence = collect(root, sha, offline=True)
    parts = [(root / 'ops/system-improvements/codex-prompt.md').read_text(encoding='utf-8'),
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
    parser.add_argument('--run', action='store_true', help='Explicitly consume Codex allowance for this one review')
    parser.add_argument('--model', help='Choose a compatible model for the manual run; no paid model is selected silently')
    parser.add_argument('--output', default='/tmp/atlas-codex-review')
    args = parser.parse_args()
    if args.run and not args.model:
        parser.error('--run requires an explicit --model')
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    text = prompt(ROOT, sha)
    if not args.run:
        print(text)
        print('\nDRY RUN ONLY: no Codex process or model call was started. Use --run --model <chosen-model> to request a review.')
        return
    output = Path(args.output)
    cmd = command(ROOT, args.model, output)
    if not shutil.which('codex'):
        parser.error('Codex CLI must be installed and signed in first')
    output.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run(cmd, cwd=ROOT, input=text, text=True, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=TIMEOUT_SECONDS, check=False)
    except subprocess.TimeoutExpired:
        parser.exit(1, 'Codex review timed out; no retry was made. Model usage may already have occurred.\n')
    if result.returncode:
        parser.exit(1, 'Codex review failed; no retry was made. Check your local Codex sign-in/model configuration.\n')
    print('Manual Codex review saved to ' + str(output / 'codex-review.json'))


if __name__ == '__main__':
    main()
