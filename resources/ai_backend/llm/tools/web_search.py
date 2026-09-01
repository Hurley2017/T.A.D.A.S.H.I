"""DuckDuckGo Web Search Tool and OpenAI JSON Schema.

Provides real-time search capabilities when the local LLM needs live facts,
recent news, weather, or external information.
"""

import asyncio
import json
import logging
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

# =============================================================================
# OPENAI FUNCTION CALLING JSON SCHEMA
# =============================================================================
DUCKDUCKGO_TOOL_SCHEMA: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": (
            "Search the live web using DuckDuckGo to retrieve current facts, "
            "news, sports scores, weather, or recent information."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The targeted search query keywords.",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Number of search results to return (default: 3).",
                    "default": 3,
                },
            },
            "required": ["query"],
        },
    },
}


def duckduckgo_web_search(query: str, max_results: int = 3) -> str:
    """Execute a synchronous DuckDuckGo search and return summarized text.

    Args:
        query: The search query string.
        max_results: Maximum number of search results to fetch.

    Returns:
        str: Summarized search results formatted as text or error message.
    """
    logger.info("[TOOL] Executing DuckDuckGo web search: '%s'", query)
    try:
        try:
            from ddgs import DDGS
        except ImportError:
            from duckduckgo_search import DDGS

        results: List[Dict[str, str]] = []
        with DDGS() as ddgs:
            raw_results = list(ddgs.text(query, max_results=max_results))
            for item in raw_results:
                title = item.get("title", "").strip()
                body = item.get("body", "").strip()
                if title or body:
                    results.append({"title": title, "snippet": body})

        if not results:
            return "No relevant search results found for the query."

        # Format concise snippets for the LLM context
        formatted_snippets = []
        for i, res in enumerate(results, start=1):
            formatted_snippets.append(f"[{i}] {res['title']}: {res['snippet']}")

        return "\n".join(formatted_snippets)

    except Exception as e:
        logger.error("DuckDuckGo search error: %s", e)
        return f"Error executing web search: {str(e)}"


async def duckduckgo_web_search_async(query: str, max_results: int = 3) -> str:
    """Asynchronous wrapper for DuckDuckGo web search."""
    return await asyncio.to_thread(duckduckgo_web_search, query, max_results)
