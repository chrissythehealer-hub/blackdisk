@echo off
REM Starts the AI Studio agent with ComfyUI's bundled Python. Keep this window open.
cd /d "%~dp0"
if exist "..\python_embeded\python.exe" (
  "..\python_embeded\python.exe" agent.py
) else (
  python agent.py
)
pause
