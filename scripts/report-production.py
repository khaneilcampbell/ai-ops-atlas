#!/usr/bin/env python3
"""Send compact production evidence using only Python's standard library."""
import argparse
import json
import os
import uuid
import urllib.request
from urllib.parse import urlparse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=['heartbeat', 'run'])
    parser.add_argument('--run-id')
    parser.add_argument('--status', choices=['running', 'success', 'failure'])
    parser.add_argument('--event-id', default=None, help='Reuse this id when retrying a delivery')
    parser.add_argument('--duration-ms', type=float)
    parser.add_argument('--cost-usd', type=float)
    args = parser.parse_args()
    endpoint = os.environ['ATLAS_PRODUCTION_URL']
    if urlparse(endpoint).scheme != 'https':
        parser.error('ATLAS_PRODUCTION_URL must use HTTPS')
    if args.kind == 'run' and (not args.run_id or not args.status):
        parser.error('run requires --run-id and --status')
    payload = dict(agentId=os.environ['ATLAS_AGENT_ID'], eventId=args.event_id or str(uuid.uuid4()), kind=args.kind)
    if args.kind == 'run':
        payload.update(runId=args.run_id, status=args.status)
        if args.duration_ms is not None:
            payload['durationMs'] = args.duration_ms
        if args.cost_usd is not None:
            payload['costUsd'] = args.cost_usd
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *unused):
            return None
    request = urllib.request.Request(endpoint, data=json.dumps(payload).encode(), method='POST', headers={
        'Authorization': 'Bearer ' + os.environ['ATLAS_AGENT_TOKEN'], 'Content-Type': 'application/json'})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
        print(response.status)


if __name__ == '__main__':
    main()
