import { describe, expect, it } from "vitest";
import { formatOf, ingestProblem, listParams, parseDelimited, previewKind, safeFilename, servedType, sizeLabel } from "./model";

describe("Output Library model", () => {
  it("maps MIME types to formats and previews", () => {
    expect(formatOf("text/csv")).toBe("spreadsheet");
    expect(formatOf("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("spreadsheet");
    expect(formatOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("document");
    expect(formatOf("application/json", "report")).toBe("report");
    expect(formatOf("image/png")).toBe("image");
    expect(formatOf("application/zip")).toBe("other");
    expect(previewKind("text/markdown; charset=utf-8")).toBe("markdown");
    expect(previewKind("image/svg+xml")).toBe("none");
    expect(previewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("none");
  });

  it("serves active content as an inert download and text as plain text", () => {
    expect(servedType("text/html")).toEqual({ type: "application/octet-stream", inline: false });
    expect(servedType("image/svg+xml")).toEqual({ type: "application/octet-stream", inline: false });
    expect(servedType("text/markdown")).toEqual({ type: "text/plain; charset=utf-8", inline: true });
    expect(servedType("image/png")).toEqual({ type: "image/png", inline: true });
  });

  it("makes safe filenames", () => {
    expect(safeFilename('../../etc/"passwd"\r\n', "text/plain")).toBe("etc passwd.txt");
    expect(safeFilename("Report.pdf", "application/pdf")).toBe("Report.pdf");
    expect(safeFilename("", "application/zip")).toBe("output");
  });

  it("checks ingest bodies", () => {
    const ok = { source: { agent: "a", execution: "e1" }, artifacts: [{ id: "f.txt", title: "F", mime: "text/plain", text: "x" }] };
    expect(ingestProblem(ok)).toBeNull();
    expect(ingestProblem({ ...ok, artifacts: [...ok.artifacts, ok.artifacts[0]] })).toMatch(/repeats/);
    expect(ingestProblem({ ...ok, source: { agent: "a b", execution: "e" } })).toMatch(/agent/);
    expect(ingestProblem({ ...ok, artifacts: [{ ...ok.artifacts[0], base64: "%%%" , text: undefined }] })).toMatch(/base64/);
    expect(ingestProblem({ ...ok, artifacts: [{ ...ok.artifacts[0], mime: "nope" }] })).toMatch(/MIME/);
  });

  it("parses CSV for previews and formats sizes", () => {
    expect(parseDelimited('a,b\n"x, y","say ""hi"""\r\n1,2')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["1", "2"]]);
    expect(parseDelimited("a\n1\n2\n3", ",", 2)).toHaveLength(2);
    expect(sizeLabel(512)).toBe("512 B");
    expect(sizeLabel(2048)).toBe("2.0 KB");
    expect(listParams({ q: "x", page: 1, format: "" }).toString()).toBe("q=x");
  });
});
