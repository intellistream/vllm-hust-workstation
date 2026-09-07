import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SearchResult } from "@/types";

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

export type WebSearchContext = {
  enabled: boolean;
  attempted: boolean;
  mode: "disabled" | "workstation-context";
  query: string;
  results: SearchResult[];
  context: string;
};

const SEARCH_ENABLED = process.env.SEARCH_ENABLED !== "false";
const SEARCH_MAX_RESULTS = Number(process.env.SEARCH_MAX_RESULTS || "5");
const SEARCH_TIMEOUT_MS = Number(process.env.SEARCH_TIMEOUT_MS || "8000");
const SEARCH_CONTEXT_MAX_RESULTS = Number(process.env.SEARCH_CONTEXT_MAX_RESULTS || "1");
const SEARCH_CONTEXT_SNIPPET_CHARS = Number(process.env.SEARCH_CONTEXT_SNIPPET_CHARS || "80");
const SEARCH_CONTEXT_TOTAL_CHARS = Number(process.env.SEARCH_CONTEXT_TOTAL_CHARS || "260");
const SEARCH_QUERY_MAX_CHARS = Number(process.env.SEARCH_QUERY_MAX_CHARS || "200");
const execFileAsync = promisify(execFile);
const WEATHER_QUERY_RE = /(天气|气温|温度|体感|湿度|风力|风速|降雨|下雨|weather|temperature)/i;
const INSTRUCTION_PREFIX_HINT_RE = /请|麻烦|回答|说明|解释|介绍|总结|概括|分析|比较|对比|列出|给出|告诉|查询|搜索|一句|中文|英文|简要|直接|只用|仅用/i;
const POLITE_PREFIX_RE = /^(?:请问|请(?:你)?(?:帮我|帮忙)?|麻烦(?:你)?|劳驾|能否|可以(?:请)?)\s*/i;
const OUTPUT_FORMAT_PREFIX_RE = /^(?:(?:只|仅)\s*)?(?:(?:用|使用)\s*)?(?:(?:一|两|三|\d+)\s*)?句(?:中文|英文)?(?:话)?\s*(?:简要|直接)?\s*(?:来)?\s*(?:回答|说明|解释)\s*/i;
const REQUEST_VERB_PREFIX_RE = /^(?:回答|说明|解释|介绍|总结|概括|分析|比较|对比|列出|给出|告诉我|查询|搜索|查找)(?:一下)?\s*/i;
const TRAILING_FORMAT_RE = /\s*(?:请)?\s*(?:(?:只|仅)\s*)?(?:(?:用|使用)\s*)?(?:(?:一|两|三|\d+)\s*)?句(?:中文|英文)?(?:话)?\s*(?:简要|直接)?\s*(?:回答|说明)?\s*$/i;
const QUESTION_STOP_PHRASES = ["为什么", "是什么", "是不是", "请问", "怎么", "如何", "哪些", "哪个", "是否", "为何"];

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
    const resultUrl = decodeBingResultUrl(decodeXmlEntities(linkMatch?.[1] || ""));
    const snippet = decodeXmlEntities(snippetMatch?.[1] || "");

    if (!title || !resultUrl) {
      continue;
    }

    results.push({ title, url: resultUrl, snippet });
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
    const resultUrl = decodeBingResultUrl(titleMatch[1]);
    const snippet = stripTags(snippetMatch?.[1] || "");

    if (!title || !resultUrl) {
      continue;
    }

    results.push({ title, url: resultUrl, snippet });
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
    const resultUrl = titleMatch[1];
    const title = stripTags(titleMatch[2]);
    const snippet = stripTags(snippetMatch?.[1] || snippetMatch?.[2] || "");
    if (!title || !resultUrl) {
      continue;
    }
    results.push({ title, url: resultUrl, snippet });
  }

  return results;
}

export function isWorkstationSearchEnabled(): boolean {
  return SEARCH_ENABLED;
}

export function getWorkstationSearchMode(): WebSearchContext["mode"] {
  return SEARCH_ENABLED ? "workstation-context" : "disabled";
}

function looksLikeInstructionPrefix(prefix: string): boolean {
  const compact = prefix.replace(/\s+/g, "").trim();
  return compact.length > 0 && compact.length <= 40 && INSTRUCTION_PREFIX_HINT_RE.test(compact);
}

