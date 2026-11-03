"""jobflow: the automated half of the AI-powered job application workflow.

Pipeline: fetch a posting -> analyze it against the career database (Claude) ->
human go/no-go -> tailor a resume (Claude) -> fact-check it (code + Claude) ->
render DOCX/PDF -> human approval -> update the tracker. Submitting stays manual.
"""

__version__ = "0.1.0"
