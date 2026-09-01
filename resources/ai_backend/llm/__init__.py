"""LLM interface and function calling tools."""

from .client import LLMClient
from .tools.web_search import duckduckgo_web_search, DUCKDUCKGO_TOOL_SCHEMA

__all__ = ["LLMClient", "duckduckgo_web_search", "DUCKDUCKGO_TOOL_SCHEMA"]
