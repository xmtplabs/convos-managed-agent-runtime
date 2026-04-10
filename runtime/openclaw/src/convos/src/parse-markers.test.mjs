// Unit tests for parseMarkers() — mirrors Hermes parse_response() parity.
// Run: node --experimental-strip-types --test runtime/openclaw/src/convos/src/parse-markers.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMarkers } from "./parse-markers.ts";

describe("parseMarkers", () => {
  // ---- REACT ----

  it("parses REACT:messageId:emoji", () => {
    const result = parseMarkers("REACT:msg123:👍\nHello");
    assert.deepStrictEqual(result.reactions, [
      { messageId: "msg123", emoji: "👍", action: "add" },
    ]);
    assert.equal(result.text, "Hello");
  });

  it("parses REACT:messageId:emoji:remove", () => {
    const result = parseMarkers("REACT:msg123:👍:remove");
    assert.deepStrictEqual(result.reactions, [
      { messageId: "msg123", emoji: "👍", action: "remove" },
    ]);
    assert.equal(result.text, "");
  });

  it("handles multiple REACT markers", () => {
    const result = parseMarkers("REACT:a:👍\nREACT:b:❤️\nDone");
    assert.equal(result.reactions.length, 2);
    assert.equal(result.reactions[0].messageId, "a");
    assert.equal(result.reactions[1].messageId, "b");
    assert.equal(result.text, "Done");
  });

  // ---- REPLY ----

  it("parses REPLY:messageId", () => {
    const result = parseMarkers("REPLY:msg456\nHere is my reply");
    assert.equal(result.replyTo, "msg456");
    assert.equal(result.text, "Here is my reply");
  });

  it("last REPLY wins when multiple present", () => {
    const result = parseMarkers("REPLY:first\nREPLY:second\nText");
    assert.equal(result.replyTo, "second");
  });

  // ---- PROFILE ----

  it("parses PROFILE:name", () => {
    const result = parseMarkers("PROFILE:QA Bot Alpha\nHello");
    assert.equal(result.profileName, "QA Bot Alpha");
    assert.equal(result.text, "Hello");
  });

  it("parses PROFILE with leading dot", () => {
    const result = parseMarkers(".PROFILE:QA Bot Alpha");
    assert.equal(result.profileName, "QA Bot Alpha");
  });

  it("does not confuse PROFILE: with PROFILEIMAGE:", () => {
    const result = parseMarkers("PROFILEIMAGE:https://example.com/img.png");
    assert.equal(result.profileName, undefined);
    assert.equal(result.profileImage, "https://example.com/img.png");
  });

  // ---- PROFILEIMAGE ----

  it("parses PROFILEIMAGE:url", () => {
    const result = parseMarkers("PROFILEIMAGE:https://example.com/avatar.png\nHi");
    assert.equal(result.profileImage, "https://example.com/avatar.png");
    assert.equal(result.text, "Hi");
  });

  it("parses PROFILEIMAGE with leading dot", () => {
    const result = parseMarkers(".PROFILEIMAGE:https://example.com/avatar.png");
    assert.equal(result.profileImage, "https://example.com/avatar.png");
  });

  // ---- METADATA ----

  it("parses METADATA:key=value", () => {
    const result = parseMarkers("METADATA:credits=100\nOk");
    assert.deepStrictEqual(result.profileMetadata, { credits: "100" });
    assert.equal(result.text, "Ok");
  });

  it("handles multiple METADATA markers", () => {
    const result = parseMarkers("METADATA:a=1\nMETADATA:b=2\nDone");
    assert.deepStrictEqual(result.profileMetadata, { a: "1", b: "2" });
    assert.equal(result.text, "Done");
  });

  it("handles value with = sign", () => {
    const result = parseMarkers("METADATA:url=https://x.com?a=1");
    assert.deepStrictEqual(result.profileMetadata, { url: "https://x.com?a=1" });
  });

  // ---- MEDIA ----

  it("parses MEDIA:/path standalone line", () => {
    const result = parseMarkers("MEDIA:/tmp/image.png\nHere you go");
    assert.deepStrictEqual(result.media, ["/tmp/image.png"]);
    assert.equal(result.text, "Here you go");
  });

  it("parses MEDIA:/path inline", () => {
    const result = parseMarkers("Check this out MEDIA:/tmp/file.pdf please");
    assert.deepStrictEqual(result.media, ["/tmp/file.pdf"]);
    assert.equal(result.text, "Check this out  please");
  });

  it("handles multiple MEDIA markers", () => {
    const result = parseMarkers("MEDIA:/a.png\nMEDIA:/b.png\nFiles attached");
    assert.equal(result.media.length, 2);
    assert.equal(result.text, "Files attached");
  });

  it("parses MEDIA:./relative standalone line", () => {
    const result = parseMarkers("MEDIA:./zoom1.jpg\nHere you go");
    assert.deepStrictEqual(result.media, ["./zoom1.jpg"]);
    assert.equal(result.text, "Here you go");
  });

  it("parses MEDIA:../relative path", () => {
    const result = parseMarkers("MEDIA:../output/chart.png\nChart attached");
    assert.deepStrictEqual(result.media, ["../output/chart.png"]);
    assert.equal(result.text, "Chart attached");
  });

  it("handles mixed absolute and relative MEDIA paths", () => {
    const result = parseMarkers("MEDIA:/tmp/a.png\nMEDIA:./b.png\nDone");
    assert.equal(result.media.length, 2);
    assert.deepStrictEqual(result.media, ["/tmp/a.png", "./b.png"]);
    assert.equal(result.text, "Done");
  });

  // ---- Combined ----

  it("handles all markers in one response", () => {
    const input = [
      "REACT:msg1:👀",
      "REPLY:msg2",
      "PROFILE:Test Bot 🤖",
      "METADATA:status=active",
      "MEDIA:/tmp/report.pdf",
      "Here is your report!",
    ].join("\n");
    const result = parseMarkers(input);

    assert.equal(result.reactions.length, 1);
    assert.equal(result.replyTo, "msg2");
    assert.equal(result.profileName, "Test Bot 🤖");
    assert.deepStrictEqual(result.profileMetadata, { status: "active" });
    assert.deepStrictEqual(result.media, ["/tmp/report.pdf"]);
    assert.equal(result.text, "Here is your report!");
  });

  it("returns plain text when no markers", () => {
    const result = parseMarkers("Just a normal message\nWith two lines");
    assert.equal(result.text, "Just a normal message\nWith two lines");
    assert.equal(result.reactions.length, 0);
    assert.equal(result.media.length, 0);
    assert.equal(result.replyTo, undefined);
    assert.equal(result.profileName, undefined);
    assert.equal(result.profileImage, undefined);
    assert.deepStrictEqual(result.profileMetadata, {});
  });

  it("returns empty text when all lines are markers", () => {
    const result = parseMarkers("REACT:m:👍\nPROFILE:Bot");
    assert.equal(result.text, "");
  });
});
