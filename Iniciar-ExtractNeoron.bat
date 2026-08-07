@echo off
REM ============================================================
REM  ExtractNeoron - Painel de Leads "Negociando"
REM  Clique duas vezes neste arquivo para iniciar o painel.
REM ============================================================
setlocal
cd /d "%~dp0"
title ExtractNeoron - Painel

REM --- 1) Node.js instalado? ---------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRO] Node.js nao foi encontrado neste computador.
  echo Instale a versao LTS em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

REM --- 2) Dependencias instaladas? (so na 1a vez) ------------
if not exist "node_modules" (
  echo Instalando dependencias pela primeira vez... isso pode demorar um pouco.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao instalar as dependencias ^(npm install^).
    echo.
    pause
    exit /b 1
  )
)

REM --- 3) Abrir o navegador ~3s apos o servidor subir -------
echo.
echo Iniciando o painel em http://localhost:3000 ...
echo (Para encerrar, feche esta janela.)
echo.
start "" /min cmd /c "timeout /t 3 >nul && start http://localhost:3000/"

REM --- 5) Iniciar o servidor (mantem esta janela aberta) ----
node src/server.js

echo.
echo O servidor foi encerrado.
pause
