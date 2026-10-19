@echo off
setlocal
title NYC Internship Agent
cd /d "%~dp0"

echo ============================================
echo   NYC Internship Agent - demarrage
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js n'est pas installe.
  echo     Installez la version LTS depuis https://nodejs.org puis relancez ce fichier.
  start "" https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo [1/3] Installation des composants, quelques minutes la premiere fois...
  call npm install
  if errorlevel 1 goto :error
)

if not exist "%LOCALAPPDATA%\ms-playwright" (
  echo [2/3] Installation du navigateur pour la simulation des candidatures...
  call npx playwright install chromium
  if errorlevel 1 goto :error
)

if not exist .env (
  echo [3/3] Premiere configuration...
  copy /y .env.example .env >nul
  node -e "const fs=require('fs');const k=require('crypto').randomBytes(32).toString('base64');fs.writeFileSync('.env',fs.readFileSync('.env','utf8').replace(/^ENCRYPTION_KEY=.*$/m,'ENCRYPTION_KEY='+k));fs.writeFileSync('ENCRYPTION_KEY-a-sauvegarder.txt','Gardez cette cle en lieu sur (sans elle, vos donnees chiffrees sont perdues):\r\n'+k+'\r\n')"
  if errorlevel 1 goto :error
  echo.
  echo  Une cle de chiffrement a ete creee. Une copie est dans ENCRYPTION_KEY-a-sauvegarder.txt :
  echo  mettez-la en lieu sur, puis supprimez ce fichier.
  echo.
  echo  Le Bloc-notes va s'ouvrir : collez votre cle Anthropic apres ANTHROPIC_API_KEY=
  echo  (https://console.anthropic.com, rubrique API Keys), enregistrez avec Ctrl+S et fermez.
  pause
  notepad .env
)

echo.
echo Lancement... Chrome va s'ouvrir sur http://127.0.0.1:5173 dans quelques secondes.
echo Laissez cette fenetre ouverte. Pour arreter l'application : Ctrl+C ici, ou fermez la fenetre.
echo.
start "" /min cmd /c "timeout /t 10 /nobreak >nul & (start chrome http://127.0.0.1:5173 || start "" http://127.0.0.1:5173)"
call npm run dev
goto :eof

:error
echo.
echo [!] Une erreur est survenue. Copiez le message ci-dessus et envoyez-le pour obtenir de l'aide.
pause
exit /b 1
