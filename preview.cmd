@echo off
rem Starts a local preview of Snack Stand at http://localhost:8080/
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
pause
