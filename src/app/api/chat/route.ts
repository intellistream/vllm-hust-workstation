import { SERVER_CONFIG } from "@/lib/config";
import {
  beginChatRequest,
  estimateTokenCount,
  finishChatRequest,
  recordApiRequest,
  recordUpstreamRequest,
} from "@/lib/metrics";
import { NextRequest } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const runtime = "nodejs";

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

type OpenMeteoGeocodingResponse = {
  results?: Array<{
    name?: string;
    latitude?: number;
    longitude?: number;
    country?: string;
    admin1?: string;
    timezone?: string;
  }>;
};

type OpenMeteoForecastResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
};

const SEARCH_ENABLED = process.env.SEARCH_ENABLED !== "false";
const SEARCH_MAX_RESULTS = Number(process.env.SEARCH_MAX_RESULTS || "5");
const SEARCH_TIMEOUT_MS = Number(process.env.SEARCH_TIMEOUT_MS || "8000");
const DEFAULT_CHAT_MAX_TOKENS = Number(process.env.WORKSTATION_DEFAULT_MAX_TOKENS || "128");
const SEARCH_CONTEXT_MAX_RESULTS = Number(process.env.SEARCH_CONTEXT_MAX_RESULTS || "1");
const SEARCH_CONTEXT_SNIPPET_CHARS = Number(process.env.SEARCH_CONTEXT_SNIPPET_CHARS || "80");
const SEARCH_CONTEXT_TOTAL_CHARS = Number(process.env.SEARCH_CONTEXT_TOTAL_CHARS || "260");
const execFileAsync = promisify(execFile);
const WEATHER_QUERY_RE = /(天气|气温|温度|体感|湿度|风力|风速|降雨|下雨|weather|temperature)/i;

function stripTags(input: string): string {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBingResultUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const encoded = parsed.searchParams.get("u");
    if (!encoded) {
      return url;
    }
    const normalized = encoded.startsWith("a1") ? encoded.slice(2) : encoded;
    return decodeURIComponent(normalized);
  } catch {
    return url;
  }
}

async function fetchTextWithCurl(url: string, acceptHeader: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-L",
      "-sS",
      "--max-time",
      String(Math.max(1, Math.ceil(SEARCH_TIMEOUT_MS / 1000))),
      "-H",
      "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "-H",
      `Accept: ${acceptHeader}`,
      url,
    ],
    {
      maxBuffer: 2 * 1024 * 1024,
    }
  );
  return stdout;
}

async function fetchJsonWithCurlFallback<T>(url: string): Promise<T> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`json fetch failed: ${response.status}`);
    }

    return (await response.json()) as T;
  } catch {
    const text = await fetchTextWithCurl(url, "application/json,text/plain;q=0.9,*/*;q=0.8");
    return JSON.parse(text) as T;
  }
}

