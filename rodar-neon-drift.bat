@echo off
setlocal

set "PROJ_DIR=C:\Users\Aztra G Afonso\Documents\Codex\2026-09-15\referenced-chatgpt-conversation-this-is-an\outputs\neon-drift"

echo ============================================
echo   Iniciando projeto: neon-drift (Astro)
echo ============================================

if not exist "%PROJ_DIR%" (
    echo [ERRO] Pasta do projeto nao encontrada:
    echo %PROJ_DIR%
    pause
    exit /b 1
)

cd /d "%PROJ_DIR%"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado no PATH.
    echo Instale o Node.js em https://nodejs.org antes de continuar.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [INFO] node_modules nao encontrado. Instalando dependencias...
    call npm install
    if errorlevel 1 (
        echo [ERRO] Falha ao instalar dependencias.
        pause
        exit /b 1
    )
) else (
    echo [INFO] Dependencias ja instaladas, pulando npm install.
)

echo.
echo [INFO] Iniciando servidor de desenvolvimento (npm run dev)...
echo Pressione CTRL+C para encerrar o servidor.
echo.

call npm run dev

pause
endlocal
