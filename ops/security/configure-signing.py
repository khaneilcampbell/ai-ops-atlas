"""Configure Atlas's explicitly chosen solo signing environment; never print keys.
Run with --apply to change GitHub. Leaves repository secrets in place.
"""
import argparse
import base64
import json
import subprocess
import tempfile
from pathlib import Path
from audit import environment_safe

ROOT = Path(__file__).resolve().parents[2]
REPO = 'khaneilcampbell/ai-ops-atlas'
BASE = f'repos/{REPO}/environments/macos-signing'


def run(command, data=None):
    result = subprocess.run(command, input=data, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError('Command failed; output withheld to protect signing material: ' + command[0])
    return result.stdout


def api(method, endpoint, payload=None):
    command = ['gh', 'api', '--hostname', 'github.com', '--method', method, endpoint]
    data = None
    if payload is not None:
        command += ['--input', '-']
        data = json.dumps(payload).encode()
    return json.loads(run(command, data))


def configure(apply=False):
    home = Path.home()
    key = home / '.tauri/ai-ops-atlas-updater.key'
    public = home / '.tauri/ai-ops-atlas-updater.key.pub'
    cert = home / '.tauri/atlas-signing/atlas-signing.p12'
    password = home / '.tauri/atlas-signing/atlas-signing.password'
    for path in (key, public, cert, password):
        if not path.is_file() or not path.stat().st_size:
            raise RuntimeError('A required signing file is missing or empty')
    config = json.loads((ROOT / 'src-tauri/tauri.conf.json').read_text())
    if public.read_text().strip() != config['plugins']['updater']['pubkey'].strip():
        raise RuntimeError('Local updater public key does not match application configuration')
    with tempfile.TemporaryDirectory(prefix='atlas-signing-check-') as directory:
        sample = Path(directory) / 'sample.txt'
        sample.write_text('Atlas signing configuration verification\n')
        run([str(ROOT / 'node_modules/.bin/tauri'), 'signer', 'sign',
             '--private-key-path', str(key), '--password', '', str(sample)])
    run(['openssl', 'pkcs12', '-in', str(cert), '-passin', f'file:{password}', '-noout'])
    print('Local updater key signs successfully with an empty password; public key matches app configuration.')
    print('Existing certificate password unlocks the local certificate.')
    if not apply:
        print('Validation only; pass --apply to configure GitHub.')
        return
    api('PUT', BASE, {'wait_timer': 0, 'reviewers': [], 'prevent_self_review': False,
                     'can_admins_bypass': False, 'deployment_branch_policy': {
                         'protected_branches': False, 'custom_branch_policies': True}})
    policies = api('GET', BASE + '/deployment-branch-policies')
    rules = policies.get('branch_policies', [])
    if not rules:
        api('POST', BASE + '/deployment-branch-policies', {'name': 'main', 'type': 'branch'})
    environment = api('GET', BASE)
    policies = api('GET', BASE + '/deployment-branch-policies')
    if not environment_safe(environment, policies, 'solo'):
        raise RuntimeError('Environment policy differs from main-only solo policy; no keys uploaded')
    secrets = {
        'TAURI_SIGNING_PRIVATE_KEY': key.read_bytes(),
        'MACOS_SIGNING_CERT': base64.b64encode(cert.read_bytes()),
        'MACOS_SIGNING_CERT_PASSWORD': password.read_bytes().strip(),
    }
    for name, value in secrets.items():
        run(['gh', 'secret', 'set', name, '--repo', REPO, '--env', 'macos-signing'], value)
        print('Uploaded ' + name + ' (value withheld)')
    names = {item['name'] for item in api('GET', BASE + '/secrets').get('secrets', [])}
    if not set(secrets).issubset(names):
        raise RuntimeError('Secret metadata verification failed')
    if 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD' in names:
        raise RuntimeError('Unexpected updater password secret requires review; local key uses no password')
    print('Verified: main branch only, no required reviewers, administrator bypass disabled, three signing secrets present.')
    print('Repository-scoped secrets unchanged. No build or release was triggered.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        configure(args.apply)
    except (RuntimeError, OSError, subprocess.TimeoutExpired, ValueError, KeyError) as error:
        parser.exit(1, f'Stopped: {error}\n')
