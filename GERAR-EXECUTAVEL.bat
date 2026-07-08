@echo off
chcp 65001 >nul
cd /d "%~dp0"
title TERMINAL//NG - Gerar executavel
echo ============================================================
echo    TERMINAL//NG  -  Gerador de executavel (.exe)
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale o Node 22 ou superior em:
  echo        https://nodejs.org
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
echo Node detectado:
node -v
if %NODEMAJOR% LSS 22 (
  echo.
  echo [ATENCAO] Seu Node e mais antigo que a versao 22.
  echo           O gerador de executavel ^(SEA^) precisa do Node 22+.
  echo           Atualize em https://nodejs.org e rode de novo.
  echo.
  pause
  exit /b 1
)

echo.
echo [1/2] Instalando dependencias... ^(pode demorar alguns minutos^)
call npm install
if errorlevel 1 goto erro

echo.
echo [2/2] Gerando o executavel...
call npm run build:exe
if errorlevel 1 goto erro

echo.
echo ============================================================
echo    PRONTO!  O executavel esta na pasta:  build\
echo.
echo    Para iniciar:  abra a pasta build  e  de 2 cliques em
echo                   INICIAR.bat
echo    Depois abra no navegador:  http://localhost:3001
echo ============================================================
echo.
pause
exit /b 0

:erro
echo.
echo *** Aconteceu um erro acima. Tire um print da tela e me mande. ***
echo.
pause
exit /b 1