function normalizePlaceName(rawQuery: string): string {
  return rawQuery
    .replace(/[，。！？?、,.:：；;（）()【】\[\]"'“”‘’]/g, " ")
    .replace(/请问|帮我|帮忙|查一下|查下|查询一下|查询|告诉我|想知道|看下|看一下|实时|最新|当前|现在|此刻/gi, " ")
    .replace(/今天天气怎么样|今天天气如何|天气怎么样|天气如何|天气|气温|温度|体感|湿度|风力|风速|降雨概率|降雨|下雨吗|会下雨吗|会不会下雨|多少度|多少|几度/gi, " ")
    .replace(/今天|今日|现在|目前|明天|后天|这两天|最近/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractWeatherLocation(query: string): string {
  const normalized = normalizePlaceName(query);
  if (normalized) {
    return normalized;
  }

  const match = query.match(/([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z\s·.-]{0,30})/u);
  return match?.[1]?.trim() || "";
}

function weatherCodeToChinese(code?: number): string {
  if (code == null) {
    return "天气未知";
  }

  if (code === 0) return "晴朗";
  if ([1, 2].includes(code)) return "少云";
  if (code === 3) return "阴天";
  if ([45, 48].includes(code)) return "有雾";
  if ([51, 53, 55, 56, 57].includes(code)) return "毛毛雨";
  if ([61, 63, 65, 80, 81, 82].includes(code)) return "下雨";
  if ([66, 67].includes(code)) return "冻雨";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "下雪";
  if ([95, 96, 99].includes(code)) return "雷暴";
  return `天气代码 ${code}`;
}

async function searchRealtimeWeather(query: string): Promise<SearchResult[]> {
  if (!WEATHER_QUERY_RE.test(query)) {
    return [];
  }

  const location = extractWeatherLocation(query);
  if (!location) {
    return [];
  }

  const geo = await fetchJsonWithCurlFallback<OpenMeteoGeocodingResponse>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=zh&format=json`
  );
  const place = geo.results?.[0];

  if (typeof place?.latitude !== "number" || typeof place?.longitude !== "number") {
    return [];
  }

  const forecast = await fetchJsonWithCurlFallback<OpenMeteoForecastResponse>(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto`
  );

  const current = forecast.current;
  if (!current) {
    return [];
  }

  const placeName = [place.country, place.admin1, place.name].filter(Boolean).join(" ");
  const maxTemp = forecast.daily?.temperature_2m_max?.[0];
  const minTemp = forecast.daily?.temperature_2m_min?.[0];
  const precip = forecast.daily?.precipitation_probability_max?.[0];
  const summaryParts = [
    `${placeName}当前${weatherCodeToChinese(current.weather_code)}`,
    typeof current.temperature_2m === "number" ? `气温 ${current.temperature_2m}°C` : "",
    typeof current.apparent_temperature === "number" ? `体感 ${current.apparent_temperature}°C` : "",
    typeof current.relative_humidity_2m === "number" ? `湿度 ${current.relative_humidity_2m}%` : "",
    typeof current.wind_speed_10m === "number" ? `风速 ${current.wind_speed_10m} km/h` : "",
    typeof maxTemp === "number" && typeof minTemp === "number"
      ? `今天 ${minTemp}–${maxTemp}°C`
      : "",
    typeof precip === "number" ? `降水概率 ${precip}%` : "",
    current.time ? `更新时间 ${current.time}` : "",
  ].filter(Boolean);

  return [
    {
      title: `${placeName} 实时天气`,
      url: "https://open-meteo.com/",
      snippet: `${summaryParts.join("；")}。数据源：Open-Meteo。`,
    },
  ];
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchBingRss(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
  let xml = "";

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/rss+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.7",
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`bing rss search failed: ${response.status}`);
    }

    xml = await response.text();
  } catch {
    xml = await fetchTextWithCurl(url, "application/rss+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.7");
  }

  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const results: SearchResult[] = [];
  const blocks = xml.match(itemRegex) || [];

  for (const block of blocks) {
    if (results.length >= maxResults) {
      break;
    }

    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
    const snippetMatch = block.match(/<description>([\s\S]*?)<\/description>/i);

    const title = decodeXmlEntities(titleMatch?.[1] || "");
    const url = decodeBingResultUrl(decodeXmlEntities(linkMatch?.[1] || ""));
    const snippet = decodeXmlEntities(snippetMatch?.[1] || "");

    if (!title || !url) {
      continue;
    }

    results.push({ title, url, snippet });
  }

  return results;
}

async function searchBingHtml(query: string, maxResults: number): Promise<SearchResult[]> {
  const response = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-Hans`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`bing search failed: ${response.status}`);
  }

  const html = await response.text();
  const blockRegex = /<li class="b_algo"[\s\S]*?<\/li>/g;
  const blocks = html.match(blockRegex) || [];
  const results: SearchResult[] = [];

  for (const block of blocks) {
    if (results.length >= maxResults) {
      break;
    }

    const titleMatch = block.match(/<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/i);
    if (!titleMatch) {
      continue;
    }

    const snippetMatch = block.match(/<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
    const title = stripTags(titleMatch[2]);
    const url = decodeBingResultUrl(titleMatch[1]);
    const snippet = stripTags(snippetMatch?.[1] || "");

    if (!title || !url) {
      continue;
    }

    results.push({ title, url, snippet });
  }

  return results;
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=cn-zh`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`duckduckgo search failed: ${response.status}`);
  }

  const html = await response.text();
  const blockRegex = /<div class="result results_links[\s\S]*?<\/div>\s*<\/div>/g;
  const blocks = html.match(blockRegex) || [];
  const results: SearchResult[] = [];

  for (const block of blocks) {
    if (results.length >= maxResults) {
      break;
    }
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) {
      continue;
    }
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    const url = titleMatch[1];
    const title = stripTags(titleMatch[2]);
    const snippet = stripTags(snippetMatch?.[1] || snippetMatch?.[2] || "");
    if (!title || !url) {
      continue;
    }
    results.push({ title, url, snippet });
  }

  return results;
}

