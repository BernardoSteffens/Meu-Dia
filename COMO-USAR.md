# Meu Dia — como testar no celular

Este é o app já empacotado como PWA (site instalável). O código React está
embutido em `app.js`, os dados ficam salvos no próprio aparelho (localStorage).
Você **não** precisa de internet depois do primeiro carregamento.

Conteúdo desta pasta (é o site inteiro):
index.html · app.js · manifest.json · sw.js · icon-192.png · icon-512.png

---

## Caminho A — Instalar como app (mais rápido, sem APK)

1. Publique esta pasta em qualquer host HTTPS. O mais fácil é **GitHub Pages**:
   - crie um repositório, suba estes arquivos na raiz;
   - Settings → Pages → Branch: main / (root) → Save;
   - vai gerar uma URL tipo `https://seu-usuario.github.io/seu-repo/`.
   (Alternativas iguais: Netlify Drop, Cloudflare Pages, Vercel — arrasta a pasta.)
2. Abra essa URL no **Chrome do Android**.
3. Menu (⋮) → **Adicionar à tela inicial** / "Instalar app".
4. Pronto: abre em tela cheia, funciona offline e guarda seus dados.

> Precisa ser HTTPS (GitHub Pages já é). Em `http://` o service worker não roda.

---

## Caminho B — Gerar um APK de verdade

Depois que a PWA estiver publicada (passo A), o APK sai de graça:

**PWABuilder (recomendado, sem instalar nada):**
1. Vá em https://www.pwabuilder.com
2. Cole a URL do seu site e clique em Start.
3. Aba **Android** → **Generate Package** → baixe o `.apk`/`.aab`.
4. Passe o `.apk` pro celular e instale (permita "fontes desconhecidas").

**Ou Capacitor (build local, precisa de Android Studio):**
```
npm create @capacitor/app
# copie os arquivos desta pasta para "www" / webDir
npx cap add android
npx cap sync
npx cap open android   # gera o APK pelo Android Studio
```

---

## Observações honestas
- É a mesma lógica de agendamento do protótipo (encaixe por duração, restrições,
  horários múltiplos de 5, janela de sono, realocar/pular por dia).
- Dados ficam **só naquele aparelho**. Não sincroniza entre celular e PC.
- Para regerar o `app.js` após mudanças no código:
  `esbuild src/main.jsx --bundle --minify --format=iife --outfile=dist/app.js --loader:.jsx=jsx --define:process.env.NODE_ENV='"production"'`
