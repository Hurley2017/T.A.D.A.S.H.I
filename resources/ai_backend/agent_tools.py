"""TADASHI Chauffeur Agent Tools Module.

Provides native capabilities for desktop automation, live web searches,
workspace & project insights, system telemetry, and personal scratchpad notes.
"""

import json
import logging
import os
import subprocess
import urllib.parse
import urllib.request
import re
from typing import Dict, Any, List

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
NOTES_DIR = os.path.join(PROJECT_DIR, "notes")
os.makedirs(NOTES_DIR, exist_ok=True)

logger = logging.getLogger("agent_tools")


def search_web(query: str) -> Dict[str, Any]:
    """Perform live web search via DuckDuckGo and return concise summary snippets."""
    try:
        clean_query = query.strip()
        encoded = urllib.parse.quote_plus(clean_query)
        url = f"https://html.duckduckgo.com/html/?q={encoded}"

        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        )

        with urllib.request.urlopen(req, timeout=6) as response:
            html = response.read().decode("utf-8", errors="ignore")

        snippets = []
        regex = r'<a class="result__snippet[^>]*>(.*?)</a>'
        for match in re.finditer(regex, html):
            raw = match.group(1)
            clean = re.sub(r"<[^>]+>", "", raw).strip()
            if clean and clean not in snippets:
                snippets.append(clean)
            if len(snippets) >= 4:
                break

        summary = " ".join(snippets) if snippets else "No direct summary found."
        return {"success": True, "query": clean_query, "summary": summary, "snippets": snippets}

    except Exception as e:
        logger.error("Web search failed: %s", e)
        return {"success": False, "query": query, "error": str(e), "summary": f"Could not perform web search: {e}"}


