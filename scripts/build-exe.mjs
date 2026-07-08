/**
 * build-exe.mjs — package Terminal//NG into a single native executable (Node SEA).
 *
 * Steps:
 *   1. vite build        → dist/ (frontend, served by the backend)
 *   2. esbuild bundle    → build/server.cjs (whole Node backend in one CJS file)
 *   3. node SEA blob     → build/sea-prep.blob
 *   4. copy the node binary → build/terminal-ng[.exe]
 *   5. postject inject   → the blob into the copied binary
 *
 * Run:  npm run build:exe
 * Then ship the executable in `build/` TOGETHER with the `dist/` folder
 * (the server serves dist/ from next to the exe). Run the exe and open
 * http://localhost:3001
 *
 * Requires devDeps: esbuild, postject  (npm install adds them).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, existsSync, chmodSync, cpSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'build');
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const exeName = isWin ? 'terminal-ng.exe' : 'terminal-ng';
const exePath = path.join(build, exeName);
const run = (cmd, args, opts = {}) => { console.log('›', cmd, args.join(' ')); execFileSync(cmd, args, { stdio: 'inherit', cwd: root, shell: isWin, ...opts }); };

// Close any running instance so the build folder isn't locked (EPERM).
if (isWin) { try { execFileSync('taskkill', ['/F', '/IM', exeName], { stdio: 'ignore', shell: true }); } catch { /* none running */ } }
try { rmSync(build, { recursive: true, force: true, maxRetries: 6, retryDelay: 300 }); }
catch (e) { console.error('\n[ERRO] Não consegui apagar a pasta build/. Feche o terminal-ng (janela/console) que está rodando e tente de novo.\n', e.message); process.exit(1); }
mkdirSync(build, { recursive: true });

// 1) frontend
run('npm', ['run', 'build']);

// 2) bundle the backend into one CJS file. ssh2's optional native addon and
//    cpu-features are kept external (loaded at runtime if present, else pure-JS).
const esbuild = await import('esbuild');
await esbuild.build({
  entryPoints: [path.join(root, 'server', 'index.js')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  outfile: path.join(build, 'server.cjs'),
  external: ['cpu-features'],
  plugins: [{ name: 'native-external', setup(b) { b.onResolve({ filter: /\.node$/ }, (a) => ({ path: a.path, external: true })); } }],
  logLevel: 'info',
});

// 3) SEA blob — call the node binary directly (no shell: its path may have spaces)
run(process.execPath, ['--experimental-sea-config', path.join(root, 'sea-config.json')], { shell: false });

// 4) copy the node binary
copyFileSync(process.execPath, exePath);
if (!isWin) chmodSync(exePath, 0o755);

// 5) inject the blob with postject
if (isMac) { try { run('codesign', ['--remove-signature', exePath]); } catch {} }
const postjectArgs = [exePath, 'NODE_SEA_BLOB', path.join(build, 'sea-prep.blob'), '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (isMac) postjectArgs.push('--macho-segment-name', 'NODE_SEA');
run('npx', ['postject', ...postjectArgs]);
if (isMac) { try { run('codesign', ['--sign', '-', exePath]); } catch {} }

// 6) make build/ self-contained: copy dist/ next to the exe so it just works.
try { cpSync(path.join(root, 'dist'), path.join(build, 'dist'), { recursive: true }); } catch (e) { console.warn('aviso: não copiei dist/', e.message); }
// drop a one-click launcher for Windows users.
try {
  if (isWin) {
    // Default launcher: starts the server and opens the DEFAULT browser — most
    // reliable for the ChatGPT (OAuth) login, which uses a popup + callback.
    const main = [
      '@echo off',
      'cd /d "%~dp0"',
      `start "" "${exeName}"`,
      'timeout /t 2 >nul',
      'start "" http://localhost:3001',
      '',
    ].join('\r\n');
    writeFileSync(path.join(build, 'INICIAR.bat'), main);

    // Optional "app window" launcher (chromeless Edge/Chrome). Looks like a
    // program, but the ChatGPT login may fail here — use INICIAR.bat to log in.
    const app = [
      '@echo off',
      'cd /d "%~dp0"',
      `start "" "${exeName}"`,
      'timeout /t 2 >nul',
      'set "URL=http://localhost:3001"',
      'set "E1=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
      'set "E2=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
      'if exist "%E1%" ( start "" "%E1%" --app=%URL% & goto fim )',
      'if exist "%E2%" ( start "" "%E2%" --app=%URL% & goto fim )',
      'where chrome >nul 2>nul && ( start "" chrome --app=%URL% & goto fim )',
      'start "" %URL%',
      ':fim',
      '',
    ].join('\r\n');
    writeFileSync(path.join(build, 'INICIAR-APP.bat'), app);
  }
} catch {}

console.log(`\n✔ Executável gerado em: ${exePath}`);
console.log(`  A pasta build/ já contém o exe + dist/ (tudo junto).`);
console.log(`  Rode o executável (no Windows, dê 2 cliques em build/INICIAR.bat) e abra http://localhost:${process.env.PORT || 3001}\n`);
