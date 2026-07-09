@echo off
rem ============================================================
rem  Double-click this file to start the Jeopardy game server
rem  on a Windows computer.
rem
rem  A "Connect your devices" page opens in your browser with
rem  the addresses + QR codes for the TV and the Host view.
rem  Keep this black window open while you play; close it when
rem  game night is over. The first time, click "Allow" if the
rem  Windows firewall asks about Python.
rem ============================================================
cd /d "%~dp0"
echo Starting the Jeopardy server...
echo.
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py
  goto done
)
where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
  goto done
)
echo Python 3 isn't installed on this computer, so the server can't start.
echo Install it free from  https://www.python.org/downloads/  -- on the
echo installer's first screen, tick "Add python.exe to PATH" -- then
echo double-click this file again.
:done
echo.
pause
