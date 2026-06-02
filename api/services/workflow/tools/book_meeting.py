"""Built-in book_meeting tool.

Always injected into every voice-agent pipeline so agents can schedule a
calendar meeting on the caller's behalf without any per-workflow configuration.
The meeting is created in the organization's calendar (same data that the
Calendar UI page reads) and linked back to the current workflow run.
"""

from typing import Any, Dict, List


# ---------------------------------------------------------------------------
# LLM function schema (OpenAI-compatible)
# ---------------------------------------------------------------------------

def get_book_meeting_tools() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "book_meeting",
                "description": (
                    "Book a calendar meeting on behalf of the caller. "
                    "Use this when the caller wants to schedule a call-back, "
                    "demo, consultation, or any other appointment. "
                    "Always confirm the date, time, and purpose with the caller "
                    "before calling this function."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Short title describing the meeting purpose, e.g. 'Demo call' or 'Follow-up consultation'.",
                        },
                        "attendee_name": {
                            "type": "string",
                            "description": "Full name of the caller / person being booked.",
                        },
                        "date": {
                            "type": "string",
                            "description": "Meeting date in YYYY-MM-DD format.",
                        },
                        "time": {
                            "type": "string",
                            "description": "Meeting start time in HH:MM (24-hour) format.",
                        },
                        "duration_minutes": {
                            "type": "integer",
                            "description": "Duration of the meeting in minutes. Default is 30.",
                        },
                        "notes": {
                            "type": "string",
                            "description": "Any additional context or notes about the meeting.",
                        },
                    },
                    "required": ["title", "attendee_name", "date", "time"],
                },
            },
        }
    ]
