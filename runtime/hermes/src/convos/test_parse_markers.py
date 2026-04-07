"""Unit tests for parse_response() — marker parity with OpenClaw parseMarkers().

Run: python -m pytest runtime/hermes/src/convos/test_parse_markers.py -v
  or: python -m unittest runtime/hermes/src/convos/test_parse_markers.py -v
"""

import unittest
from convos_adapter import parse_response


class TestParseResponse(unittest.TestCase):
    # ---- REACT ----

    def test_react_add(self):
        r = parse_response("REACT:msg123:👍\nHello")
        self.assertEqual(len(r.reactions), 1)
        self.assertEqual(r.reactions[0].message_id, "msg123")
        self.assertEqual(r.reactions[0].value, "👍")
        self.assertEqual(r.reactions[0].action, "add")
        self.assertEqual(r.text, "Hello")

    def test_react_remove(self):
        r = parse_response("REACT:msg123:👍:remove")
        self.assertEqual(r.reactions[0].action, "remove")
        self.assertEqual(r.text, "")

    def test_multiple_reacts(self):
        r = parse_response("REACT:a:👍\nREACT:b:❤️\nDone")
        self.assertEqual(len(r.reactions), 2)
        self.assertEqual(r.text, "Done")

    # ---- REPLY ----

    def test_reply(self):
        r = parse_response("REPLY:msg456\nHere is my reply")
        self.assertEqual(r.reply_to, "msg456")
        self.assertEqual(r.text, "Here is my reply")

    def test_last_reply_wins(self):
        r = parse_response("REPLY:first\nREPLY:second\nText")
        self.assertEqual(r.reply_to, "second")

    # ---- PROFILE ----

    def test_profile_name(self):
        r = parse_response("PROFILE:QA Bot Alpha\nHello")
        self.assertEqual(r.profile_name, "QA Bot Alpha")
        self.assertEqual(r.text, "Hello")

    def test_profile_not_confused_with_image(self):
        r = parse_response("PROFILEIMAGE:https://example.com/img.png")
        self.assertIsNone(r.profile_name)
        self.assertEqual(r.profile_image, "https://example.com/img.png")

    # ---- PROFILEIMAGE ----

    def test_profile_image(self):
        r = parse_response("PROFILEIMAGE:https://example.com/avatar.png\nHi")
        self.assertEqual(r.profile_image, "https://example.com/avatar.png")
        self.assertEqual(r.text, "Hi")

    # ---- METADATA ----

    def test_metadata(self):
        r = parse_response("METADATA:credits=100\nOk")
        self.assertEqual(r.profile_metadata, {"credits": "100"})
        self.assertEqual(r.text, "Ok")

    def test_multiple_metadata(self):
        r = parse_response("METADATA:a=1\nMETADATA:b=2\nDone")
        self.assertEqual(r.profile_metadata, {"a": "1", "b": "2"})
        self.assertEqual(r.text, "Done")

    def test_metadata_value_with_equals(self):
        r = parse_response("METADATA:url=https://x.com?a=1")
        self.assertEqual(r.profile_metadata, {"url": "https://x.com?a=1"})

    # ---- MEDIA ----

    def test_media_standalone(self):
        r = parse_response("MEDIA:/tmp/image.png\nHere you go")
        self.assertEqual(r.media, ["/tmp/image.png"])
        self.assertEqual(r.text, "Here you go")

    def test_media_inline(self):
        r = parse_response("Check this out MEDIA:/tmp/file.pdf please")
        self.assertEqual(r.media, ["/tmp/file.pdf"])
        self.assertIn("Check this out", r.text)

    def test_multiple_media(self):
        r = parse_response("MEDIA:/a.png\nMEDIA:/b.png\nFiles attached")
        self.assertEqual(len(r.media), 2)
        self.assertEqual(r.text, "Files attached")

    # ---- Combined ----

    def test_all_markers(self):
        raw = "\n".join([
            "REACT:msg1:👀",
            "REPLY:msg2",
            "PROFILE:Test Bot 🤖",
            "METADATA:status=active",
            "MEDIA:/tmp/report.pdf",
            "Here is your report!",
        ])
        r = parse_response(raw)
        self.assertEqual(len(r.reactions), 1)
        self.assertEqual(r.reply_to, "msg2")
        self.assertEqual(r.profile_name, "Test Bot 🤖")
        self.assertEqual(r.profile_metadata, {"status": "active"})
        self.assertEqual(r.media, ["/tmp/report.pdf"])
        self.assertEqual(r.text, "Here is your report!")

    def test_plain_text(self):
        r = parse_response("Just a normal message\nWith two lines")
        self.assertEqual(r.text, "Just a normal message\nWith two lines")
        self.assertEqual(r.reactions, [])
        self.assertEqual(r.media, [])
        self.assertIsNone(r.reply_to)
        self.assertIsNone(r.profile_name)
        self.assertIsNone(r.profile_image)
        self.assertEqual(r.profile_metadata, {})

    def test_only_markers(self):
        r = parse_response("REACT:m:👍\nPROFILE:Bot")
        self.assertEqual(r.text, "")


if __name__ == "__main__":
    unittest.main()
