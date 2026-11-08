"""Entry point for Streamlit Community Cloud, which runs streamlit_app.py from the repo root.

Locally you can use either this file or src/service_desk_dashboard/app.py.
"""

import sys
from pathlib import Path

# Community Cloud installs requirements.txt but not this package, so make src importable.
sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from service_desk_dashboard.app import main  # noqa: E402

main()