def open_browser(target: str) -> Dict[str, Any]:
    """Open a URL or destination in the default web browser."""
    try:
        clean_target = target.strip()
        if not (clean_target.startswith("http://") or clean_target.startswith("https://")):
            if "youtube" in clean_target.lower():
                clean_target = "https://www.youtube.com"
            elif "github" in clean_target.lower():
                clean_target = "https://www.github.com"
            elif "google" in clean_target.lower():
                clean_target = "https://www.google.com"
            elif "reddit" in clean_target.lower():
                clean_target = "https://www.reddit.com"
            else:
                clean_target = f"https://www.google.com/search?q={urllib.parse.quote_plus(clean_target)}"

        import webbrowser
        webbrowser.open(clean_target)
        return {"success": True, "url": clean_target, "message": f"Opened {clean_target} in your browser."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def launch_app(app_name: str) -> Dict[str, Any]:
    """Launch a desktop application on Windows."""
    try:
        app_clean = app_name.strip().lower()
        app_map = {
            "spotify": "start spotify:",
            "chrome": "start chrome",
            "browser": "start chrome",
            "vscode": "code",
            "code": "code",
            "notepad": "notepad",
            "calculator": "calc",
            "calc": "calc",
            "terminal": "start wt",
            "cmd": "start cmd",
            "explorer": "explorer",
            "task manager": "taskmgr",
            "taskmgr": "taskmgr"
        }

        cmd = app_map.get(app_clean, f"start {app_clean}")
        subprocess.Popen(cmd, shell=True)
        return {"success": True, "app": app_name, "message": f"Launched {app_name}."}
    except Exception as e:
        return {"success": False, "app": app_name, "error": str(e)}


def inspect_workspace(dir_path: str = None) -> Dict[str, Any]:
    """Inspect workspace files, directory counts, and git status."""
    try:
        target_dir = dir_path or PROJECT_DIR
        if not os.path.exists(target_dir):
            return {"success": False, "error": f"Path '{target_dir}' does not exist."}

        files_list = []
        ext_counts = {}
        total_size = 0

        for root, dirs, files in os.walk(target_dir):
            # Skip node_modules, .git, .cache
            dirs[:] = [d for d in dirs if d not in ("node_modules", ".git", ".cache", "__pycache__", ".electron-userdata")]
            for f in files:
                ext = os.path.splitext(f)[1].lower() or "no_ext"
                ext_counts[ext] = ext_counts.get(ext, 0) + 1
                full_p = os.path.join(root, f)
                try:
                    total_size += os.path.getsize(full_p)
                except Exception:
                    pass
                if len(files_list) < 25:
                    files_list.append(os.path.relpath(full_p, target_dir))

        # Check git status if repo
        git_info = "Not a git repo"
        try:
            res = subprocess.run(["git", "status", "-s"], cwd=target_dir, capture_output=True, text=True, timeout=3)
            if res.returncode == 0:
                modified = len(res.stdout.strip().splitlines()) if res.stdout.strip() else 0
                git_branch = subprocess.run(["git", "branch", "--show-current"], cwd=target_dir, capture_output=True, text=True, timeout=2).stdout.strip()
                git_info = f"Branch: {git_branch}, {modified} modified file(s)"
        except Exception:
            pass

        return {
            "success": True,
            "directory": target_dir,
            "total_files": sum(ext_counts.values()),
            "extensions": ext_counts,
            "total_size_mb": round(total_size / (1024 * 1024), 2),
            "sample_files": files_list[:15],
            "git": git_info
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def read_project_file(file_path: str, max_lines: int = 60) -> Dict[str, Any]:
    """Read contents of a code file or documentation for insights."""
    try:
        full_path = os.path.abspath(os.path.join(PROJECT_DIR, file_path)) if not os.path.isabs(file_path) else file_path
        if not os.path.exists(full_path):
            return {"success": False, "error": f"File '{file_path}' not found."}

        with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = [f.readline() for _ in range(max_lines)]

        content = "".join(lines)
        return {
            "success": True,
            "file": os.path.basename(full_path),
            "lines_read": len(lines),
            "content": content
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_system_telemetry() -> Dict[str, Any]:
    """Get live CPU, RAM, and GPU memory telemetry on Windows without external dependencies."""
    try:
        import ctypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(stat)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))

        total_ram_gb = round(stat.ullTotalPhys / (1024**3), 1)
        free_ram_gb = round(stat.ullAvailPhys / (1024**3), 1)
        used_ram_gb = round((stat.ullTotalPhys - stat.ullAvailPhys) / (1024**3), 1)
        ram_percent = stat.dwMemoryLoad

        gpu_info = "NVIDIA GeForce RTX 5060 (8GB VRAM)"
        try:
            res = subprocess.run(
                ["nvidia-smi", "--query-gpu=name,memory.total,memory.used,memory.free", "--format=csv,noheader,nounits"],
                capture_output=True,
                text=True,
                timeout=2
            )
            if res.returncode == 0 and res.stdout.strip():
                parts = [p.strip() for p in res.stdout.strip().split(",")]
                if len(parts) >= 4:
                    gpu_info = f"{parts[0]} - Used: {parts[2]}MB / {parts[1]}MB ({parts[3]}MB free)"
        except Exception:
            pass

        return {
            "success": True,
            "ram_total_gb": total_ram_gb,
            "ram_free_gb": free_ram_gb,
            "ram_used_gb": used_ram_gb,
            "ram_percent": f"{ram_percent}%",
            "gpu": gpu_info
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def save_note(title: str, content: str) -> Dict[str, Any]:
    """Save a user note or task list item to local storage."""
    try:
        safe_title = "".join(c for c in title if c.isalnum() or c in (" ", "_", "-")).strip() or "note"
        note_file = os.path.join(NOTES_DIR, f"{safe_title}.txt")
        with open(note_file, "a", encoding="utf-8") as f:
            f.write(f"\n[{title}]\n{content}\n")
        return {"success": True, "message": f"Saved note '{title}'.", "file": note_file}
    except Exception as e:
        return {"success": False, "error": str(e)}


def list_notes() -> Dict[str, Any]:
    """List all saved notes and to-dos."""
    try:
        files = os.listdir(NOTES_DIR)
        notes = []
        for f in files:
            p = os.path.join(NOTES_DIR, f)
            if os.path.isfile(p):
                with open(p, "r", encoding="utf-8", errors="ignore") as n:
                    notes.append({"title": f, "preview": n.read()[:200]})
        return {"success": True, "count": len(notes), "notes": notes}
    except Exception as e:
        return {"success": False, "error": str(e)}
