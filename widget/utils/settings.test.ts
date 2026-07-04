import { describe, it, expect } from "vitest";
import { parseSettings } from "./settings";

describe("parseSettings", () => {
  it("returns an empty object for empty or invalid input", () => {
    expect(parseSettings([])).toEqual({});
    expect(parseSettings(null)).toEqual({});
    expect(parseSettings(undefined)).toEqual({});
    expect(parseSettings("nope")).toEqual({});
    expect(parseSettings([null])).toEqual({});
  });

  it("parses the key-value format", () => {
    const result = parseSettings([
      { key: "primary_color", value: "#FF0000" },
      { key: "initial_message", value: "こんにちは" },
      { key: "chat_title", value: "マイAI" },
    ]);
    expect(result).toEqual({
      primaryColor: "#FF0000",
      initialMessage: "こんにちは",
      title: "マイAI",
    });
  });

  it("parses the single-row column format", () => {
    const result = parseSettings([
      { primary_color: "#00FF00", initial_message: "hi", chat_title: "Bot" },
    ]);
    expect(result).toEqual({
      primaryColor: "#00FF00",
      initialMessage: "hi",
      title: "Bot",
    });
  });

  it("normalizes key variations and trims values", () => {
    const result = parseSettings([
      { key: "Primary Color", value: "  #abc  " },
      { key: "Greeting", value: "やあ" },
      { key: "Title", value: "T" },
    ]);
    expect(result).toEqual({
      primaryColor: "#abc",
      initialMessage: "やあ",
      title: "T",
    });
  });

  it("supports the short aliases color / greeting / title", () => {
    const result = parseSettings([
      { key: "color", value: "#111" },
      { key: "greeting", value: "よろしく" },
    ]);
    expect(result).toEqual({ primaryColor: "#111", initialMessage: "よろしく" });
  });

  it("ignores unrelated keys and empty values", () => {
    const result = parseSettings([
      { key: "unknown", value: "x" },
      { key: "primary_color", value: "" },
    ]);
    expect(result).toEqual({});
  });

  it("skips non-record / keyless / null-value rows in key-value data", () => {
    const result = parseSettings([
      { key: "primary_color", value: "#111" },
      null,
      "junk",
      { key: "", value: "ignored" },
      { key: "initial_message", value: null },
    ]);
    expect(result).toEqual({ primaryColor: "#111" });
  });

  it("treats null values as empty in the single-row column format", () => {
    const result = parseSettings([
      { primary_color: "#222", initial_message: null },
    ]);
    expect(result).toEqual({ primaryColor: "#222" });
  });
});
