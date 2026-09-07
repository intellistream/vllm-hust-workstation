// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "@/types";
import {
  buildSearchContext,
  filterRelevantSearchResults,
  getWebSearchContext,
  normalizeSearchQuery,
} from "./webSearch";

function rss(items: SearchResult[]): string {
  return `<?xml version="1.0"?><rss><channel>${items
    .map(
      (item) =>
        `<item><title>${item.title}</title><link>${item.url}</link><description>${item.snippet}</description></item>`
    )
    .join("")}</channel></rss>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Chinese search query extraction", () => {
  it("drops an output-format prefix without deleting the semantic question", () => {
    expect(normalizeSearchQuery("请只用一句中文回答：天空为什么是蓝色？")).toBe(
      "天空为什么是蓝色"
    );
  });

  it("also handles the same instruction without a colon", () => {
    expect(normalizeSearchQuery("请只用一句中文回答天空为什么是蓝色")).toBe(
      "天空为什么是蓝色"
    );
  });

  it("keeps useful time and capability terms", () => {
    expect(normalizeSearchQuery("请帮我介绍一下 vLLM-HUST 最近支持情况")).toBe(
      "vLLM-HUST 最近支持情况"
    );
  });

  it("does not restore boilerplate when the extracted subject is short", () => {
    expect(normalizeSearchQuery("请问：AI？")).toBe("AI");
  });
});

describe("search result relevance", () => {
  const unrelated: SearchResult[] = [
    { title: "请_百度百科", url: "https://example.com/qing", snippet: "请字的含义和笔顺" },
    { title: "新华字典：请", url: "https://example.com/dictionary", snippet: "请的拼音" },
    { title: "天空高清图片下载", url: "https://example.com/photos", snippet: "免版税图库" },
  ];
  const relevant: SearchResult = {
    title: "天空为什么呈蓝色",
    url: "https://example.com/sky",
    snippet: "蓝光在大气中更容易发生瑞利散射。",
  };

  it("removes results that only match instruction boilerplate", () => {
    expect(filterRelevantSearchResults("天空为什么是蓝色", unrelated)).toEqual([]);
  });

  it("retains directly relevant results in provider order", () => {
    expect(filterRelevantSearchResults("天空为什么是蓝色", [...unrelated, relevant])).toEqual([
      relevant,
    ]);
  });

  it("does not force use of retrieval and requires honest citations", () => {
    const context = buildSearchContext([relevant]);
    expect(context).toContain("若结果不足，请基于自身知识作答");
    expect(context).toContain("不得虚构引用");
    expect(context).toContain("未使用则不要添加引用");
    expect(context).not.toContain("必须优先");
  });

  it("filters irrelevant provider results before returning context or UI evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(rss(unrelated), {
          status: 200,
          headers: { "Content-Type": "application/rss+xml" },
        })
      )
    );

    const result = await getWebSearchContext(
      "请只用一句中文回答：天空为什么是蓝色？",
      true
    );
    expect(result).toMatchObject({
      attempted: true,
      query: "天空为什么是蓝色",
      results: [],
      context: "",
    });
  });

  it("returns a relevant result with conditional citation guidance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(rss([relevant]), {
          status: 200,
          headers: { "Content-Type": "application/rss+xml" },
        })
      )
    );

    const result = await getWebSearchContext("天空为什么是蓝色", true);
    expect(result.results).toEqual([relevant]);
    expect(result.context).toContain("[1] 天空为什么呈蓝色");
  });
});
