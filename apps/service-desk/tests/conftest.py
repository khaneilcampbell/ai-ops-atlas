from datetime import date

import pytest

from service_desk_dashboard.generate import generate_tickets


@pytest.fixture(scope="session")
def synthetic():
    return generate_tickets(days=60, end=date(2026, 1, 31), seed=7)
