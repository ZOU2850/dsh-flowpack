@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-profile.ps1" %*
exit /b %ERRORLEVEL%