async function searchWeb(query: string, maxResults: number): Promise<SearchResult[]> {
  try {
    const weatherResults = await searchRealtimeWeather(query);
    if (weatherResults.length) {
      return weatherResults.slice(0, maxResults);
    }
  } catch {
    // fall through to generic web providers
  }

  try {
    const bingResults = await searchBingRss(query, maxResults);
    if (bingResults.length) {
      return bingResults;
    }
  } catch {
    // fall through to secondary provider
  }

  try {
    const bingHtmlResults = await searchBingHtml(query, maxResults);
    if (bingHtmlResults.length) {
      return bingHtmlResults;
    }
  } catch {
    // fall through to secondary provider
  }

  return searchDuckDuckGo(query, maxResults);
}

function buildSearchContext(results: SearchResult[]): string {
  if (!results.length) {
    return "";
  }
  const lines = [
    "【联网搜索结果】以下是刚刚实时搜索到的内容，请直接利用这些内容回答用户问题。",
    "你已经拿到了实时搜索/工具结果，必须优先基于这些结果作答。",
    "不要再说你无法联网、无法实时获取信息、没有相关数据。",
    "",
  ];
  const limitedResults = results.slice(0, Math.max(1, SEARCH_CONTEXT_MAX_RESULTS));
  for (const [index, result] of limitedResults.entries()) {
    lines.push(`[${index + 1}] ${result.title}`);
    if (result.snippet) {
      lines.push(`    ${result.snippet.slice(0, SEARCH_CONTEXT_SNIPPET_CHARS)}`);
    }
  }
  lines.push("");
  lines.push("请根据以上结果直接作答，并在引用时标注 [编号]。\n");
  return lines.join("\n").slice(0, SEARCH_CONTEXT_TOTAL_CHARS);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { messages, model, stream = true } = body;
  const doSearch = Boolean(body.web_search) && SEARCH_ENABLED;
  const encoder = new TextEncoder();

  let searchResults: SearchResult[] = [];
  let searchQuery = "";
  let searchAttempted = false;
  let outboundMessages = Array.isArray(messages) ? [...messages] : [];

  if (doSearch) {
    const lastUserMessage = [...outboundMessages].reverse().find((message) => message?.role === "user");
    searchQuery = typeof lastUserMessage?.content === "string" ? lastUserMessage.content.slice(0, 200).trim() : "";
    if (searchQuery) {
      searchAttempted = true;
      try {
        searchResults = await searchWeb(searchQuery, Math.min(SEARCH_MAX_RESULTS, 10));
        if (searchResults.length) {
          const context = buildSearchContext(searchResults);
          outboundMessages = outboundMessages.map((message, index) => {
            if (index === outboundMessages.lastIndexOf(lastUserMessage)) {
              return {
                ...message,
                content: `${context}\n用户问题：${message.content}`,
              };
            }
            return message;
          });
        }
      } catch {
        searchResults = [];
      }
    }
  }

  const upstream = `${SERVER_CONFIG.baseUrl}/v1/chat/completions`;

  const requestStart = performance.now();
  beginChatRequest();

  try {
    const upstreamStart = performance.now();
    const response = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVER_CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        ...body,
        model,
        messages: outboundMessages,
        stream,
        max_tokens:
          typeof body?.max_tokens === "number" && Number.isFinite(body.max_tokens)
            ? body.max_tokens
            : DEFAULT_CHAT_MAX_TOKENS,
      }),
    });
    recordUpstreamRequest(
      "/api/chat",
      "/v1/chat/completions",
      response.status,
      (performance.now() - upstreamStart) / 1000
    );

    if (!response.ok || !response.body) {
      const err = await response.text();
      const totalDurationSeconds = (performance.now() - requestStart) / 1000;
      finishChatRequest({
        model,
        durationSeconds: totalDurationSeconds,
        approxTokens: 0,
        status: "failed",
      });
      recordApiRequest("/api/chat", "POST", response.status, totalDurationSeconds);
      const errorText = err.slice(0, 240).replace(/\n/g, " ");
      return Response.json(
        {
          error: errorText || "上游服务返回错误",
          search: searchAttempted
            ? {
                query: searchQuery,
                results: searchResults,
              }
            : undefined,
        },
        { status: response.status || 502 }
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (!stream && contentType.includes("application/json")) {
      const payload = await response.json();
      const generated =
        typeof payload?.choices?.[0]?.message?.content === "string"
          ? payload.choices[0].message.content
          : "";
      const totalDurationSeconds = (performance.now() - requestStart) / 1000;
      finishChatRequest({
        model,
        durationSeconds: totalDurationSeconds,
        approxTokens: estimateTokenCount(generated),
        status: "completed",
      });
      recordApiRequest("/api/chat", "POST", 200, totalDurationSeconds);

      if (!searchAttempted) {
        return Response.json(payload);
      }

      return Response.json({
        ...payload,
        search: {
          query: searchQuery,
          results: searchResults,
        },
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-cache");
    headers.set("Connection", "keep-alive");

    let sseBuffer = "";
    let generatedText = "";
    let finalized = false;

    const finalize = (status: "completed" | "failed") => {
      if (finalized) {
        return;
      }
      finalized = true;
      const durationSeconds = (performance.now() - requestStart) / 1000;
      const approxTokens = estimateTokenCount(generatedText);
      finishChatRequest({
        model,
        durationSeconds,
        approxTokens,
        status,
      });
      recordApiRequest(
        "/api/chat",
        "POST",
        status === "completed" ? 200 : 499,
        durationSeconds
      );
    };

    const streamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (searchAttempted) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "search_results", query: searchQuery, results: searchResults })}\n\n`
              )
            );
          }

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              finalize("completed");
              controller.close();
              return;
            }

            if (value) {
              const chunk = decoder.decode(value, { stream: true });
              sseBuffer += chunk;
              const lines = sseBuffer.split("\n");
              sseBuffer = lines.pop() ?? "";

              for (const line of lines) {
                if (!line.startsWith("data: ")) {
                  continue;
                }
                const data = line.slice(6).trim();
                if (!data || data === "[DONE]") {
                  continue;
                }
                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta?.content;
                  if (typeof delta === "string") {
                    generatedText += delta;
                  }
                } catch {
                  // 非 JSON SSE 片段直接透传，不影响流式返回
                }
              }
              controller.enqueue(value);
            }
          }
        } catch (error) {
          finalize("failed");
          controller.error(error);
        }
      },
      async cancel(reason) {
        finalize("failed");
        await reader.cancel(reason);
      },
    });

    return new Response(streamBody, {
      status: 200,
      headers,
    });
  } catch (error) {
    const totalDurationSeconds = (performance.now() - requestStart) / 1000;
    finishChatRequest({
      model,
      durationSeconds: totalDurationSeconds,
      approxTokens: 0,
      status: "failed",
    });
    recordApiRequest("/api/chat", "POST", 500, totalDurationSeconds);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "upstream request failed",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
