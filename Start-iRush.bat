@echo off
title iRush — High-Speed iPhone USB Transfer
cd /d "%~dp0"

:: 1. Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ====================================================
    echo   [ERROR] Node.js is not installed on your PC.
    echo   Please install Node.js from https://nodejs.org
    echo ====================================================
    pause
    exit /b 1
)

:: 2. Check if dependencies are installed; install if missing
if not exist "node_modules\" (
    echo ====================================================
    echo   Welcome to iRush!
    echo   First-time setup: Installing components...
    echo   Please wait a moment...
    echo ====================================================
    call npm install --omit=dev
    if %errorlevel% neq 0 (
        echo [ERROR] Installation failed. Please check your internet connection.
        pause
        exit /b 1
    )
    echo Setup complete! Launching iRush...
)

:: 3. Launch the windowless background app
start wscript.exe "%~dp0iRush.vbs"
