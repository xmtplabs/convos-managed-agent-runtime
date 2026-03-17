"""Unit tests for convos_adapter.parse_response — SILENT marker handling."""

import sys
from pathlib import Path

# Allow importing from hermes/src without installing
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.convos_adapter import parse_response


def test_silent_alone():
    result = parse_response("SILENT")
    assert result.silent is True
    assert result.text == ""


def test_silent_with_whitespace():
    result = parse_response("  SILENT  \n")
    assert result.silent is True
    assert result.text == ""


def test_silent_with_reaction():
    result = parse_response("REACT:abc123:👍\nSILENT")
    assert result.silent is True
    assert len(result.reactions) == 1
    assert result.reactions[0].message_id == "abc123"
    assert result.reactions[0].value == "👍"
    assert result.text == ""


def test_normal_text_not_silent():
    result = parse_response("Hello, how are you?")
    assert result.silent is False
    assert result.text == "Hello, how are you?"


def test_silent_in_normal_text_not_treated_as_marker():
    result = parse_response("The room went SILENT after that.")
    assert result.silent is False
    assert "SILENT" in result.text


if __name__ == "__main__":
    test_silent_alone()
    test_silent_with_whitespace()
    test_silent_with_reaction()
    test_normal_text_not_silent()
    test_silent_in_normal_text_not_treated_as_marker()
    print("All tests passed.")
