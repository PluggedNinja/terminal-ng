# Gerar executável (Node SEA)

Empacota o **backend** (que serve a UI + WebSocket SSH) num único executável nativo,
usando o recurso oficial **Single Executable Applications** do Node (estável no Node 22+,
melhor no 24+). Use **Node 22 ou superior**.

## Passos

```bash
npm install            # instala esbuild + postject (devDeps novas)
npm run build:exe      # gera build/terminal-ng[.exe]
```

O script faz tudo: `vite build` → empacota o servidor com esbuild num único `.cjs`
→ cria o blob SEA → copia o binário do Node → injeta o blob com `postject`.

## Rodar

Copie a pasta **`dist/`** para **junto do executável** (o servidor procura `dist/`
ao lado do exe) e rode:

```bash
cd build
./terminal-ng           # (Windows: terminal-ng.exe)
```

Abra **http://localhost:3001**.

### Variáveis de ambiente

Coloque um `.env` ao lado do exe (ou exporte no shell). Veja `.env.example` para a lista completa.

Para **produção** (`NODE_ENV=production`) o backend **recusa iniciar** sem os três segredos fortes abaixo — isso evita publicar/distribuir com `admin`/`admin` ou um segredo de token previsível:

- `JWT_SECRET` — assina a sessão (mín. 32 caracteres).
- `TNG_ENC_KEY` — cifra os segredos em repouso: senhas SSH, tokens OAuth, chaves de API (mín. 32 caracteres). Se mudar esta chave, os segredos já salvos ficam ilegíveis.
- `ADMIN_PASSWORD` — senha do admin inicial (mín. 12 caracteres, não pode ser `admin`).

Gere um valor forte com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Opcionais: `PORT`, `NODE_ENV`, `TNG_ALLOWED_ORIGINS` (origens de CORS em produção), `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`.

## Observações

- **Multiplataforma**: o executável é do SO onde você rodou o build (Windows gera `.exe`,
  Linux gera ELF, macOS gera Mach-O). Para cada SO, rode `npm run build:exe` nesse SO.
- **ssh2**: o addon nativo opcional (`cpu-features`/`sshcrypto`) fica externo; se não
  estiver presente, o ssh2 cai no modo JS puro — funciona normalmente.
- **Dados**: o `dist/` fica ao lado do exe. Já o store JSON é gravado numa pasta estável
  por usuário — `%APPDATA%\terminal-ng\data\` (Windows) ou `~/terminal-ng/data/` — para
  sobreviver a rebuilds. Sobrescreva o local com a variável `TNG_DATA_DIR`. **Antes de
  distribuir o exe, limpe essa pasta** para não vazar hosts/tokens salvos localmente.
- **Tamanho**: ~80–110 MB (é o runtime do Node embutido). Para algo menor, dá pra usar
  `bun build --compile` (troca o runtime) — posso configurar se quiser testar.
