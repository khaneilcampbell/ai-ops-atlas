"""Zips the Flow kit exactly as buyers download it.

The zip holds one folder, benjaire-flow-v<version>/, with the top-level guides
first and the numbered folders after, every entry dated to the release day so
the same source always gives the same bytes. The version comes from the first
"## x.y.z" heading in kit/CHANGELOG.md.
Usage: python3 -I pack.py <release date YYYY-MM-DD> [out dir]
"""
import hashlib
import re
import sys
import zipfile
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent / 'kit'
FIRST = ['00-START-HERE.pdf', 'README.md', 'CHANGELOG.md', 'LICENSE.txt']

date = tuple(int(p) for p in sys.argv[1].split('-')) + (0, 0, 0)
out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else KIT.parent / 'dist'
version = re.search(r'^## (\d+\.\d+\.\d+)', (KIT / 'CHANGELOG.md').read_text(), re.M).group(1)
root = f'benjaire-flow-v{version}'

rest = sorted(p.relative_to(KIT).as_posix() for p in KIT.rglob('*') if p.is_file())
names = FIRST + [n for n in rest if n not in FIRST]

out_dir.mkdir(parents=True, exist_ok=True)
out = out_dir / f'{root}.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name in names:
        path = KIT / name
        info = zipfile.ZipInfo(f'{root}/{name}', date)
        info.create_system = 3
        info.external_attr = (0o755 if path.stat().st_mode & 0o111 else 0o644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, path.read_bytes(), compresslevel=9)

print(out)
print('sha256', hashlib.sha256(out.read_bytes()).hexdigest())