export function normalizeSearchQuery(query: string): string {
  const trimmed = query.trim().slice(0, SEARCH_QUERY_MAX_CHARS);
  if (!trimmed) {
    return "";
  }

  let subject = trimmed;
  const colonIndex = subject.search(/[:：]/);
  if (colonIndex > 0 && looksLikeInstructionPrefix(subject.slice(0, colonIndex))) {
    const suffix = subject.slice(colonIndex + 1).trim();
    if (suffix.length >= 2) {
      subject = suffix;
    }
  }

  for (let pass = 0; pass < 3; pass += 1) {
    const previous = subject;
    subject = subject
      .replace(POLITE_PREFIX_RE, "")
      .replace(OUTPUT_FORMAT_PREFIX_RE, "")
      .replace(REQUEST_VERB_PREFIX_RE, "")
      .trim();
    if (subject === previous) break;
  }

  const normalized = subject
    .replace(TRAILING_FORMAT_RE, "")
    .replace(/[，。！？?、,:：；;（）()【】\[\]"'“”‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || trimmed;
}

function meaningfulSearchTerms(query: string): string[] {
  const normalized = query.toLocaleLowerCase().replace(/[\p{P}\p{S}]+/gu, " ");
  const terms = new Set<string>();

  for (const token of normalized.match(/[a-z0-9][a-z0-9._+-]{1,}/g) || []) {
    terms.add(token);
  }

  let hanText = normalized;
  for (const phrase of QUESTION_STOP_PHRASES) {
    hanText = hanText.replaceAll(phrase, " ");
  }
  hanText = hanText.replace(/[的吗呢呀啊了是有在和与及]/g, " ");

  for (const segment of hanText.match(/\p{Script=Han}{2,}/gu) || []) {
    if (segment.length <= 4) {
      terms.add(segment);
      continue;
    }
    for (let index = 0; index < segment.length - 1; index += 1) {
      terms.add(segment.slice(index, index + 2));
    }
  }

  return [...terms];
}

export function filterRelevantSearchResults(query: string, results: SearchResult[]): SearchResult[] {
  const terms = meaningfulSearchTerms(query);
  if (!terms.length) {
    return results;
  }
  const requiredMatches = terms.length > 1 ? 2 : 1;

  return results.filter((result) => {
    const haystack = `${result.title} ${result.snippet}`.toLocaleLowerCase();
    let matches = 0;
    for (const term of terms) {
      if (haystack.includes(term)) {
        matches += 1;
        if (matches >= requiredMatches) return true;
      }
    }
    return false;
  });
}

export async function searchWeb(query: string, maxResults = Math.min(SEARCH_MAX_RESULTS, 10)): Promise<SearchResult[]> {
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

export function buildSearchContext(results: SearchResult[]): string {
  if (!results.length) {
    return "";
  }

  const lines = [
    "【联网搜索参考】仅使用与问题直接相关且确实支持回答的内容。",
    "若结果不足，请基于自身知识作答；不得虚构引用，也不要因搜索未覆盖而称问题无法回答。",
    "使用搜索内容时标注 [编号]；未使用则不要添加引用。",
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
  return lines.join("\n").slice(0, SEARCH_CONTEXT_TOTAL_CHARS);
}

export async function getWebSearchContext(query: string, forceEnable = true): Promise<WebSearchContext> {
  const trimmedQuery = normalizeSearchQuery(query);
  if (!forceEnable || !SEARCH_ENABLED || !trimmedQuery) {
    return {
      enabled: SEARCH_ENABLED,
      attempted: false,
      mode: getWorkstationSearchMode(),
      query: trimmedQuery,
      results: [],
      context: "",
    };
  }

  try {
    const rawResults = await searchWeb(trimmedQuery, Math.min(SEARCH_MAX_RESULTS, 10));
    const results = filterRelevantSearchResults(trimmedQuery, rawResults);
    return {
      enabled: SEARCH_ENABLED,
      attempted: true,
      mode: getWorkstationSearchMode(),
      query: trimmedQuery,
      results,
      context: buildSearchContext(results),
    };
  } catch {
    return {
      enabled: SEARCH_ENABLED,
      attempted: true,
      mode: getWorkstationSearchMode(),
      query: trimmedQuery,
      results: [],
      context: "",
    };
  }
}
