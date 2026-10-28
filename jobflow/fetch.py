"""Turn a job posting URL (or a saved file) into plain text."""

import html
import json
import re
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse

USER_AGENT = "Mozilla/5.0 (job-application-workflow; +https://github.com/khaneilcampbell/job-applications-workflow)"
GREENHOUSE = re.compile(r"(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io/(?P<board>[\w-]+)/jobs/(?P<id>\d+)")


class _Text(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "head"}
    BLOCK = {"p", "div", "li", "br", "h1", "h2", "h3", "h4", "tr", "section", "ul", "ol"}

    def __init__(self):
        super().__init__()
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag in self.BLOCK:
            self.out.append("\n")
        if tag == "li":
            self.out.append("- ")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        elif tag in self.BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def html_to_text(markup):
    parser = _Text()
    parser.feed(markup)
    text = "".join(parser.out)
    text = re.sub(r"[ \t\xa0]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode(r.headers.get_content_charset() or "utf-8", "replace")


def greenhouse_api_url(url):
    """Greenhouse boards (used by Anthropic, Sony Music and many others) have a public
    JSON API that returns the full posting, which is cleaner than scraping the page."""
    m = GREENHOUSE.search(url)
    if m:
        return f"https://boards-api.greenhouse.io/v1/boards/{m['board']}/jobs/{m['id']}?pay_transparency=true"
    return None


def fetch(source):
    """Return (text, url) for a URL or a local .txt/.md/.html file."""
    path = Path(source)
    if path.exists():
        raw = path.read_text()
        return (html_to_text(raw) if path.suffix in (".html", ".htm") else raw.strip()), None

    api = greenhouse_api_url(source)
    if api:
        job = json.loads(_get(api))
        parts = [job.get("title", ""), (job.get("location") or {}).get("name", ""),
                 html_to_text(html.unescape(job.get("content", "")))]
        for pay in job.get("pay_input_ranges") or []:
            parts.append(f"Pay range: {pay.get('min_cents', 0) // 100} - {pay.get('max_cents', 0) // 100} {pay.get('currency_type', '')}")
        return "\n\n".join(p for p in parts if p), source

    page = _get(source)
    gh_jid = parse_qs(urlparse(source).query).get("gh_jid")
    if gh_jid:
        page += f"\n(Greenhouse job id {gh_jid[0]})"
    return html_to_text(page), source
