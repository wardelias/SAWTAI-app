"""Built-in book_meeting tool.

Auto-seeded for every organization so it appears in the normal tools list
without any manual setup. The LLM function schema is also used at runtime
to register the execution handler in the agent pipeline.
"""

from typing import Any, Dict, List

# ---------------------------------------------------------------------------
# Default tool definition (stored in ToolModel.definition)
# ---------------------------------------------------------------------------

BOOK_MEETING_DEFINITION: Dict[str, Any] = {
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
}

# ---------------------------------------------------------------------------
# LLM function schema (OpenAI tool-call format, used at pipeline runtime)
# ---------------------------------------------------------------------------


def get_book_meeting_tools() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": BOOK_MEETING_DEFINITION["name"],
                "description": BOOK_MEETING_DEFINITION["description"],
                "parameters": BOOK_MEETING_DEFINITION["parameters"],
            },
        }
    ]
